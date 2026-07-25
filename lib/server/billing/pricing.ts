/**
 * 图像生成模型单价表（老张 API 按次计费）。
 *
 * 数据来源：lib/server/laozhang-image-adapter.ts 注释 + docs/LAOZHANG_API_SETUP.md，
 * 并经 /api/user/self 返回的账户级 ModelFixedPrice 校准（2026-07-08）。
 * 老张 API 所有模型均按张计费，以下为 USD/张。
 */

/** 模型 ID → 单价（USD/张）。键为小写。 */
const MODEL_UNIT_PRICE_USD: Record<string, number> = {
  // Gemini 系列（Google）
  'gemini-3.1-flash-image-preview': 0.055,
  'gemini-3-pro-image-preview': 0.09,
  'gemini-2.5-flash-image': 0.02,

  // GPT 系列（OpenAI）
  'gpt-image-2': 0.03,
  'gpt-image-2-vip': 0.03,

  // SeeDream 系列（字节跳动火山方舟）
  'seedream-4-5-251128': 0.045,
  'seedream-4-0-250828': 0.035,

  // 豆包 Seedream 别名（映射到 SeeDream 4.5）
  'doubao-seedream-4.5': 0.045,
  'doubao-seedream-5.0-lite': 0.045,
  'doubao-seedream-4-5-251128': 0.045,
  'doubao-seedream-5-0-260128': 0.045,

  // Grsai Nano Banana 系列（按 grsai 官方积分价中位换算 USD，1USD≈7RMB）
  // nano-banana-2-lite: ￥0.022~0.044/张 → 中位 ￥0.033 → ~$0.005
  'nano-banana-2-lite': 0.005,
  // nano-banana-2: ￥0.06~0.12/张 → 中位 ￥0.09 → ~$0.013
  'nano-banana-2': 0.013,
  // nano-banana-pro: ￥0.09~0.18/张 → 中位 ￥0.135 → ~$0.019
  'nano-banana-pro': 0.019,
}

/**
 * 当前实际使用的模型白名单（与 lib/types.ts 的 SELECTABLE_FASHION_MODELS 一致）。
 *
 * getModelPrices 只返回这些模型，单价表不会展示已下线/灰度中的模型。
 * getUnitPriceUsd 仍保留全部已知模型单价，用于 byModel 动态聚合时正确计价。
 */
const ACTIVE_MODEL_IDS: readonly string[] = [
  'gemini-3.1-flash-image-preview',
  'gpt-image-2',
  'gemini-3-pro-image-preview',
  'nano-banana-2-lite',
  'nano-banana-2',
  'nano-banana-pro',
]

/** 未知模型的默认单价（保守取主力模型价格）。 */
const DEFAULT_UNIT_PRICE_USD = 0.055

/** 老张 API 模型 ID 映射（与 laozhang-image-adapter.ts 一致）。 */
const MODEL_ID_MAPPING: Record<string, string> = {
  'doubao-seedream-4.5': 'seedream-4-5-251128',
  'doubao-seedream-5.0-lite': 'seedream-4-5-251128',
  'doubao-seedream-4-5-251128': 'seedream-4-5-251128',
  'doubao-seedream-5-0-260128': 'seedream-4-5-251128',
}

/**
 * 根据模型 ID 获取单价（USD/张）。
 *
 * 查找顺序：
 * 1. 原始模型 ID（小写）直接命中
 * 2. 经 MODEL_ID_MAPPING 映射后的模型 ID
 * 3. 回退到默认单价
 */
export function getUnitPriceUsd(model: string): number {
  const original = model.trim().toLowerCase()
  const direct = MODEL_UNIT_PRICE_USD[original]
  if (direct !== undefined) return direct

  const mapped = MODEL_ID_MAPPING[original]
  if (mapped) {
    const mappedPrice = MODEL_UNIT_PRICE_USD[mapped.toLowerCase()]
    if (mappedPrice !== undefined) return mappedPrice
  }

  return DEFAULT_UNIT_PRICE_USD
}

/**
 * 返回当前实际使用模型的单价表（用于前端展示）。
 *
 * 只返回 ACTIVE_MODEL_IDS 中的模型，按白名单顺序排列。
 * 不展示已下线/灰度中的模型（如豆包、即梦），避免单价表过长。
 */
export function getAllModelPrices(): Array<{ model: string; unitPriceUsd: number }> {
  return ACTIVE_MODEL_IDS.map((model) => ({
    model,
    unitPriceUsd: MODEL_UNIT_PRICE_USD[model] ?? DEFAULT_UNIT_PRICE_USD,
  }))
}
