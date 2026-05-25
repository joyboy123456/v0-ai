# ModelRouter API 接入规范

> 本文档基于 ModelRouter 官方文档整理，供团队接入新模型时参考。
> 最后更新：2026-05-25

## 1. 基础信息

| 项 | 值 |
|---|---|
| Base URL | `https://model-router.edu-aliyun.com/v1` |
| 认证方式 | Bearer Token（API Key） |
| 公共请求头 | `Authorization: Bearer <api-key>` |
|  | `Content-Type: application/json` |
| 环境变量 | `MODELROUTER_API_KEY`（全局）/ `VIDEO_API_KEY`（视频专用） |

## 2. 模型命名规则

所有模型标识统一为 `qwen/<model_code>` 格式，例如：
- `qwen/qwen3-max`（文本）
- `qwen/happyhorse-1.0-t2v`（视频）
- `qwen/wan2.7-image-pro`（图片）

**注意事项：**
- 必须带 `qwen/` 前缀，否则返回 `B.Request.InvalidModelFormatException`
- 第三方模型（DeepSeek、Kimi、GLM 等）同样带 `qwen/` 前缀，如 `qwen/deepseek-v4-pro`

## 3. 模型总览（126 个）

### 3.1 文本对话（59 个）

| 子类别 | 代表模型 |
|---|---|
| 旗舰 | `qwen/qwen3.7-max`, `qwen/qwen3-max`, `qwen/qwen-max` |
| 高端 | `qwen/qwen3.6-plus`, `qwen/qwen3.5-plus`, `qwen/qwen-plus` |
| 快速 | `qwen/qwen3.6-flash`, `qwen/qwen3.5-flash`, `qwen/qwen-turbo` |
| 长文 | `qwen/qwen-long`, `qwen/qwen-long-latest` |
| 数学 | `qwen/qwen-math-plus`, `qwen/qwen-math-turbo` |
| 推理 | `qwen/qwq-plus`, `qwen/qwq-plus-latest` |
| 编码 | `qwen/qwen3-coder-plus`, `qwen/qwen3-coder-flash` |
| 开源 | `qwen/qwen3.5-35b-a3b`, `qwen/qwen3.5-27b` |

### 3.2 第三方文本（19 个）

DeepSeek（10）、Kimi（3）、GLM（4）、MiniMax（2）

### 3.3 视觉/多模态（8 个）

视觉理解（4）、OCR（2）、多模态（2）

### 3.4 图片生成/编辑（10 个）

生成（8）、编辑（2）

### 3.5 视频生成（18 个）

| 子类别 | 模型 |
|---|---|
| 文本生视频 | `qwen/wan2.7-t2v`, `qwen/wan2.6-t2v`, `qwen/wan2.5-t2v-preview`, `qwen/wan2.2-t2v-plus`, `qwen/happyhorse-1.0-t2v` |
| 图片生视频 | `qwen/wan2.7-i2v`, `qwen/wan2.6-i2v` 等 10 个 |
| 视频编辑 | `qwen/wan2.7-videoedit`, `qwen/happyhorse-1.0-video-edit` |
| 视频转视频 | `qwen/happyhorse-1.0-r2v` |

### 3.6 语音（5 个）

TTS（1）、ASR（4）

### 3.7 向量（4 个）/ 排序（3 个）

## 4. API 接口规范

### 4.1 文本对话

```
POST /v1/chat/completions
```

**协议兼容：** OpenAI Chat Completions

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| model | string | 是 | 模型标识 |
| messages | array | 是 | `[{role, content}]` |
| stream | boolean | 否 | 流式响应，默认 false |
| temperature | number | 否 | 采样温度 0-2 |
| max_tokens | integer | 否 | 最大生成 Token |
| enable_thinking | boolean | 否 | 启用深度思考/思维链 |

**注意事项：**
- `qwq` 系列仅支持 `stream: true`
- 多模态模型需在 messages 中传入图片

**示例：**
```bash
curl https://model-router.edu-aliyun.com/v1/chat/completions \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen/qwen3-max", "messages": [{"role": "user", "content": "Hello"}]}'
```

### 4.2 图片生成/编辑

```
POST /v1/images/generations
```

**两套协议：**

| 模型版本 | 调用方式 | 格式 |
|---|---|---|
| 新版（wan2.7/2.6） | 同步 | OpenAI 格式 `{model, prompt, n, size}` |
| 旧版（wan2.5/2.2） | 异步 | DashScope 格式 + `X-DashScope-Async: enable` |

**新版同步调用：**
```bash
curl https://model-router.edu-aliyun.com/v1/images/generations \
  -H "Authorization: Bearer sk-xxx" \
  -d '{"model": "qwen/wan2.7-image", "prompt": "...", "n": 1, "size": "1024*1024"}'
```

**旧版异步调用：**
```bash
# 提交
curl https://model-router.edu-aliyun.com/v1/images/generations \
  -H "Authorization: Bearer sk-xxx" \
  -H "X-DashScope-Async: enable" \
  -d '{"model": "qwen/wan2.5-t2i-preview", "input": {"prompt": "..."}, "parameters": {"size": "1024*1024"}}'

# 查询
curl https://model-router.edu-aliyun.com/v1/tasks/{task_id} \
  -H "Authorization: Bearer sk-xxx"
```

**图片编辑：** `input.images` 传入图片 URL，同异步格式。

### 4.3 视频生成

```
POST /v1/videos/generations    # 提交（异步）
GET  /v1/tasks/{task_id}       # 轮询状态
```

**调用方式：** 纯异步（所有视频模型）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| model | string | 是 | 模型标识 |
| prompt | string | 是 | 视频描述 |
| image_url | string | 否 | 图生视频时必填（公网可访问 URL） |
| duration | string | 否 | 视频时长（秒），如 "5" |
| size | string | 否 | 分辨率，如 "1280*720"、"1920*1080" |

**提交响应：**
```json
{
  "output": { "task_id": "qwen_xxxx-xxxx" },
  "request_id": "..."
}
```

**轮询响应：**
```json
{
  "output": {
    "task_id": "qwen_xxxx",
    "task_status": "SUCCEEDED",
    "video_url": "https://dashscope-xxx.oss-xxx.aliyuncs.com/xxx.mp4?Expires=..."
  }
}
```

**task_status 值：** `PENDING` → `RUNNING` → `SUCCEEDED` / `FAILED`

**关键注意事项：**
- 视频生成耗时 3-5 分钟，需配置轮询超时（建议 maxWait 10min）
- 返回的 `video_url` 是 OSS 签名 URL，**有效期约 24 小时**，必须立即归档到本地存储
- `image_url` 仅 i2v/r2v/video-edit 类型模型需要

**现有实现：** `lib/server/model-router-client.ts` + `lib/server/video-service.ts`

### 4.4 语音合成（TTS）

```
POST /v1/audio/speech
```

**协议兼容：** OpenAI Audio Speech

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| model | string | 是 | `qwen/qwen3-tts-instruct-flash` |
| input | string | 是 | 待合成文本 |
| voice | string | 是 | 可选：`Chelsie`、`Ethan`、`Serena` |
| response_format | string | 否 | `mp3`/`wav`/`pcm`，默认 mp3 |
| speed | number | 否 | 语速，默认 1.0 |

### 4.5 语音识别（ASR）

```
POST /v1/audio/transcriptions
```

**协议兼容：** OpenAI Audio Transcriptions
**请求格式：** `multipart/form-data`（file 字段上传音频）

### 4.6 向量

```
POST /v1/embeddings
```

**协议兼容：** OpenAI Embeddings

**多模态向量特殊格式：**
- `tongyi-embedding-vision-plus`：`input: {image: "url"}`
- `qwen3-vl-embedding`：`input: {contents: [{text: "..."}]}`

### 4.7 排序

```
POST /v1/rerank
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| model | string | 是 | 模型标识 |
| query | string | 是 | 查询文本 |
| documents | array | 是 | 候选文档 |
| top_n | integer | 否 | 返回前 N 个 |

**多模态排序：** 使用嵌套 `input` 格式：`{model, input: {query, documents}, top_n}`

### 4.8 异步任务查询

```
GET /v1/tasks/{task_id}
```

所有异步接口统一使用此端点查询状态。响应字段通过 `output.task_id` / `output.task_status` / `output.video_url` 等路径提取。

## 5. 项目中的接入模式

### 5.1 现有实现

| 模态 | 文件 | 状态 |
|---|---|---|
| 视频生成 | `lib/server/model-router-client.ts` + `video-service.ts` | 已接入 |
| 文本对话 | 未接入 | — |
| 图片生成 | 未接入 | — |
| 语音/向量/排序 | 未接入 | — |

### 5.2 新模态接入 Checklist

1. **在 `lib/types.ts` 添加类型定义**
   - 模型选项（`*ModelOption` / `*MODELS` 常量）
   - 参数接口（`*Params`）
   - 默认值与校验函数

2. **在 `lib/server/` 新建 service 文件**
   - 复用 `model-router-client.ts` 中已有的 `authHeaders()` / `withTimeout()` 工具函数
   - 同步接口：直接 fetch → 解析 → 返回
   - 异步接口：提交 → 轮询 → 返回（参考 `submitVideoGeneration` + `pollVideoTask` 模式）

3. **在 `task-store.ts` 注册新 featureType**
   - `FEATURE_WORKFLOWS` 添加映射
   - `normalizeTaskParams` 添加参数校验分支
   - `runTask` 添加调用分支

4. **前端接入**
   - `left-panel.tsx` 添加表单
   - `right-panel.tsx` 添加结果展示（如需新 mediaType）
   - `feature-sidebar.tsx` 添加功能入口

### 5.3 关键设计原则

- **字段提取兼容：** ModelRouter 不同模型返回结构有差异，`extract*` 函数应尝试多个路径
- **签名 URL 即时归档：** 所有 OSS 签名 URL（视频/图片）有效期约 24h，收到后必须立即 fetch 到本地/R2 存储
- **超时与重试：** 视频生成建议 maxWait 10min，图片同步 120s；客户端不做节流（服务端限流）
- **API Key 管理：** 统一从 `MODELROUTER_API_KEY` 或特定 `VIDEO_API_KEY` / `LLM_MODELROUTER_API_KEY` 读取

## 6. 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| `InvalidModelFormatException` | 缺少 `qwen/` 前缀 | 使用完整标识如 `qwen/happyhorse-1.0-t2v` |
| qwq 调用失败 | 仅支持 stream | 设置 `stream: true` |
| 图片生成 "url error" | 旧版模型不支持同步 | 加 `X-DashScope-Async: enable`，用 DashScope 格式 |
| 视频 URL 次日 403 | OSS 签名过期 | 收到 URL 后立即归档到存储层 |
| 向量/排序调用失败 | 多模态需要特定格式 | 参照文档 JSON 示例 |
| TTS 调用失败 | 音色名不匹配 | 使用 Chelsie/Ethan/Serena |
