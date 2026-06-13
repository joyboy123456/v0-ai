# 老张 API 接入指南

## 📋 概述

本项目已完成老张 API 的接入，**所有图像生成模型**（包括 Gemini、GPT、SeeDream）均已切换到老张 API。

🎉 **重大发现**：老张 API 不仅支持 Gemini 和 GPT 模型，还支持字节跳动的 SeeDream 系列！是真正的**全能渠道商**，一个 API Key 搞定所有模型！

## ✅ 支持的模型

老张 API 是**全能渠道商**，支持所有主流图像生成模型！

### Gemini 系列（Google）

| 模型 ID | 别名 | 价格 | 状态 |
|---------|------|------|------|
| `gemini-3.1-flash-image-preview` | Nano Banana2 | $0.055/张 | ✅ 已接入 |
| `gemini-3-pro-image-preview` | Nano Banana Pro | $0.09/张 | ✅ 已接入 |
| `gemini-2.5-flash-image` | Nano Banana | $0.025/张 | ✅ 已接入 |

### GPT 系列（OpenAI）

| 模型 ID | 别名 | 价格 | 状态 |
|---------|------|------|------|
| `gpt-image-2` | GPT Image 2 | $0.03/张 | ✅ 已接入 |
| `gpt-image-2-vip` | GPT Image 2 VIP | $0.03/张 | ✅ 已接入 |

### SeeDream 系列（字节跳动火山方舟）

| 模型 ID | 别名 | 价格 | 状态 |
|---------|------|------|------|
| `seedream-4-5-251128` | SeeDream 4.5 | $0.045/张 | ✅ 已接入 |
| `seedream-4-0-250828` | SeeDream 4.0 | $0.035/张 | ✅ 已接入 |

🎉 **全能渠道**：老张 API 一个渠道支持所有模型，无需多家对接！

## 🚀 配置步骤

### 1. 获取老张 API Key

1. 访问 [老张 API 控制台](https://api.laozhang.ai/)
2. 注册/登录账号
3. 创建 API 令牌，**选择"按次计费"模式**
4. 复制生成的 API Key（格式：`sk-xxx`）

⚠️ **重要**：必须在控制台配置"按次计费"模式，否则 API 调用会失败！

### 2. 配置环境变量

编辑 `.env.local`，将以下配置中的 `YOUR_LAOZHANG_API_KEY` 替换为你的实际 API Key：

```bash
# 在 IMAGE_PROVIDERS 中找到 laozhang 相关配置
# 将所有 "apiKey": "YOUR_LAOZHANG_API_KEY" 替换为你的 Key

# 同时更新全局配置
LAOZHANG_API_KEY=sk-你的实际Key
```

### 3. 确认 IPM/RPM 限制

⚠️ 老张 API 文档未明确提供速率限制，需要：

1. 联系老张 API 客服确认你的账号 IPM（每分钟图片数）和 RPM（每分钟请求数）限制
2. 更新 `.env.local` 中的配置：

```bash
LAOZHANG_IMAGE_IPM=60  # 替换为实际值
LAOZHANG_IMAGE_RPM=300 # 替换为实际值
```

3. 同时更新 `IMAGE_PROVIDERS` 中每个 laozhang provider 的 `maxIpm` 和 `maxRpm`

### 4. 启用/禁用 Provider

默认配置：
- ✅ **已启用**：`laozhang-gemini-flash`（Gemini 主力模型，$0.055/张）
- ✅ **已启用**：`laozhang-seedream-4.5`（SeeDream 最新版，$0.045/张）
- ❌ **已禁用**：`laozhang-seedream-4.0`（SeeDream 稳定版，$0.035/张）
- ❌ **已禁用**：`laozhang-gemini-pro`（Pro 版本，$0.09/张）
- ❌ **已禁用**：`laozhang-gpt-image-2`（GPT 模型，$0.03/张）

根据需要修改 `enabled` 字段来启用/禁用特定 provider。

## 📊 成本对比

| 渠道 | 模型 | 老张价格 | 原价格 | 节省 |
|------|------|---------|--------|------|
| 老张 API | Nano Banana2 | $0.055/张 | - | - |
| 老张 API | Nano Banana Pro | $0.09/张 | $0.24/张 | 62.5% |
| 老张 API | GPT Image 2 | $0.03/张 | - | - |
| Google 官方 | Gemini 3.1 Flash | - | 按 Token 计费 | - |

## 🔧 技术实现

### 架构设计

```
用户请求
    ↓
provider-image-router.ts (路由层)
    ↓
laozhang-image-adapter.ts (老张适配器)
    ↓
runQiniuImageEdit (复用七牛逻辑)
    ↓
老张 API
```

### 代码结构

1. **新增文件**：
   - `lib/server/laozhang-image-adapter.ts`：老张 API 适配器
   - `docs/LAOZHANG_API_SETUP.md`：本配置文档

2. **修改文件**：
   - `lib/server/provider-image-router.ts`：添加 `laozhang` 路由
   - `lib/server/image-provider-pool.ts`：添加 `laozhang` provider 类型
   - `.env.local`：更新 provider 配置

### 接口兼容性

老张 API 接口格式与七牛云**完全一致**：

- **Gemini 模型**：使用 Google 原生格式
  - 端点：`/v1beta/models/{model}:generateContent`
  - 认证：`x-goog-api-key` Header

- **GPT 模型**：使用 OpenAI Images API
  - 端点：`/v1/images/generations` 和 `/v1/images/edits`
  - 认证：`Authorization: Bearer` Header

因此直接复用了 `qiniu-image-adapter.ts` 的逻辑，只需改变 `baseUrl`。

## ✅ 验证清单

- [ ] 已获取老张 API Key
- [ ] 已在控制台配置"按次计费"模式
- [ ] 已更新 `.env.local` 中的所有 `YOUR_LAOZHANG_API_KEY`
- [ ] 已确认并配置 IPM/RPM 限制
- [ ] 已测试图片生成功能
- [ ] 即梦模型仍使用原渠道（未受影响）

## 🐛 故障排查

### 问题 1：API 调用失败，返回计费模式错误

**原因**：未在控制台配置"按次计费"模式

**解决**：
1. 登录 [老张 API 控制台](https://api.laozhang.ai/)
2. 找到令牌设置
3. 选择"按次计费"或"按量优先"模式

### 问题 2：速率限制错误（429）

**原因**：IPM/RPM 配置过高，超过账号限制

**解决**：
1. 联系老张 API 客服确认实际限制
2. 降低 `.env.local` 中的 `maxIpm` 和 `maxRpm`

### 问题 3：部分模型不工作

**原因**：模型 ID 拼写错误或老张 API 不支持

**解决**：
1. 检查模型 ID 是否正确（参考本文档"支持的模型"章节）
2. 确认模型已在老张 API 文档中列出

## 📚 相关文档

- [老张 API 官方文档](https://docs.laozhang.ai/)
- [Nano Banana Pro 文档](https://docs.laozhang.ai/api-capabilities/nano-banana-pro-image)
- [Nano Banana2 文档](https://docs.laozhang.ai/api-capabilities/nano-banana2-image)
- [GPT Image 2 文档](https://docs.laozhang.ai/api-capabilities/gpt-image-2)
- [SeeDream 文档](https://docs.laozhang.ai/api-capabilities/seedream-image)

---

**最后更新**：2026-06-13
**维护者**：哈雷酱（本小姐亲自完成的适配！(￣▽￣)ノ）
