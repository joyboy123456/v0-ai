# 老张 API 余额查询接口调研报告

> 调研时间：2025-07-08
> 调研目标：确认老张 API (laozhang.ai / api.laozhang.ai) 是否提供账户余额查询接口，用于实时获取 7 个 API Key (sk-xxx) 的账户余额/剩余金额，支撑计费体系建设。

---

## 一、核心结论

**老张 API 确实提供余额查询接口**，但有一个关键限制需要注意：

- 余额查询使用的是**系统令牌 (AccessToken)**，**不是**普通模型调用用的 API Key (sk-xxx)。
- 余额查询返回的是**账户级**的剩余额度（quota）和已使用额度（used_quota），**不是按单个 sk-xxx key 维度**返回的。
- 老张 API 的所有 API Key **共享同一个账户余额**（即统一余额池）。文档明确写明"统一余额、统一鉴权"。
- 因此，用 7 个 sk-xxx key 分别查询余额会返回**同一个账户余额值**，无法直接区分每个 key 的消耗。

> ⚠️ **对计费体系的影响**：如果计费体系需要"按每个 sk-xxx key 区分消耗"，不能依赖余额查询接口，而应依赖**调用日志 API**（可按 api_key_id 过滤）或自建本地计费累计。详见下文第六节。

---

## 二、余额查询接口详情

### 2.1 接口信息

| 项目     | 说明                                      |
| ------ | --------------------------------------- |
| 接口 URL | `https://api.laozhang.ai/api/user/self` |
| 请求方法   | `GET`                                   |
| 认证方式   | `Authorization` Header（系统令牌 AccessToken，直接填令牌字符串，**不带 `Bearer` 前缀**） |
| 请求参数   | 无（无 Query 参数，无请求体）                       |
| 响应格式   | JSON（gzip 压缩，cURL 必须加 `--compressed`）    |

> **注意**：这个接口不在 `/v1/` OpenAI 兼容路径下，而是老张自有的 `/api/user/self` 管理接口。

### 2.2 请求 Headers

| Header 名称     | 必填 | 说明                       |
| ------------- | -- | ------------------------ |
| Authorization | 是  | 系统令牌 AccessToken，直接填写 Token 字符串（不要加 `Bearer `） |
| Accept        | 否  | 建议设置为 `application/json` |
| Content-Type  | 否  | 建议设置为 `application/json` |

### 2.3 如何获取 AccessToken

AccessToken 与 sk-xxx 的 API Key **不是同一个东西**，获取步骤：

1. 登录老张 API 控制台：https://api.laozhang.ai/account/profile
2. 打开账户设置页面，点击「系统令牌」
3. 输入账户密码进行身份验证
4. 验证成功后系统显示 AccessToken，立即复制保存（**只显示一次，无法再次查询**）

**安全特性**：
- AccessToken 具有账户完全权限，需妥善保管
- 生成新 Token 会使旧 Token 立即失效
- 一个账户只有一份 AccessToken

---

## 三、响应格式示例

### 3.1 成功响应

```json
{
  "success": true,
  "message": null,
  "data": {
    "id": 19489,
    "username": "demo_user",
    "display_name": "demo_user",
    "role": 1,
    "status": 1,
    "email": "",
    "quota": 24997909,
    "used_quota": 10027091,
    "request_count": 339,
    "group": "svip",
    "ModelFixedPrice": []
  }
}
```

### 3.2 核心字段说明

| 字段名                    | 类型            | 说明                  |
| ---------------------- | ------------- | ------------------- |
| `success`              | Boolean       | 请求是否成功              |
| `message`              | String / null | 错误信息；成功时通常为 `null`  |
| `data.username`        | String        | 用户名                 |
| `data.display_name`    | String        | 显示名称                |
| `data.quota`           | Integer       | **当前剩余额度（可用余额）**，适合做告警阈值 |
| `data.used_quota`      | Integer       | **已使用额度**           |
| `data.request_count`   | Integer       | 累计请求次数              |
| `data.group`           | String        | 当前账户分组              |
| `data.ModelFixedPrice` | Array         | 模型价格列表；只查余额时可忽略     |
| `data.access_token`    | String        | 敏感字段；若返回不要写入普通日志     |

> ⚠️ 接口可能随账户状态返回更多字段。开发时只依赖核心字段，并允许未知字段存在，避免新增字段导致解析失败。

### 3.3 额度与金额换算

接口返回的 `quota` 单位是「额度」，不是直接的美元金额。换算规则：

| 计算项     | 公式                            | 示例                                            |
| ------- | ----------------------------- | --------------------------------------------- |
| 剩余美元余额  | `quota ÷ 500000`              | `24997909 ÷ 500000 = 49.995818`，约 `50.00 USD` |
| 已使用美元额度 | `used_quota ÷ 500000`         | `10027091 ÷ 500000 = 20.054182`，约 `20.05 USD` |
| 历史总额度   | `(quota + used_quota) ÷ 500000` | 示例约 `70.05 USD`                             |

**换算系数**：`500,000 额度 = 1 USD`

> 余额展示可按上述公式计算；模型实际扣费仍以当前模型价格、账户分组、调用日志和控制台展示为准。生产告警建议同时保存原始 `quota` 和换算后的美元金额，避免丢失精度。

### 3.4 错误响应

**HTTP 401 - 认证失败**
```json
{
  "success": false,
  "message": "Unauthorized"
}
```
常见原因：Authorization 为空、令牌复制不完整、令牌已失效，或**误用了普通 API Key**（sk-xxx 不能用于此接口）。

**HTTP 403 - 权限不足**
```json
{
  "success": false,
  "message": "Forbidden"
}
```
常见原因：当前令牌无权访问账户信息接口，或账户状态需人工确认。

---

## 四、代码示例

### 4.1 cURL

```bash
export LAOZHANG_ACCESS_TOKEN='YOUR_ACCESS_TOKEN'

curl --compressed -s 'https://api.laozhang.ai/api/user/self' \
  -H 'Accept: application/json' \
  -H "Authorization: ${LAOZHANG_ACCESS_TOKEN}" \
  -H 'Content-Type: application/json'
```

> `--compressed` 必须加，否则 gzip 响应会显示为乱码，`jq` 会报 `Invalid numeric literal`。

### 4.2 cURL + jq 提取核心信息

```bash
curl --compressed -s 'https://api.laozhang.ai/api/user/self' \
  -H 'Accept: application/json' \
  -H "Authorization: $LAOZHANG_TOKEN" \
  -H 'Content-Type: application/json' | \
  jq '.data | {
    quota,
    remaining_usd: (.quota / (50 * 10000)),
    used_quota,
    used_usd: (.used_quota / (50 * 10000)),
    request_count
  }'
```

### 4.3 Python

```python
import os
import requests

token = os.environ["LAOZHANG_ACCESS_TOKEN"]
response = requests.get(
    "https://api.laozhang.ai/api/user/self",
    headers={
        "Accept": "application/json",
        "Authorization": token,
        "Content-Type": "application/json",
    },
    timeout=10,
)
response.raise_for_status()

payload = response.json()
account = payload["data"]
quota_unit_per_usd = 50 * 10000  # 500000

print("quota:", account["quota"])
print("remaining_usd:", round(account["quota"] / quota_unit_per_usd, 2))
print("used_quota:", account["used_quota"])
print("used_usd:", round(account["used_quota"] / quota_unit_per_usd, 2))
print("request_count:", account["request_count"])
print("group:", account.get("group"))
```

> Python `requests` 库会自动处理 gzip 解压，无需额外配置。

### 4.4 Node.js

```javascript
const token = process.env.LAOZHANG_ACCESS_TOKEN;

const response = await fetch("https://api.laozhang.ai/api/user/self", {
  method: "GET",
  headers: {
    Accept: "application/json",
    Authorization: token,
    "Content-Type": "application/json",
  },
});

if (!response.ok) {
  throw new Error(`Balance query failed: HTTP ${response.status}`);
}

const payload = await response.json();
const account = payload.data;
const quotaUnitPerUsd = 50 * 10000;

console.log({
  quota: account.quota,
  remaining_usd: Number((account.quota / quotaUnitPerUsd).toFixed(2)),
  used_quota: account.used_quota,
  used_usd: Number((account.used_quota / quotaUnitPerUsd).toFixed(2)),
  request_count: account.request_count,
  group: account.group,
});
```

---

## 五、关于 OpenAI 兼容的余额查询接口

调研了老张 API 是否兼容 OpenAI 的 `/v1/dashboard/billing/credit_grants` 或 `/dashboard/billing/subscription` 端点。

**结论：老张 API 不兼容 OpenAI 的 dashboard/billing 端点。**

依据：老张 API 的《API 开发文档》(https://docs.laozhang.ai/api-manual) 在「功能支持范围」中明确列出**不支持的功能**：

- ❌ 微调接口（Fine-tuning）
- ❌ Files 管理接口
- ❌ 组织管理接口
- ❌ **计费管理接口**

也就是说，OpenAI 那套 `/v1/dashboard/billing/*` 路径在老张 API 上**不可用**。老张用自己的 `/api/user/self`（非 OpenAI 兼容路径）来提供账户/余额信息。

> 对比：其他中转商（如 API2D、智增增）为兼容部分应用，额外实现了 `/dashboard/billing/credit_grants` 端点。老张 API 没有采用这种兼容做法。

---

## 六、按 Key 维度计费的替代方案

由于 7 个 sk-xxx key 共享同一个账户余额，余额查询接口只能拿到**账户总额度**，无法直接拆分到每个 key。要做按 key 的计费体系，建议以下方案：

### 方案 A：调用日志 API（推荐）

老张 API 提供调用日志查询接口，可按 `api_key_id` 过滤，拿到每个 key 的逐次调用明细和费用：

```python
import requests

api_url = "https://api.laozhang.ai/v1/usage/logs"
headers = {"Authorization": "Bearer YOUR_API_KEY"}  # 用 sk-xxx

params = {
    "api_key_id": "key_123456",       # 按 key 过滤
    "start_date": "2024-01-01",
    "end_date": "2024-01-31",
    "limit": 100
}
response = requests.get(api_url, headers=headers, params=params)
logs = response.json()
for log in logs['data']:
    print(f"Time: {log['timestamp']}")
    print(f"Model: {log['model']}")
    print(f"Tokens: {log['tokens']}")
    print(f"Cost: ${log['cost']}")
```

**日志字段**：timestamp、model、tokens、cost 等。日志保留期：标准用户 30 天、专业用户 90 天、企业用户 1 年。

> ⚠️ 此 `/v1/usage/logs` 端点在文档 FAQ 中出现（来源：https://docs.laozhang.ai/en/faq/call-logs），但**未在正式 API Reference 中明确列出**，建议先小范围验证可用性和字段稳定性后再用于生产。

### 方案 B：自建本地计费累计（最可靠）

在每次调用图像生成接口时，从响应中提取 token 用量并按模型价格本地累计，不依赖上游日志接口：

1. 每次调用 `POST /v1/images/generations` 后，记录：key、模型、时间、token 数、计算费用
2. 定期用余额查询接口 `/api/user/self` 做总额校准（账户总消耗 = 所有 key 消耗之和）
3. 优点：不依赖上游日志 API 的稳定性，实时性最好；缺点：需要维护模型价格表

### 方案 C：为每个 key 设置余额限制

老张控制台在创建新 API Key 时支持为每个 KEY 设置专门的余额限制和有效期。可配合方案 B：
- 在控制台为 7 个 key 分别设置额度上限，做硬隔离
- 业务侧用方案 B 做软计费统计

### 方案 D：控制台页面爬取（不推荐）

理论上可爬取 https://api.laozhang.ai/log 页面按 key 过滤的日志，但：
- 需要处理登录态/Cookie，维护成本高
- 易触发风控
- 数据已有 `/v1/usage/logs` API 可获取，没必要爬页面

**仅当 API 方案全部不可用时才作为兜底**。

---

## 七、监控接入建议（官方）

- 用环境变量或密钥管理服务保存 `LAOZHANG_ACCESS_TOKEN`
- 设置合理超时时间（如 10 秒）
- 避免高频轮询，余额监控不需要秒级请求
- 告警里记录 `quota`、换算后的 `remaining_usd`、`used_quota`、`request_count`、请求时间和 HTTP 状态码
- 不要在日志中记录完整 `Authorization`、`access_token` 或账户敏感字段

---

## 八、关键文档来源

| 内容 | URL |
| --- | --- |
| 余额查询 FAQ（中文） | https://docs.laozhang.ai/faq/balance-query-api |
| 余额查询 FAQ（英文） | https://docs.laozhang.ai/en/faq/balance-query-api |
| 余额查询 API 开发者文档 | https://docs.laozhang.ai/api-capabilities/balance-query |
| API 开发手册（功能支持范围） | https://docs.laozhang.ai/api-manual |
| API 密钥管理 | https://docs.laozhang.ai/faq/token-management |
| 调用记录查看 | https://docs.laozhang.ai/faq/call-logs |
| 文档索引 | https://docs.laozhang.ai/llms.txt |
| 控制台 - 账户设置 | https://api.laozhang.ai/account/profile |
| 控制台 - 令牌管理 | https://api.laozhang.ai/token |
| 控制台 - 日志 | https://api.laozhang.ai/log |

---

## 九、落地建议摘要

1. **账户总余额监控**：用 `GET https://api.laozhang.ai/api/user/self` + AccessToken，定时（如每 5 分钟）拉取账户级 `quota` / `used_quota`，换算成 USD 做总余额告警。
2. **按 key 计费**：余额接口无法按 key 拆分。优先采用「方案 B：自建本地计费累计」（每次图像生成调用后本地记账），辅以「方案 A：`/v1/usage/logs`」做对账校验。
3. **认证分离**：AccessToken（用于余额查询，账户级，需密码验证获取，妥善保管）与 sk-xxx API Key（用于模型调用，可在控制台令牌页创建多个）是两套独立凭证，不要混用。
4. **gzip 处理**：余额接口返回 gzip 压缩内容，cURL 必须加 `--compressed`，Python requests / Node fetch 会自动解压。
