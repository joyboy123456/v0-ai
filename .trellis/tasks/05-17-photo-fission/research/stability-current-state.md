# Google 生图稳定性 · 现状盘点

> 一句话：AI 服装大片走 `runGoogleImageEdit` 裸 fetch、**零重试零退避**；photo-fission 在 service 层有"线性退避 + 字符串匹配"的最多 1 次重试，两条链路的所有失败分类、错误识别、可观测性都建在脆弱的 message.includes 上。

## 1. 调用链路图（文字版）

### 1.1 AI 服装大片（ai-fashion-photo）

```
POST /api/tasks (createTask)
  └─ lib/server/task-store.ts: createTask → runTask (异步)
        └─ runTask → runThirdPartyWorkflow
              └─ third-party-image-adapter.ts:runGoogleProviderEdits
                    └─ google-genai-adapter.ts:runGoogleImageEdit
                          └─ for i in count: fetchWithTimeout(generateContent)   ← 真正调 Google
```

关键点：
- 入口在 `lib/server/task-store.ts:184`（`runTask`），状态机推进 `pending → running → success/failed`。
- 真正的 Google HTTP 调用在 `lib/server/google-genai-adapter.ts:76` 的 `fetchWithTimeout`。
- **没用 `@google/genai` SDK**，是手写 REST：`POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`。
- `count > 1` 时 `for index of count` 串行调用（`google-genai-adapter.ts:72`），单次抛错整批废，已生成的图直接丢弃。

### 1.2 AI 服装大片裂变（photo-fission）

```
POST /api/tasks
  └─ task-store.ts:runTask
        └─ runThirdPartyWorkflow (third-party-image-adapter.ts:107-130)
              └─ runPhotoFissionPipeline (photo-fission-service.ts:379)
                    ├─ 并发 worker pool（concurrency 默认 3）
                    └─ 每个 shot → runPhotoFissionShotWithRetry (line 517)
                          └─ for attempt in maxAttempts:
                                runGoogleImageEdit  ← 同样落到 google-genai-adapter
```

关键点：
- 9 个 shot 走 `for...while nextIndex` 的固定并发池（`photo-fission-service.ts:407`）。
- **流式持久化**：每个 shot 成功立刻通过 `onShotResult` 回调写盘 + 更新 store（`task-store.ts:225-239` + `task-store.ts:277` `persistOneResult`）。设计上即使后续 shot 卡死，已成功的图也不会丢。这是当前架构里唯一的稳定性亮点。
- 单 shot 容忍失败、全部失败才 throw（`photo-fission-service.ts:491`）；上层 `resolveTaskCompletion` 把 partial 成功标为 `status: 'partial'`（`task-store.ts:334`）。

## 2. 现有重试与退避（详细）

| 链路 | 文件:行 | 最大尝试 | 退避策略 | 触发条件 |
| --- | --- | --- | --- | --- |
| AI 服装大片 | google-genai-adapter.ts:72 | **1（零重试）** | 无 | — |
| photo-fission 单 shot | photo-fission-service.ts:520-548 | env `PHOTO_FISSION_SHOT_RETRIES` 默认 1，即最多 2 次 | `delay(1500 * attempt)`，**线性、无 jitter** | `isRetryablePhotoFissionError(message)` 字符串匹配 |

`isRetryablePhotoFissionError`（line 553）的判断条件是：
```
network 类: '网络请求失败' | 'fetch failed' | 'timeout' | '超时' | 'und_err'
HTTP 类:   '调用失败：429' | '...500' | '...502' | '...503' | '...504'
```
问题：上游 throw 出来的 message 形如 `Google Gemini API 调用失败：${response.status}` 或 `Google Gemini API 网络请求失败：…`。`isRetryablePhotoFissionError` 匹配的"调用失败：429"在 google-genai-adapter 抛错时实际是 `Google Gemini API 调用失败：429`（line 96），**字符串拼接里没有中文冒号前的字段**，能匹配上，但极易因 message 文案微调而失效（无单测保护）。

## 3. 超时

- 全局唯一超时：`GOOGLE_IMAGE_TIMEOUT_MS`，默认 600s（third-party-image-adapter.ts:60）。
- 实现：`fetchWithTimeout` 使用 `AbortController.abort()`，AbortError 翻译为中文友好提示（google-genai-adapter.ts:192-200）。
- 没有 **每次重试独立 AbortController**：当前实现下重试间隔由上层的 `delay()` 加在 try-catch 之外，看起来正确。
- 没有 **整体 deadline**：单 shot 在 600s 超时 + 1500ms 退避 + 第二次 600s，理论可达 ~20 分钟仍在跑，但 task-store 又有 60 分钟"卡死"标记（task-store.ts:417），勉强自洽，但用户视角等待会非常长。

## 4. 错误识别 / 分类现状

`google-genai-adapter.ts` 当前的错误分支：

| 分支 | 文件:行 | 抛出的 message | 后续是否重试 |
| --- | --- | --- | --- |
| AbortError 超时 | line 195 | `Google Gemini API 调用超时（${seconds}s 未返回）。请尝试…` | photo-fission 会匹配 `超时` 重试；ai-fashion-photo 直接失败 |
| fetch 抛错（非 abort） | line 204 | `Google Gemini API 网络请求失败：${error.message}` | photo-fission 匹配 `网络请求失败` 重试；ai-fashion-photo 直接失败 |
| response.ok = false | line 95 | `Google Gemini API 调用失败：${status}` | photo-fission 匹配 4xx/5xx 部分状态码重试；ai-fashion-photo 直接失败 |
| `promptFeedback.blockReason` | line 99 | `Google Gemini 拒绝生成：${blockReasonMessage ?? blockReason}` | **永远不重试**（双链路都不会再试） |
| `candidates[0].finishReason !== STOP` 且无 inlineData | line 107 | `Google Gemini 未返回图片（finishReason=${finish}）` | **永远不重试** |
| 无 finishReason、parts 空 | line 110 | `Google Gemini 未返回图片` | **永远不重试** |

致命缺口：
- **IMAGE_SAFETY / SAFETY / RECITATION / PROHIBITED_CONTENT** 都会落到 `finishReason !== STOP` 分支，被一刀切标"不重试"。但实际有一些 case 是 transient（参考图 + prompt 撞到 safety 边界，再调一次会过），值得**最多重试一次 + 可选 prompt 安全化降级**。
- **inlineData 偶发为空**（即 finishReason 是 STOP，但 parts 里 image 部分缺失）是 Gemini 2.5/3 Image 模型的已知问题（见 stability-google-best-practices.md），当前直接抛 `未返回图片` 永远不重试。
- **没有结构化 error code**：所有错误都靠中文 message 字符串识别，前端 UI 拿到的也是这段 message。

## 5. 可观测性现状

`google-genai-adapter.ts` 的全部日志（grep `console.log`）：

```ts
// line 66: 进入时
[google-api] task=${taskId} model=${model} count=${count} promptLen=${...} images=${...} aspect=${...} size=${...}

// line 91: 每次 call 收到响应
[google-api] task=${taskId} call#${index+1} status=${response.status} took=${took}ms

// line 127: 全部完成
[google-api] task=${taskId} done totalResults=${...} totalTook=${...}ms
```

`photo-fission-service.ts` 的全部 warn（grep `console.warn`）：

```ts
// line 459: 流式持久化失败
[photo-fission] task=${taskId} shot=${shot.shotId} 流式持久化失败：${message}

// line 470: 单 shot 最终失败
[photo-fission] task=${taskId} shot=${shot.shotId} 失败：${message}

// line 543: 单 shot 准备重试
[photo-fission] task=${taskId} shot=${shot.shotId} 第 ${attempt} 次失败，准备重试：${message}
```

缺失的关键字段：
- **requestId**：所有日志只有 taskId，photo-fission 用 `${taskId}_${shotId}_retry_${attempt}` 拼出 requestId 传给 adapter（line 524），但 adapter 内部又把它叫 `taskId`，**没有一个稳定的 traceId 贯穿 4 层调用**。
- **failure category**：日志只输出原 message，没有归类成 `network` / `rate_limit` / `safety` / `empty_output` / `unknown`。线上排查只能 grep 中文。
- **prompt 长度、参考图 base64 总大小、aspect/size**：进入时有，重试时没有重打。
- **finishReason / blockReason**：失败分支抛错时把 finishReason 嵌进 message，但没有结构化字段单独打。
- **耗时分桶**：每次成功打 `took`，但失败那次的耗时被埋在 throw 链路里没记录。

没有任何指标上报、trace、Sentry / OTel 集成。

## 6. 前端失败呈现

- `app/api/tasks/[taskId]/route.ts` 返回完整 task 状态。
- 前端在 `components/workbench/` 下消费 `task.status` + `task.errorMessage`（前端代码本次未深读，但 task-store.ts:262 把 `errorMessage` 设为 `error.message`，是英文 / 中文混杂的 raw message）。
- partial 状态（photo-fission）走 `task.status === 'partial'`，但消息只有"已生成 X/9 张，部分镜头失败"，**没有任何"重新生成失败镜头"入口**——用户必须把 9 张全部重跑。

## 7. 其他相关稳定性细节

- `task-store.ts:417` 的 `STALE_RUNNING_TIMEOUT_MS = 60min` 防止冷启动留下脏 pending 任务，做得不错。
- `task-store.ts:457` 的 `persistChain` 串行化磁盘写入，避免并发 last-write-wins，做得不错。
- `third-party-image-adapter.ts:55` 默认 provider = `google`，Raycast 路径仍保留但不在主链路。
- `package.json` 当前**没有 `@google/genai` 依赖**——意味着切到 SDK 需要新增依赖；继续走裸 fetch 也是合理选项。

## 8. 一句话总结

两条主链路都建在「裸 fetch + 字符串匹配错误 + 单层 try-catch」上。photo-fission 比 ai-fashion-photo 多了一层 worker 池 + 流式持久化 + 弱重试，但仍然 fragile。任何稳定性优化的最小集合至少要补齐：
1. 统一的 `callGoogleImage` 重试封装（指数退避 + jitter + 可分类）。
2. 结构化 error 抛出（保留 code / category / retryable / cause），message 留给 UI。
3. requestId 贯穿 task → shot → attempt。
4. 双链路共用同一份重试 / 退避逻辑（目前 ai-fashion-photo 完全裸奔）。
