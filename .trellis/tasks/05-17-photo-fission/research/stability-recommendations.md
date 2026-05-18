# Google 生图稳定性 · 综合建议清单（按 ROI 分层）

> 一句话：第一阶段聚焦四件事——①把所有 Google 调用收敛到一个带「指数退避 + jitter + 错误分类」的 wrapper；②补齐 IMAGE_SAFETY / 空 inlineData / Retry-After 三个高发缺口；③客户端 IPM 令牌桶兜底；④partial 失败时让用户能只重跑失败的 shot。这四件做完，预计两条主链路 P99 成功率可以从当前估算的 ~85% 拉到 95%+。

---

## 🟢 高 ROI（第一阶段必做）

### R1. 统一 `withGoogleImageRetry` wrapper

**问题**
- `google-genai-adapter.ts:76` 裸 fetch，零重试。
- `photo-fission-service.ts:517` 是项目里**唯一**有重试逻辑的地方，且基于字符串匹配。
- ai-fashion-photo 任意一次 transient 抖动 = 任务整死。

**建议**
1. 新增 `lib/server/google-image-retry.ts`，导出 `callGoogleImageWithRetry(input, options)`：
   - 内部封装 fetch → 错误分类 → 是否重试 → 指数退避 + jitter。
   - 重试配置：`attempts = 4`，`baseDelay = 1000`，`maxDelay = 60000`，`exponent = 2`，`jitter = 0.25`。
   - 读 `Retry-After` 头部，429/503 等待至少 `max(Retry-After, 30s)`。
2. 重构 `google-genai-adapter.ts:runGoogleImageEdit`：
   - 抽出 `performSingleCall(input)` 函数，外层用 `callGoogleImageWithRetry` 包裹。
   - 抛出**结构化错误** `class GoogleImageError extends Error { category, httpStatus, retryable, cause }`，message 留给 UI。
3. 替换 `photo-fission-service.ts:517 runPhotoFissionShotWithRetry`：
   - 删除字符串匹配版本，直接调 `callGoogleImageWithRetry`。
   - 保留单 shot 级别的"已重试 1 次仍失败 → 标 shotError 不影响其他 shot"语义。

**涉及文件**
- 新增：`lib/server/google-image-retry.ts`
- 改动：`lib/server/google-genai-adapter.ts`、`lib/server/photo-fission-service.ts`
- 改动：`lib/server/third-party-image-adapter.ts:runGoogleProviderEdits`（让 ai-fashion-photo 也走这条 wrapper）

**预估改动量**：~150 行新代码，~80 行替换。

---

### R2. 补齐 3 个高发失败缺口

#### R2.1 空 inlineData 自动重试

**问题**：`google-genai-adapter.ts:107` 在 finishReason 非 STOP 时一刀切 throw。社区 issue #1406 表明 finishReason=STOP 但 parts 中无 inlineData 也是高发问题，目前**完全不重试**。

**建议**：在 `performSingleCall` 内：
```
if (finishReason === 'STOP' && !inlineData) {
  throw new GoogleImageError({ category: 'empty_output', retryable: true, ... })
}
```
让 wrapper 自动重试 2 次。

#### R2.2 IMAGE_SAFETY / SAFETY 单次重试

**问题**：finishReason=IMAGE_SAFETY 或 promptFeedback.blockReason=SAFETY 在 ai-fashion-photo 场景里有相当一部分是 transient（同 prompt 同图重试就过）。当前一刀切 fail，UX 不佳。

**建议**：
- `category = 'image_safety' / 'safety_block'` 设 `retryable: true, maxRetries: 1`。
- 如果该错误已经重试 1 次仍失败，最终错误码归到 `category: 'image_safety_final'`，UI 提示「上游审核未通过，请尝试更改描述或换一张参考图」。
- PROHIBITED_CONTENT / RECITATION 不重试。

#### R2.3 Retry-After 头部尊重

**问题**：429 当前重试间隔写死 1500ms × attempt，IPM 是滚动 60s 窗口，1.5s 后基本必然再 429。

**建议**：wrapper 读 `Retry-After` 头；如缺失，rate_limit 退避兜底 30s + jitter。

**涉及文件**：和 R1 同一批文件。

**预估改动量**：包含在 R1 的 150 行里，约 +40 行。

---

### R3. 客户端 IPM 令牌桶

**问题**：photo-fission 9 shot + concurrency=3 + 用户连点 → 瞬时 IPM 6-10，Free / Tier 1 必触 429。

**建议**：新增 `lib/server/google-image-throttle.ts`：
- 进程级单例，按 `apiKey` 维护时间戳队列。
- 默认 `MAX_IMAGES_PER_MINUTE = Number(process.env.GOOGLE_IMAGE_IPM ?? 10)`、`MAX_RPM = Number(process.env.GOOGLE_IMAGE_RPM ?? 150)`。
- `await throttle.acquire(apiKey)` 在 `callGoogleImageWithRetry` 进入 fetch 之前调用，若当前窗口已满则 sleep 到下个空位。
- 整个 photo-fission 走 worker 池 → 令牌桶 → Google，**自然吸收**用户连点。

**涉及文件**
- 新增：`lib/server/google-image-throttle.ts`
- 接入：`lib/server/google-image-retry.ts` 调用 acquire / release。
- env：`.env.example` 增加 `GOOGLE_IMAGE_IPM` / `GOOGLE_IMAGE_RPM` 注释。

**预估改动量**：~80 行新代码。

---

### R4. 结构化日志 + traceId

**问题**：日志只有 taskId，photo-fission 拼出来的 `${taskId}_${shotId}_retry_${attempt}` 又被 adapter 当成 taskId 打出来，跨层定位极难。

**建议**：
1. 新增 `lib/server/log.ts` 简单 logger（不引入新依赖），所有 google-image 相关日志走 JSON-line：
   ```
   { lvl: 'info', evt: 'gimg.attempt', traceId, taskId, shotId, attempt, model, promptLen, refs, aspect, size, status, tookMs, category }
   ```
2. `callGoogleImageWithRetry` 入参强制 `{ traceId, taskId, shotId?, attemptHook? }`；photo-fission 用 `${taskId}_${shotId}` 作 traceId 前缀，ai-fashion-photo 直接用 taskId。
3. 失败抛 `GoogleImageError` 时 logger 自动打一条 `evt: 'gimg.fail'` 包含 category / cause。

**涉及文件**
- 新增：`lib/server/log.ts`
- 改动：`google-image-retry.ts`、`google-genai-adapter.ts`、`photo-fission-service.ts`

**预估改动量**：~60 行新代码 + 替换现有 console.log/warn。

---

## 🟡 中 ROI（第一阶段视实际工时取舍）

### R5. partial 失败的「重新生成失败镜头」入口

**问题**：photo-fission partial 状态下，用户唯一选择是把 9 张全部重跑。

**建议**：
- 后端新增 `POST /api/tasks/:taskId/retry-shots` ：
  - body `{ shotIds: string[] }`。
  - 校验：原 task.status ∈ {partial, failed}、shotId 必须在原 shotPlan 中且当前无对应 result。
  - 复用 task.inputAssetIds、task.params.shotPlan 中的 prompt，调一次 `runPhotoFissionPipeline(只跑指定 shot)`，结果合并回原 task。
  - 不另起新 task，credits 不重扣（PRD v2 photo-fission 不计费）。
- 前端：在 partial 卡片下添加「重新生成失败镜头 (N)」按钮，自动收集 errorMessage 不为空的 shot。

**涉及文件**
- `app/api/tasks/[taskId]/route.ts`（或新增 `app/api/tasks/[taskId]/retry-shots/route.ts`）
- `lib/server/task-store.ts`（暴露 retryShots 函数 + 复用 persistOneResult）
- `lib/server/photo-fission-service.ts`（让 pipeline 接受 `targetShotIds?: string[]` 入参）
- `components/workbench/right-panel.tsx`（UI 入口）

**预估改动量**：~150 行 + 一些 UI 调整。

---

### R6. 输入预检（参考图体积、prompt 长度）

**问题**：参考图 > 10MB 或 prompt 过长会直接返 400，现在到 Google 才知道，浪费一次往返 + 用户等待。

**建议**：
- `lib/server/asset-store / asset-validate.ts`：在 `createAsset` 时对 dataUrl 做 base64 字节大小检查，> 10MB 直接拒绝并提示。
- normalize 阶段对 finalPrompt 做长度检查，> 30000 字符提示用户拆分。

**涉及文件**
- `app/api/assets/upload/route.ts`
- `lib/server/ai-fashion-photo-service.ts:normalizeAiFashionPhotoParams`
- `lib/server/photo-fission-service.ts:normalizePhotoFissionParams`

**预估改动量**：~50 行。

---

### R7. 403 / 401 全局熔断

**问题**：API key 失效时，每个 task 都要打一遍上游才知道。

**建议**：`google-image-retry.ts` 内维护一个进程内 `authFailureUntil: number | null`，遇到 401/403 时设为 `Date.now() + 30000`；后续请求 fast-fail。30s 后自动解除。

**预估改动量**：~30 行。

---

## 🔴 低 ROI / 暂缓

| 项 | 暂缓原因 |
| --- | --- |
| 切到 `@google/genai` SDK | 当前 SDK retry 粒度不够精细（无 jitter / Retry-After / 错误分类），先自实现，第二阶段对接七牛云时再统一抽象 |
| 引入 Redis / SQS 作业队列 | 单实例 Next.js 还撑得住，过早架构升级 |
| Webhook callback | Google 不支持原生 webhook，与 Midjourney 模式不同 |
| Circuit Breaker 库（opossum 等） | R7 简化版熔断够用 |
| Shadow / dual-write 备用模型 | 第一阶段只有 google，等接七牛云时再说 |
| Idempotency key 严格落库 | 前端按钮 disabled + task-store 去重已经能挡 95%，正式做留给中期 |
| OTel / Sentry 接入 | R4 结构化日志先解决最痛的问题，正式接入后续做 |

---

## 实施顺序建议

```
Day 1：R1 + R2 + R4 (合在一个 implement 里，因为它们改的是同一批文件)
Day 2：R3 (令牌桶) + 联调测试
Day 3：R5 (重试失败镜头入口) - 含前端
Day 4：R6 + R7 + spec 更新 + 提交
```

每一项都包含：单元测试（错误分类、退避计算、令牌桶 acquire）+ 改 `.trellis/spec/` 记录新约定。

## 验收口径

- **可量化**：在生产环境跑 1 天，统计 `gimg.attempt` / `gimg.fail` 比率，目标 `gimg.fail / gimg.attempt` < 5%（当前估算 15-20%）。
- **可演示**：手动模拟 429 / 503 / 空 inlineData，每种都能在日志看到对应 category 且最终成功或干净失败（带可读 UI 文案）。
- **可重跑**：partial 状态下点「重新生成失败镜头」，只跑失败的，不动已成功的。

## 一句话总结

> 这套方案不引入新依赖、不重写架构、聚焦四个最痛的点。R1+R2+R3+R4 是最小可上线集合，R5 是用户最强烈感知的改善，R6+R7 是 hardening。
