# OSS 自动清理方案

## 目标

在 20GB/月 的 OSS 存储限制下，自动删除 **未收藏且超过 24 小时** 的图片，保持存储空间动态可用。

## 架构

```
用户收藏 → PATCH /api/assets/[id]/favorite → store.favorited = true
                                              ↓
定时 cron → POST /api/cleanup → cleanupExpiredAssets()
                                    ↓
                        遍历 store.assets
                        删除 favorited=false 且 createdAt > 24h 的资产
                                    ↓
                        OSS 对象删除 + store 记录清理 + task 引用清理
```

兜底：OSS Lifecycle 规则（3 天后自动删除），防止 API 漏删导致存储溢出。

## 配置步骤

### 1. 环境变量

在 `.env` 中添加：

```bash
# 清理 API 鉴权密钥（随机字符串）
CRON_SECRET=your-random-secret-here
```

### 2. 设置 OSS Lifecycle 兜底规则

```bash
# 在服务器上执行（需要 .env 中的 OSS 配置）
node scripts/setup-oss-lifecycle.mjs 3
# 参数：过期天数（默认 3 天，作为 API 清理的兜底）
```

这会在 OSS Bucket 上设置一条规则：`yibai/results/` 前缀下的生成图（含缩略图）3 天后自动删除。

OSS key 路径结构为 `yibai/{bucket}/{userId}/{filename}`（bucket 在 userId 之前），
因此 Lifecycle 可用 `yibai/results/` 固定前缀**精确匹配所有用户的生成图**，
而用户上传素材 `yibai/assets/` 不受影响。

> **重要**：
> - OSS Lifecycle 无法区分收藏/未收藏，也无法精确到小时（最小粒度 1 天）。它只做**兜底**（防止 cron 故障导致存储溢出）。
> - **精确的 48h + 跳过收藏**的清理由 cron 调用 `/api/cleanup` 完成。
> - 因此 Lifecycle 天数应设得比 cron 周期宽松（如 3 天），给 cron 留重试余地。

### 3. 配置定时任务（cron）

在服务器上添加 crontab：

```bash
# 每小时执行一次清理（检查超过 48 小时未收藏的生成图）
0 * * * * curl -s -X POST \
  -H "x-cron-secret: your-random-secret-here" \
  http://localhost:3000/api/cleanup?maxAgeHours=48 \
  >> /var/log/yibai-cleanup.log 2>&1
```

或使用 PM2 的 cron 功能：

```bash
pm2 start "curl -s -X POST -H 'x-cron-secret: your-random-secret-here' http://localhost:3000/api/cleanup?maxAgeHours=48" \
  --name yibai-cleanup \
  --cron "0 * * * *" \
  --no-autorestart
```

> 默认 `maxAgeHours=48`（48 小时）。不传参数也是 48h。

### 4. 验证

手动触发一次清理测试：

```bash
curl -s -X POST \
  -H "x-cron-secret: your-random-secret-here" \
  http://localhost:3000/api/cleanup?maxAgeHours=48 | jq .
```

返回示例：

```json
{
  "success": true,
  "maxAgeHours": 48,
  "deletedAssets": 5,
  "deletedObjects": 10,
  "errors": 0,
  "details": [
    { "assetId": "asset_xxx", "key": "yibai/results/userId/xxx.png" },
    { "assetId": "asset_xxx", "key": "yibai/results/userId/xxx_thumb.webp" }
  ]
}
```

## 清理范围

OSS 上有三类对象，清理**只针对生成图**：

| 类型 | bucket / 路径 | 是否清理 |
|------|--------------|---------|
| 用户上传素材图 | `yibai/{uid}/assets/` | ❌ 保留（同款/重生成依赖原图） |
| AI 生成结果图 | `yibai/{uid}/results/` | ✅ 清理（历史记录里的成品图） |
| 缩略图 | `yibai/{uid}/results/{id}_thumb.webp` | ✅ 随生成图一起删除 |

## 清理逻辑

1. 遍历 `store.assets`，**仅选取生成图**（`fileUrl` 含 `/results/`）
2. 跳过 `favorited === true` 的资产
3. 对 `createdAt` 超过 `maxAgeHours` 的生成图：
   - 删除 OSS 原图（best-effort）
   - 推导并删除对应缩略图 `{assetId}_thumb.webp`（修复孤儿对象）
   - 从 `store.assets` 移除
   - 从 `taskRepo` 移除
   - 清理关联 task 中的 `resultAssetIds` / `results` 引用
   - 如果 task 的结果全部被清空，整个 task 一起删除
4. 持久化 store 到 JSON 文件

> **用户上传的素材图不会被自动清理**，避免破坏依赖原图的功能。

## 收藏机制

- 前端点击星标 → `PATCH /api/assets/[assetId]/favorite` `{ favorited: true }`
- 服务端 `setAssetFavorite()` 更新 `store.assets` 中的 `favorited` 字段
- 前端同时保留 `localStorage` 中的收藏状态（即时 UI 响应 + 降级方案）
- 收藏的资产在 `cleanupExpiredAssets` 中被跳过

## 历史收藏迁移（重要）

旧版本的收藏只存在浏览器 `localStorage`（`fashion_favorites`），服务端不知道。
为避免清理误删用户已收藏的老图，前端在首次加载时会自动把本地收藏列表
一次性同步到服务端：

- 前端：`right-panel.tsx` hydration 后调 `POST /api/assets/favorites/sync` `{ assetIds: [...] }`（本会话只同步一次）
- 服务端：`setAssetsFavoriteBatch()` 批量标记 `favorited=true`，只处理当前用户的资产

> 部署顺序建议：**先上线代码，让用户刷一次页面触发历史收藏同步，再开 cron 定时清理**，
> 避免误删迁移前的收藏图。

## 双保险

| 层级 | 机制 | 精度 | 说明 |
|------|------|------|------|
| 第一层 | cron → /api/cleanup | 精确（48h） | 每小时执行，删除超过 48h 且未收藏的生成图 + 缩略图 |
| 第二层 | OSS Lifecycle | 粗粒度（3天） | 仅 yibai/results/ 前缀兜底，防止 API 故障导致存储溢出 |
