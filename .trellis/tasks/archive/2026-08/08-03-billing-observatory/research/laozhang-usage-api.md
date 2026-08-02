# 老张 API 历史用量接口调研报告

> 调研时间：2026-08-03
> 调研方式：用 .env.local 的 LAOZHANG_ACCESS_TOKEN 实测探测

---

## 一、核心结论

老张是 new-api 体系，AccessToken 除已有的 `/api/user/self`（余额）外，额外有两个可用接口支撑历史查询：

1. **`/api/data/self`** — 按天×按模型聚合统计（实际扣费）
2. **`/api/log/self`** — 逐条调用流水（含 key 维度）

FAQ 文档提到的 `/v1/usage/logs` **实测 404 不存在**。

---

## 二、`/api/data/self` — 按天聚合

### 请求

```
GET https://api.laozhang.ai/api/data/self?start_timestamp={unix秒}&end_timestamp={unix秒}
Authorization: {LAOZHANG_ACCESS_TOKEN}
```

### 响应

```json
{
  "data": [
    {
      "date": "2026-07-14",
      "modelName": "gemini-3.1-flash-image-preview",
      "sumQuota": 7507500,
      "sumUsd": 15.015,
      "userId": "70529",
      "username": "engjin",
      "ip": "...",
      "remote_ip": "..."
    }
  ],
  "message": "",
  "success": true
}
```

### 字段说明

| 字段 | 说明 |
|---|---|
| `date` | YYYY-MM-DD（账户时区 UTC 口径） |
| `modelName` | 模型 ID |
| `sumQuota` | 当天该模型消耗总额度（原始单位） |
| `sumUsd` | 当天该模型消耗总额 USD（已换算，500000 额度 = 1 USD） |

### 实测

请求 `start_timestamp=1782864000&end_timestamp=1784246400`（7/4~7/14）返回 12 行，每天一行一个模型。一次请求拿整段范围，无需翻页。

**调用次数推算**：上游按次固定计价（`billing_type: "by_count"`），`calls = sumQuota ÷ 单次固定额度`。例如 gemini-3.1-flash-image-preview 单次 27500 额度，sumQuota=7507500 → 273 次。精确推算。

---

## 三、`/api/log/self` — 逐条流水

### 请求

```
GET https://api.laozhang.ai/api/log/self?p={页码}&start_timestamp={unix秒}&end_timestamp={unix秒}
Authorization: {LAOZHANG_ACCESS_TOKEN}
```

### 响应

```json
{
  "data": [
    {
      "id": 0,
      "request_id": "2026072106294573664045596e93ae3AXqGX63L",
      "created_at": 1784615432,
      "type": 2,
      "content": "模型按次使用固定价格 0.055，分组倍率 1，充值转换率 1，用户折扣率 1.00，用时 43秒",
      "username": "engjin",
      "token_name": "3",
      "model_name": "gemini-3.1-flash-image-preview",
      "quota": 27500,
      "prompt_tokens": 694,
      "completion_tokens": 2824,
      "duration_for_view": 43,
      "other": "{\"billing_type\":\"by_count\",\"image\":true,\"image_input\":258,\"image_output\":2520,...}"
    }
  ],
  "message": "",
  "success": true
}
```

### 关键字段

| 字段 | 说明 |
|---|---|
| `created_at` | Unix 秒时间戳 |
| `model_name` | 模型 ID |
| `quota` | 本次扣费额度（27500 = $0.055） |
| `token_name` | 哪个 sk-xxx key（如 "3" = laozhang-gemini-3） |
| `prompt_tokens` / `completion_tokens` | token 用量 |
| `duration_for_view` | 耗时秒 |
| `content` | 计费明细文字 |
| `type` | 2 = 消费 |

### 分页限制

- **页大小固定 10 条**（请求 page_size=100 仍返回 10，请求 page_size=1 也返回 10）
- **无 total 字段** → 无法知道总数
- **翻页策略**：持续请求 p=1,2,3... 直到返回 < 10 条（不满页 = 最后一页）
- 一天约百次调用 → 10+ 页，需前端"加载更多"分批拉

### 时间范围过滤

`start_timestamp`/`end_timestamp` 用 Unix 秒。实测请求 `start_timestamp=1577836800&end_timestamp=1783296000` 正确返回了该范围内的数据。

---

## 四、数据保留期

- 账户 2026-07-04 注册，至今全量数据可查
- 按 new-api 惯例：标准用户日志保留 30 天，专业用户 90 天，企业用户 1 年
- 本账户 user_type=2（专业？），保守按 30 天规划 → "近30天"是实际上限

---

## 五、认证

两个接口均用 `LAOZHANG_ACCESS_TOKEN`（系统令牌，不带 Bearer 前缀），与现有 `/api/user/self` 余额查询一致。已验证可用。

---

## 六、Grsai 渠道限制

Grsai 仅有 `getCredits` 余额接口（剩余积分），无任何历史/日志接口。历史消耗只能靠本地 `billing-events.jsonl`（7/8 计费上线起，固定单价估算）。

本地事件按 `providerId` 前缀区分渠道：
- `grsai-1` ~ `grsai-5` → Grsai 渠道
- `laozhang-gemini-1` ~ `laozhang-gemini-6`（早期 `laozhang-1`~`laozhang-6`）→ 老张渠道

---

## 七、代码示例

### Node.js — daily 聚合

```typescript
const token = process.env.LAOZHANG_ACCESS_TOKEN
const url = `https://api.laozhang.ai/api/data/self?start_timestamp=${startSec}&end_timestamp=${endSec}`
const res = await fetch(url, {
  headers: { Authorization: token, Accept: 'application/json' },
  cache: 'no-store',
})
const payload = await res.json()
// payload.data: Array<{ date, modelName, sumQuota, sumUsd }>
```

### Node.js — 逐条流水

```typescript
const url = `https://api.laozhang.ai/api/log/self?p=${page}&start_timestamp=${startSec}&end_timestamp=${endSec}`
const res = await fetch(url, {
  headers: { Authorization: token, Accept: 'application/json' },
  cache: 'no-store',
})
const payload = await res.json()
// payload.data: Array<{ created_at, model_name, quota, token_name, ... }>
// hasMore = payload.data.length === 10
```
