# classify 接口与 SegmentCloth 复用盘点（研究笔记）

> 目标：为 `POST /api/garment-detail/classify`（PRD §7.2）与细节输出位规划（PRD §5.3）提供现有代码事实。
> 代码基线：`preview` 分支工作区 `/opt/yibai-fission`（2026-08-16 时点）。

---

## 1. `lib/server/aliyun-cutout-adapter.ts`（1067 行）—— SegmentCloth 调用细节

### 1.1 7 类常量（L14-22）

```ts
export const CLOTH_CLASSES: readonly ClothCategory[] = [
  'tops', 'coat', 'skirt', 'pants', 'bag', 'shoes', 'hat',
]
```

与 PRD §7.2「一次请求获取 tops、coat、skirt、pants、bag、shoes、hat」完全一致，可直接复用。`ClothCategory` 类型来自 `lib/types.ts`。

### 1.2 请求构造（L668-681）

```ts
function buildSegmentClothClassParameters(
  imageUrl: string,
  classes: readonly string[],
): Record<string, string> {
  // OutMode=1 表示按 ClothClass.N 指定的类别组合分割；ReturnForm 缺省返回四通道 PNG。
  const parameters: Record<string, string> = {
    ImageURL: imageUrl,
    OutMode: '1',
  }
  classes.forEach((clothClass, index) => {
    parameters[`ClothClass.${index + 1}`] = clothClass
  })
  return parameters
}
```

注意：**入参是 ImageURL 而非图片字节**——调用方必须先把图传到 viapi 临时桶（`uploadViapiTemporaryInput`，L556-604：`GetOssStsToken` RPC 拿 STS → `ali-oss` put 到 `viapi-customer-temp` 桶 → 返回 `https://viapi-customer-temp.oss-cn-shanghai.aliyuncs.com/{accessKeyId}/{uuid}-cutout-input.jpg`）。该临时 URL 不能给浏览器（匿名 403，见 AGENTS.md 约定），但阿里云 imageseg 服务端可拉取。classify 链路因此需要：读素材字节 → `prepareAliyunCutoutInput`（≤3MB、≤1999px JPEG 压缩，L295-392）→ 上传临时桶 → SegmentCloth。

### 1.3 调用入口与响应解析（L632-713）

```ts
/** 解析 SegmentCloth 的 Data 载荷，把 ClassUrl 映射为 类别 → URL。 */
export function parseSegmentClothClassUrls(
  data: Record<string, unknown>,
  requestId: string,
  classes: readonly string[] = [],
): SegmentClothByClassResult {
  const elements = Array.isArray(data.Elements) ? data.Elements : []
  const classUrls: Record<string, string> = {}
  for (const rawElement of elements) {
    const element = readObject(rawElement)
    const classUrl = readObject(element?.ClassUrl)
    if (!classUrl) continue
    for (const [category, rawUrl] of Object.entries(classUrl)) {
      const url = readString(rawUrl)
      if (url && classUrls[category] === undefined) classUrls[category] = url
    }
  }
  if (Object.keys(classUrls).length > 0) return { classUrls, requestId }

  // ClassUrl 缺失或为空：回退取 Elements[].ImageURL（合并图），所有请求类别共用同一 URL，标记 fallback。
  const mergedUrl = elements
    .map((element) => readString(readObject(element)?.ImageURL))
    .find((url): url is string => Boolean(url))
  if (!mergedUrl) return { classUrls, requestId }
  const fallbackClassUrls: Record<string, string> = { ...classUrls }
  for (const clothClass of classes) {
    if (fallbackClassUrls[clothClass] === undefined) fallbackClassUrls[clothClass] = mergedUrl
  }
  return { classUrls: fallbackClassUrls, requestId, fallback: true }
}
```

```ts
export async function segmentClothByClass(
  imageUrl: string,
  config: AliyunCutoutConfig,
  classes: readonly ClothCategory[],
  dependencies: { callRpc?: typeof callAliyunRpc } = {},
): Promise<SegmentClothByClassResult> {
  const callRpc = dependencies.callRpc ?? callAliyunRpc
  const response = await callRpc({
    endpoint: config.imagesegEndpoint,
    action: 'SegmentCloth',
    version: ALIYUN_IMAGESEG_VERSION,        // '2019-12-30'
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    parameters: buildSegmentClothClassParameters(imageUrl, classes),
    timeoutMs: config.timeoutMs,
  })
  const data = readObject(response.payload.Data)
  if (!response.requestId) { throw new AliyunCutoutProviderError({ category: 'invalid_result', ... }) }
  return parseSegmentClothClassUrls(data ?? {}, response.requestId, classes)
}
```

`SegmentClothByClassResult = { classUrls: Record<string,string>, requestId: string, fallback?: boolean }`（L30-34）。**`parseSegmentClothClassUrls` 就是 PRD §7.2 所说「现有适配器已经支持按类别解析 ClassUrl」的可复用 helper**；classify 只需消费 `classUrls` 的 key 集合（哪些类别有结果）+ 可选下载各类别结果图算面积。⚠️ fallback 模式下所有类别共用合并图 URL，**此时不能按 key 集合判断类别存在性**——classify 应检测 `fallback === true` 并另行处理（下载合并图无类别区分度，宜降级为低置信或下载后无差别）。

### 1.4 底层 RPC（`callAliyunRpc`，L231-293）

- 阿里云 POP 签名：HMAC-SHA1，`buildAliyunRpcSignature`（L183-215）+ RFC3986 编码 `aliyunPercentEncode`（L177-181）。
- POST 到 `${endpoint}/?${signedQuery}`，经 `proxyFetch`（`lib/server/proxy-fetch.ts`——就是裸 `fetch` 的透传封装，L15 `export const proxyFetch: typeof fetch = (input, init) => fetch(input, init)`；注意文件头警告：不要挂外部 undici Agent）。
- 超时：调用方 `timeoutMs` → `AbortController` + `setTimeout(abort)`（L258-278）；abort/超时报 `category: 'timeout'`（retryable: true）。
- 响应非 2xx 或带 `Code` → `createRpcResponseError`（L974-1033）：401/403/auth → `auth`（不可重试）；429/throttl → `rate_limit`；notfound/no-subject → `no_subject`；invalid → `invalid_input`；其余 4xx → `invalid_input`；默认 `server_error`（可重试）。

### 1.5 配置 / 环境变量（L880-927）

```ts
export function readAliyunCutoutConfig(): AliyunCutoutConfig {
  const credentials = readAliyunCredentialPair()
  if (!credentials) throw new AliyunCutoutProviderError({ category: 'config', ... })
  return {
    ...credentials,
    imagesegEndpoint: process.env.ALIYUN_VIAPI_IMAGESEG_ENDPOINT?.trim() || 'https://imageseg.cn-shanghai.aliyuncs.com',
    viapiUtilsEndpoint: process.env.ALIYUN_VIAPI_UTILS_ENDPOINT?.trim() || 'https://viapiutils.cn-shanghai.aliyuncs.com',
    timeoutMs: readPositiveInteger(process.env.ALIYUN_CUTOUT_TIMEOUT_MS, 60_000),
  }
}
```

凭证按序回退（L910-920）：`ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET` → `ALIYUN_VIAPI_ACCESS_KEY_ID/SECRET` → `OSS_ACCESS_KEY_ID/SECRET`。Region 固定 `cn-shanghai`（L42）。

**超时差异**：适配器默认 60s（L49 `DEFAULT_TIMEOUT_MS`），而 PRD §6.2 要求 `GARMENT_DETAIL_CLASSIFY_TIMEOUT_MS=15000`、§18.1 分类 P95 ≤8s / 15s 超时降级。classify 服务应在自己的 config 上覆盖 `timeoutMs`（`AliyunCutoutConfig` 是普通对象，`{ ...readAliyunCutoutConfig(), timeoutMs: 15000 }` 即可），不要改全局默认影响抠图会话。

### 1.6 错误类型（L52-89）

`AliyunCutoutProviderError extends Error`，字段：`category: AliyunCutoutErrorCategory`（`'config'|'auth'|'invalid_input'|'no_subject'|'rate_limit'|'timeout'|'network'|'server_error'|'invalid_result'`）、`retryable: boolean`、`httpStatus?`、`upstreamCode?`、`requestId?`、`cause?`。classify 的 `CLASSIFY_FAILED` 映射可直接消费 `category`/`retryable`/`requestId`（PRD §16 错误表含 requestId 字段）。

---

## 2. `lib/server/cutout-session-service.ts`（1183 行）—— 7 类调用模式参考

`executeGarmentPrepare`（L333 起）是一次完整的「读素材 → 预处理 → 临时上传 → SegmentCloth 7 类 → 逐类别下载结果图」流水线，classify 可裁剪复用：

```ts
// L342-379：读源图字节 → 读尺寸 → prepareAliyunCutoutInput（≤3MB JPEG）→ uploadViapiTemporaryInput
sourceBuffer = await dependencies.readSourceAsset(sourceAsset)       // readAssetImageBuffer
config = dependencies.readConfig()                                   // readAliyunCutoutConfig
dimensions = await dependencies.readCanvasDimensions(sourceBuffer)   // readSourceCanvasDimensions
prepared = await dependencies.prepareInput({ sourceBuffer, ... })    // prepareAliyunCutoutInput
inputUrl = await dependencies.uploadInput(prepared, config)          // uploadViapiTemporaryInput

// L384-416：一次 SegmentCloth 调 7 类；单类别无结果只 warn 跳过，整次失败也跳过
try {
  const cloth = await dependencies.segmentClothByClass(inputUrl, config, CLOTH_CLASSES)
  for (const category of CLOTH_CLASSES) {
    const url = cloth.classUrls[category]
    if (!url) {
      console.warn('[cutout-session] 类别无分割结果，跳过', { category, requestId: cloth.requestId, fallback: cloth.fallback === true })
      continue
    }
    await prepareCategoryMask({ category, url, requestId: cloth.requestId, prepared, config, ... })
  }
} catch (error) {
  console.warn('[cutout-session] SegmentCloth 调用失败，跳过全部服饰类别', ...)
}
```

依赖注入模式（`CutoutSessionDependencies`，L161-231）值得 classify 服务照搬——每个外部调用都可注入替身，单测无需真连阿里云。

**素材所有权校验**（`createGarmentCutoutSession` L293-296）：

```ts
const sourceAsset = await dependencies.getAssetById(normalizedAssetId)   // getAsset from task-store
if (!sourceAsset || sourceAsset.userId !== normalizedUserId) {
  throw assetNotFoundError()   // L1102-1110：code 'asset_not_found', status 404, '未找到对应的图片资产或无权操作'
}
```

与 PRD §7.2 安全规则「素材不存在或越权统一返回 404」一致，classify 直接复用该模式。

**逐类别 Mask 准备**（`prepareCategoryMask` L493-538）：`downloadResult(url, config.timeoutMs)`（即适配器 `downloadCutoutResult`，L857-878，经 `downloadSafeRemoteImage` 下载，maxBytes 80MB）→ `maskPngToGrayscaleAlphaPng`（L832-855，alpha>0 → 白 255 的二值灰度 PNG）。classify 若要算类别面积（见 §3），下载的就是这张 per-class 结果图。

**错误映射**（`toCutoutSessionErrorBody` L1157-1182）：`CutoutSessionError → { status, body: { error, code, advice, retryable, requestId? } }`；未预期错误 → 500 `cutout_session_failed`。classify 路由可仿此做一个 `toClassifyErrorBody`，但响应形态要按 PRD §7.2 的 fallback JSON（`status: 'fallback'`），不是错误响应。

---

## 3. SegmentCloth 是否返回 per-class 置信度？—— **不返回**

事实核查（基于适配器代码与注释）：

- 适配器解析的响应字段只有 `Data.Elements[].ClassUrl`（类别→分割结果图 URL）与 `Data.Elements[].ImageURL`（合并图 URL），加顶层 `RequestId`。全文件 grep 无任何 score/confidence/置信度 相关解析。
- `SegmentClothByClassResult`（L30-34）只有 `classUrls / requestId / fallback`。
- 文件头注释（L24-34）与 `buildSegmentClothClassParameters` 注释（L672）均只描述分割图输出。

因此 PRD §7.2 响应里的 `confidence` 与 `candidates[].score` **没有上游原生数据源**，可行的推导方式：

1. **类别面积占比法**（推荐，素材现成）：对 `classUrls` 里每个有结果的类别，下载其分割 PNG（复用 `downloadCutoutResult`），数前景像素（参考 `restoreCutoutToOriginalCanvas` L443-459 的 alpha>8 计数法与 `FOREGROUND_THRESHOLD = 8`），按 面积/总面积 归一化为 score。`tops+skirt 且区域连续 → dress` 的「连续」判断也可用两张 mask 的 bbox 邻接/重叠近似（bbox 计算可参考 `computeBoundingBox`，cutout-session-service L672-685 的用法）。
2. **有无二值法**：score = 有结果 1 / 无结果 0，confidence 恒为固定值——实现最简单但 candidates 排序意义弱，`needsConfirmation` 只能恒 true。
3. 注意 fallback 模式（§1.3）下无法区分类别，应直接 `needsConfirmation: true` 并降 confidence。

成本提示：7 类结果图各下载一次（每张 prepared 尺寸 ≤1999px PNG）有额外延迟；PRD §18.2 要求「分类请求与生成请求不得并行重复下载同一大图」，且 §18.1 分类 P95 ≤8s——建议只下载有 ClassUrl 的类别、必要时并发下载。

映射规则（PRD §7.2）落到 `CLOTH_CLASSES` 子集：`tops/coat→tops`、`pants/skirt→bottoms`、`bag/shoes→shoes-bags`、`hat→accessory`、`tops+skirt 连续→dress`。注意 PRD 的 5 个业务分类里没有 coat 之外的「外套」独立项；`dress` 只能由 tops+skirt 组合推。

---

## 4. 服务端按 assetId 安全取图字节

classify 需要把「当前用户的素材」喂给 SegmentCloth。现成链路三条，按推荐度排序：

### 4.1 `readAssetImageBuffer(asset)` —— `lib/server/asset-cutout-service.ts` L158-208（**最直接可复用**）

cutout-session-service 正在用的读取器（L24 import，L216 注入）：

```ts
export async function readAssetImageBuffer(asset: AssetRecord): Promise<Buffer> {
  const inlineSource = asset.dataUrl || asset.fileUrl
  if (inlineSource.startsWith('data:')) {
    // base64 解码 + assertSourceSize
  }
  if (asset.fileUrl.startsWith('/local-assets/') || asset.fileUrl.startsWith('/generated/')) {
    const stored = await getLocalImageForPublicUrl(asset.fileUrl)   // 本地存储（STORAGE_MODE=local 测试站）
    ...
  }
  if (asset.fileUrl.startsWith('https://') || asset.fileUrl.startsWith('http://')) {
    const ownOssKey = extractOwnOssKey(asset.fileUrl)               // 自家 OSS publicUrl → key
    if (ownOssKey) {
      const stored = await getStorageAdapter().getImage(ownOssKey)  // 认证下载（内网免公网流量）
      if (stored) return assertSourceSize(Buffer.from(stored.body))
    }
    const downloaded = await downloadSafeRemoteImage(asset.fileUrl, { maxBytes: MAX_CUTOUT_SOURCE_BYTES })
    ...
  }
}
```

覆盖三种 fileUrl 形态：data: URL（旧数据）、本地路径（`/local-assets/`、`/generated/`）、OSS 公共 URL（先 `extractOwnOssKey` 走认证 `getImage`，失败回退安全公网下载）。带大小上限断言（`MAX_CUTOUT_SOURCE_BYTES`）。

### 4.2 `resolveAssetToDataUrl(asset)` —— `lib/server/task-store.ts` L1611-1676（生图链路用，返回 base64 dataURL）

注释（L1600-1609）说明 cloud 模式 fileUrl 是 OSS 公共 URL；`preferUrlPassthrough: true` 时 Gemini 系直接透传 URL 不下载（L1622-1624）。兜底下载用 `downloadSafeRemoteImage(fileUrl, { maxBytes: MAX_INPUT_IMAGE_BYTES })`（L1646-1648）。**注意它是 module 内私有函数**（未 export），classify 若要用需导出或复用 §4.1。

### 4.3 `extractOssKeyFromUrl(url)` —— `lib/server/task-store.ts` L1683-1688

```ts
function extractOssKeyFromUrl(url: string): string | null {
  const ossPublicUrl = process.env.OSS_PUBLIC_URL?.trim()?.replace(/\/$/, '')
  if (!ossPublicUrl) return null
  if (!url.startsWith(ossPublicUrl + '/')) return null
  return url.slice(ossPublicUrl.length + 1)
}
```

同样私有。`asset-cutout-service.ts` 里有一个平行实现 `extractOwnOssKey`。

### 4.4 `downloadSafeRemoteImage` —— `lib/server/safe-remote-image.ts` L41-60（底层安全下载器）

- SSRF 防护：`parseAndValidateRemoteUrl`（L82-109）拒绝非 http(s)、带凭据、localhost/私网 IP；`safeLookup`（L202-229）在**建连 DNS 阶段**阻断私网解析（含混合公私网全拒，L218-219）；每个重定向跳都重新校验（L49-59，上限 5 跳）。
- 大小：流式读取超限即中止（`collectBodyWithLimit` L119-136）；`MAX_INPUT_IMAGE_BYTES = 7_500_000`、`MAX_GENERATED_IMAGE_BYTES = 30_000_000`（L7-8）。
- 超时：默认 30s（L10），调用方可传 `timeoutMs`。
- 这是 PRD §19「继续使用现有安全远程图片下载器」所指组件。但 classify 入口**只接受 assetId**（PRD §7.2 安全规则），URL 来自服务端自己的 AssetRecord，不直接暴露给用户输入。

---

## 5. 最接近的 API 路由模板：`app/api/cutout-sessions/route.ts`（102 行，全文即骨架）

classify 路由（`app/api/garment-detail/classify/route.ts`）应照搬的结构——**auth → JSON 解析 → 参数校验 → service 调用 → 统一错误映射**，全程依赖注入可测：

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/server/auth/require-user'
import { createGarmentCutoutSession, toCutoutSessionErrorBody, type CutoutSessionDto } from '@/lib/server/cutout-session-service'

export const runtime = 'nodejs'

interface CutoutSessionsRouteDependencies {
  authenticate: (request: NextRequest) => Promise<{ userId: string } | NextResponse>
  createSession: (userId: string, assetId: string) => Promise<CutoutSessionDto>
}
const defaultDependencies: CutoutSessionsRouteDependencies = {
  authenticate: requireUser,
  createSession: createGarmentCutoutSession,
}

export function createCutoutSessionsPostHandler(
  dependencies: CutoutSessionsRouteDependencies = defaultDependencies,
) {
  return async function POST(request: NextRequest) {
    const userResult = await dependencies.authenticate(request)   // requireUser：未登录直接返回 401 NextResponse
    if (userResult instanceof NextResponse) return userResult

    let rawBody: unknown
    try { rawBody = await request.json() } catch { rawBody = null }
    const payload = readJsonBody(rawBody)
    if (!payload) {
      return NextResponse.json(
        { error: '请求体必须是 JSON 对象', code: 'invalid_json', advice: '请刷新页面后重试', retryable: false },
        { status: 400 },
      )
    }
    const assetId = typeof payload.assetId === 'string' ? payload.assetId.trim() : ''
    if (!assetId) {
      return NextResponse.json(
        { error: '缺少要抠图的 assetId', code: 'missing_asset_id', advice: '请重新选择图片后重试', retryable: false },
        { status: 400 },
      )
    }
    // （scene 枚举校验略，L73-87）
    try {
      const session = await dependencies.createSession(userResult.userId, assetId)  // 服务内部做素材所有权校验（§2）
      return NextResponse.json({ session })
    } catch (error) {
      const mapped = toCutoutSessionErrorBody(error)
      return NextResponse.json(mapped.body, { status: mapped.status })
    }
  }
}
export const POST = createCutoutSessionsPostHandler()
```

要点对齐 PRD §7.2/§19：

- `requireUser`（`lib/server/auth/require-user.ts`）返回 `{ userId } | NextResponse`——route 层一行接入认证。
- assetId 归一化（trim）后交 service 层做 `getAsset` + `userId` 比对，越权与不存在统一 404（§2 已引）。
- 错误体形状 `{ error, code, advice, retryable, requestId? }` 与 PRD §16 的 `{ error, code, retryable, requestId }` 兼容（多一个 advice 无妨）。
- 测试：同目录 `route.test.ts` 用注入 dependencies 跑 handler，不需要起 Next 服务。classify 路由应同样导出 `createXxxPostHandler(deps)` 工厂。
- 同目录子路由 `[sessionId]/export|image|masks` 可参考其 404/410 语义，但 classify 无会话态，不需要。
- classify 的差异：正常响应不是错误映射而是成功/降级双形态 JSON（PRD §7.2 `status: 'ok' | 'fallback'`），service 层抛出的可预期失败应在 route 或 service 内转成 fallback 200 响应，而非 4xx/5xx——「分类服务故障不得阻塞用户生成」。

---

## 6. 细节输出位（PRD §5.3）对齐要点

前端 `buildGarmentDetailShots()` 的精确行为见姊妹文档 `frontend-mock-wiring.md` §1.3（labels 表、`detail_${i+1}` 命名、referenceAssetId 绑定、0 参考图出 1 张）。后端 `normalizeGarmentDetailParams()` 重建 detailShots 时逐项对齐即可；labels 中文字符串必须与前端逐字一致，否则 right-panel 结果网格的 `shotId`/label 展示与任务卡错位（PRD §5.3 末段明确要求）。
