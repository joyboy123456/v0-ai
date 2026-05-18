# 服装大片裂变 photo-fission — E2E 测试计划

> 执行者：Codex（或人工）。所有用例分级 P0/P1/P2，P0 全部通过才能验收。

---

## 0. 测试前置准备

### 0.1 环境配置

```bash
cd /Users/shishenglin1/xinman/dianshang/v0-ai
pnpm install
```

`.env.local` 必须包含（不写真值，从生产/共享密钥库拿）：

```env
GOOGLE_API_KEY=<必须真实可用>
IMAGE_API_PROVIDER=google
GOOGLE_IMAGE_MODEL=gemini-3.1-flash-image-preview
GOOGLE_IMAGE_TIMEOUT_MS=600000
PHOTO_FISSION_CONCURRENCY=2     # 可选，本测试会切换 1/2/3 多次
```

### 0.2 测试素材

准备 4 张测试图，建议放在 `/Users/shishenglin1/Desktop/test-photo-fission/`：

| 文件名 | 用途 | 要求 |
|---|---|---|
| `kid-dress.jpg` | 童装主参考图 | 真实童装电商成片，800×1200 左右，< 8MB |
| `adult-top.jpg` | 成人上衣参考图 | 用于品类切换测试 |
| `corrupted.jpg` | 损坏文件 | 改后缀的非图片或截断的 JPG |
| `oversize.jpg` | 超大图片 | > 20MB，校验上传上限 |

### 0.3 启动

```bash
pnpm dev
# 等待 "Ready in ...ms"
# 浏览器打开 http://localhost:3000
```

打开 DevTools → Network + Console，全程保持监听。

### 0.4 数据观察点

任务执行中后端会把状态写入 `data/fashion-mvp-store.json`，**测试时同时打开这个文件**对比前端展示与底层数据的一致性。

终端运行：

```bash
watch -n 1 'jq ".tasks[-5:] | map({taskId, featureType, status, message, resultCount: .params.resultCount, resultsLen: (.results | length)})" data/fashion-mvp-store.json'
```

---

## 1. P0 核心正向流程

### TC-1.1 — 4 张默认参数全链路

**步骤**：
1. 左侧 sidebar 点「服装大片裂变」
2. 主图上传 `kid-dress.jpg`
3. 品类保持默认「童装」
4. 裂变类型保持默认「多角度 + 多景别」
5. 生成数量保持默认 `4`
6. 比例保持默认 `3:4`
7. 补充提示词留空
8. 点「立即生成」

**预期 UI**：
- 按钮显示「创建任务中...」→ 立即生成
- 右侧进入「正在生成 1 / 4」之类的进度
- 4-8 分钟内（2 并发 × 单图 1-2 分钟）4 张图陆续出现
- 每张图缩略图上有中文 label 角标：**正面全身 / 45度侧面 / 半身近景 / 服装细节特写**
- 任务 status 最终变为绿色「成功」

**预期网络**：
- `POST /api/assets/upload` 返回 200 + assetId
- `POST /api/tasks` 返回 200 + taskId，body 中 `featureType=photo-fission`、`inputAssetIds.length=1`、`params.category='childrens'`、`params.variationTypes=['angle','shot']`、`params.generateCount=4`、`params.imageRatio='3:4'`、`params.shotPlan.length=4`
- 持续 `GET /api/tasks/{id}` 轮询，progress 单调递增

**预期 store**：

```bash
jq '.tasks[-1] | {taskId, status, message,
  shotCount: (.params.shotPlan | length),
  labels: (.params.shotPlan | map(.label)),
  resultsLen: (.results | length),
  resultLabels: (.results | map(.label)),
  finalPromptsUnique: ((.results | map(.finalPrompt) | unique | length) == (.results | length))
}' data/fashion-mvp-store.json
```

期望输出：

```json
{
  "status": "success",
  "shotCount": 4,
  "labels": ["正面全身", "45度侧面", "半身近景", "服装细节特写"],
  "resultsLen": 4,
  "resultLabels": ["正面全身", "45度侧面", "半身近景", "服装细节特写"],
  "finalPromptsUnique": true
}
```

✅ 通过判据：4 个 label 与预期一致 + finalPromptsUnique=true + resultsLen=4 + status=success

---

### TC-1.2 — 6 张方案

同 TC-1.1，仅生成数量改为 6。

**期望 labels**：`["正面全身", "侧面全身", "背面展示", "半身近景", "自然动作", "服装细节特写"]`
**期望 shotCount=6 / resultsLen=6**

---

### TC-1.3 — 9 张方案

同 TC-1.1，生成数量改为 9。

**期望 labels**：`["近景", "中景", "远景", "背面", "侧面", "45度侧面", "半身特写", "产品细节特写", "仰拍/低角度大片"]`
**期望 shotCount=9 / resultsLen=9**

---

### TC-1.4 — 带 userPrompt 的链路

**步骤**：
1. 上传 `kid-dress.jpg`
2. 生成数量 4
3. 补充提示词输入：`背景换成清晨公园，整体调成温暖柔光风格`
4. 生成

**期望**：
- 每条 `result.finalPrompt` 末尾都含 `【用户补充要求】` 段，且内容包含「背景换成清晨公园」
- 6 条核心要求仍然存在（用 `grep` 验证 prompt 文本含「保留产品图」/「禁止」等关键词）
- 4 条 label 仍然不同

```bash
jq -r '.tasks[-1].results[0].finalPrompt' data/fashion-mvp-store.json
# 用肉眼检查 prompt 结构
```

---

### TC-1.5 — 五种比例覆盖

依次以默认 4 张方案跑 5 次，每次只改 `imageRatio`：`1:1` / `3:4` / `4:3` / `9:16` / `16:9`。

**预期**：
- 每次任务都 success
- 后端日志（terminal）显示 `aspect=<ratio>` 与所选一致
- 出图实际比例与所选一致（肉眼或下载后 `file` 命令）
- ⚠️ 关键：左面板比例选择器的缩略图也要显示对应形状（不再全是正方形）

---

### TC-1.6 — 六种品类覆盖

依次切换品类下拉 / 选项卡：`上衣 / 裤子 / 裙子 / 套装 / 外套 / 童装`，每次跑 4 张。

**预期**：
- 6 次任务全部 success
- `params.category` 分别为 `tops / pants / skirts / suit / outerwear / childrens`
- 出图主体与品类匹配（肉眼）

---

### TC-1.7 — 裂变类型多选

至少跑 4 组：
- `['angle']` 单选
- `['angle','shot']` 默认
- `['angle','shot','action']` 三选
- `['angle','shot','action','detail']` 全选

**预期**：
- 每次 `params.variationTypes` 与所选一致
- 至少 1 项必须可选；全部取消勾选时按钮置灰或点击拦截

---

## 2. P0 校验与错误链路

### TC-2.1 — 未上传参考图

**步骤**：清空主图 → 直接点生成
**预期**：前端弹/显示「请先上传参考图」，**不发 `/api/tasks` 请求**
**通过**：Network 面板 0 个新 `/api/tasks` 请求

### TC-2.2 — 参数被人为篡改

在 Console 手动 fetch：

```js
fetch('/api/tasks', {
  method: 'POST',
  headers: {'content-type':'application/json'},
  body: JSON.stringify({
    featureType: 'photo-fission',
    inputAssetIds: ['fake_asset_id'],
    params: { category: 'invalid', variationTypes: [], generateCount: 5, imageRatio: '5:4', userPrompt: '' }
  })
}).then(r => r.json()).then(console.log)
```

**预期**：返回 400 + 中文错误，不创建任务

### TC-2.3 — Google API 失败

把 `.env.local` 的 `GOOGLE_API_KEY` 改成无效值 → 重启 dev → 跑 TC-1.1

**预期**：
- 任务 status 变为 `failed`
- `errorMessage` 中文化（不暴露原始 stack / API key）
- 前端展示错误提示

测后恢复正确 key 重启。

### TC-2.4 — 部分失败 → partial

模拟方法 A（推荐）：把 `PHOTO_FISSION_CONCURRENCY` 设为 9 + 用一个 Tier 1 受限 key 跑 9 张方案，故意触发 RATE_LIMIT。

模拟方法 B：临时改 `lib/server/photo-fission-service.ts` 在第 3 个 shot 抛错（测试完恢复），跑 4 张方案。

**预期**：
- status = `partial`
- `message` 含「已生成 N/M 张」中文提示
- `params.shotPlan` 仍然 4 条完整
- `results` 长度 < 4（保留成功的）
- 前端结果区显示成功的图，失败的不显示但可看出 shotPlan 完整

---

## 3. P0 结果展示

### TC-3.1 — 结果卡片 label 角标

跑完 TC-1.1 后：
- 右面板主结果区每张图缩略图上有 label 角标
- 历史记录卡片缩略图上也有 label 角标
- 点开详情对话框，右侧每张缩略图也有 label

### TC-3.2 — 复制全部 Prompt

详情面板点「复制提示词」（或「复制全部 Prompt」按钮），粘贴到记事本：

**预期格式**：

```
【正面全身】
基于参考图...
[完整 finalPrompt]

【45度侧面】
基于参考图...
[完整 finalPrompt]

【半身近景】
...

【服装细节特写】
...
```

**通过**：4 段、每段以 `【label】` 开头、内容互不相同

### TC-3.3 — 下载图片

每张图悬停 → 下载按钮 → 文件能保存为 jpg/png，文件大小 > 100KB

### TC-3.4 — 历史记录

刷新页面 → 历史任务卡片显示：
- featureType label = 「服装大片裂变」
- 创建时间
- userPrompt（如有）
- 4-9 张结果缩略图带 label
- 状态 chip：成功/部分成功/失败

### TC-3.5 — 同款再做一次

点历史任务的「再做一次」/「同款」按钮（如果有）→ 应能把参数回填到表单，再次生成

---

## 4. P0 数据契约（必检）

每次 TC-1.x 跑完执行：

```bash
jq '.tasks[-1] | {
  taskId, featureType, status,
  paramKeys: (.params | keys),
  shotPlan: .params.shotPlan,
  resultFieldsOk: ([.results[] | (has("label") and has("shotId") and has("finalPrompt"))] | all)
}' data/fashion-mvp-store.json
```

**通过判据**：
- `paramKeys` 包含 `category / variationTypes / generateCount / imageRatio / userPrompt / shotPlan / resultCount / creditsCost`
- 每个 shot 都有 `shotId / label / prompt / order` 四字段
- 每个 result 都有 `label / shotId / finalPrompt`（resultFieldsOk = true）
- shotId 与 result.shotId 能对应上

**安全检查**：

```bash
jq -r '.tasks[-1] | (.params, .results)' data/fashion-mvp-store.json | grep -i "AIza\|GOOGLE_API_KEY"
# 期望 0 条命中
```

---

## 5. P1 回归（兄弟模块不能炸）

### TC-5.1 — AI 服装大片正向回归

切到「AI 服装大片」→ 上传参考 → 默认参数 → 生成 → status=success
**关键**：任务 `featureType=ai-fashion-photo`、`results` 不含 label/shotId/finalPrompt（或这些可选字段没有也不报错）

### TC-5.2 — 姿势裂变正向回归

切到「姿势裂变」→ 走原有流程 → 任务 success

### TC-5.3 — 历史任务回归

session start 前已存在的历史任务（如有）刷新后仍能显示，不报错

---

## 6. P1 兼容性

### TC-6.1 — 旧 photo-fission 任务展示

如果 `data/fashion-mvp-store.json` 里有旧字段 photo-fission 任务（productCategory/hasFrontDetail 等）：
- 历史卡片能渲染基础信息
- 不会因为缺 `shotPlan` 字段崩溃
- 复制 Prompt 按钮要么禁用要么降级处理

若没有旧任务，可手工注入一条到 store.json（备份后）做兼容测试。

### TC-6.2 — 文件上传校验

- 上传 `corrupted.jpg` → 应被拒
- 上传 `oversize.jpg`（>20MB）→ 应返回 413
- 上传 `.gif` → 应可接受（mime 在白名单内）

---

## 7. P1 性能与并发

### TC-7.1 — 串行（CONCURRENCY=1）

`.env.local` 设 `PHOTO_FISSION_CONCURRENCY=1` 重启，跑 4 张方案。
**预期**：终端日志中 `[google-api]` 调用按顺序串行，不存在两个并行进行中的请求。耗时约为 2 并发的 2 倍。

### TC-7.2 — 高并发（CONCURRENCY=3）

设为 3 重启，跑 9 张方案。
**预期**：终端能观察到 3 个并发 in-flight 的 `[google-api]` 调用；总耗时显著低于串行。如果 Google 触发 429 → 任务应正确变成 partial / failed，错误信息中文化。

### TC-7.3 — 非法 CONCURRENCY 兜底

依次试 `PHOTO_FISSION_CONCURRENCY=0` / `-3` / `abc` / 不设置
**预期**：服务正常启动，并发回退到默认 2，无报错

---

## 8. P2 边界

### TC-8.1 — 极端 userPrompt

输入 800 字汉字补充提示词 → 任务能正常完成；终端日志 `promptLen` > 1000 但 < 5000

输入 > 800 字 → 前端 textarea 截断或拦截

### TC-8.2 — 服务重启卡死任务

跑一个 9 张方案时立刻 `Ctrl+C` 杀掉 dev → 重启 → 等 16 分钟（或临时把 `STALE_RUNNING_TIMEOUT_MS` 调小）
**预期**：任务被 `reviveStaleRunningTasks` 标记 failed + 中文提示

### TC-8.3 — 并发创建多个 photo-fission 任务

在 30 秒内连续创建 3 个 photo-fission 任务
**预期**：3 个独立 task 都能完成；store.json 写入不串行错乱

---

## 9. 通过判据汇总

| 等级 | 总数 | 通过率要求 |
|---|---|---|
| P0 | TC-1.x + TC-2.x + TC-3.x + TC-4.x ≈ 25 项 | **100%** |
| P1 | TC-5.x + TC-6.x + TC-7.x ≈ 9 项 | ≥ 90% |
| P2 | TC-8.x ≈ 3 项 | ≥ 70% |

---

## 10. 报告格式

每个用例报告 4 件事：

```
TC-X.X
  Step: <实际操作>
  Expected: <PRD 期望>
  Actual: <UI 看到 + Network 状态码 + store 关键字段>
  Pass/Fail: ✅ / ❌（失败附截图 + store.json 片段 + 终端日志）
```

最终聚合：

- P0 通过率
- 关键缺陷（critical）
- 建议补丁（minor）

---

## 11. 常用 jq 速查

```bash
# 看最新 5 个任务摘要
jq '.tasks[-5:] | map({taskId, featureType, status, msg: .message, count: (.results | length)})' data/fashion-mvp-store.json

# 看最新任务的 shotPlan
jq '.tasks[-1].params.shotPlan' data/fashion-mvp-store.json

# 检查所有 results 的 finalPrompt 是否唯一
jq '.tasks[-1] | (.results | map(.finalPrompt) | unique | length) == (.results | length)' data/fashion-mvp-store.json

# 找 partial 状态任务
jq '.tasks | map(select(.status == "partial")) | length' data/fashion-mvp-store.json
```

---

## 12. 已知限制 / 测试时注意

- Google Tier 1 限速：连续跑 5 个 9 张方案任务大概率会触发 429；测试间留 30 秒缓冲
- 单次出图 1-3 分钟；4 张方案在 2 并发下大约 3-5 分钟完成
- `data/fashion-mvp-store.json` 测试结束后可备份并清理，避免开发环境数据堆积
- 不要把真实 `GOOGLE_API_KEY` 提交进 git；如果意外 commit，立即 revoke + 轮换
