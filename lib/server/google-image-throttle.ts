/**
 * 进程级 Google 生图客户端节流（IPM / RPM 令牌桶）。
 *
 * 设计目标：
 * - 在客户端主动 sleep，避免连点 photo-fission 把 IPM 打满后被 Google 服务端 429
 * - 单例（挂 globalThis），按 apiKey 维护两个时间戳队列
 *   - imageStamps：60s 滚动窗口内的图像调用次数（计入 IPM）
 *   - requestStamps：60s 滚动窗口内的 HTTP 请求次数（计入 RPM）
 * - 失败也算配额消耗（不退还令牌），与 Google 服务端实际计算口径保持一致
 *
 * env 兜底（默认对齐 Tier 1）：
 * - GOOGLE_IMAGE_IPM=10
 * - GOOGLE_IMAGE_RPM=150
 */

interface ApiKeyBuckets {
  imageStamps: number[]
  requestStamps: number[]
}

interface ThrottleStore {
  buckets: Map<string, ApiKeyBuckets>
}

const globalKey = '__google_image_throttle__'
const globalAny = globalThis as typeof globalThis & {
  [globalKey]?: ThrottleStore
}

function getStore(): ThrottleStore {
  if (!globalAny[globalKey]) {
    globalAny[globalKey] = { buckets: new Map() }
  }
  return globalAny[globalKey]
}

function getBuckets(apiKey: string): ApiKeyBuckets {
  const store = getStore()
  const key = apiKey || '__no_key__'
  let bucket = store.buckets.get(key)
  if (!bucket) {
    bucket = { imageStamps: [], requestStamps: [] }
    store.buckets.set(key, bucket)
  }
  return bucket
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function getMaxIpm(): number {
  return readPositiveInt(process.env.GOOGLE_IMAGE_IPM, 10)
}

function getMaxRpm(): number {
  return readPositiveInt(process.env.GOOGLE_IMAGE_RPM, 150)
}

const WINDOW_MS = 60_000

function pruneExpired(stamps: number[], now: number): number[] {
  // 直接 mutate 原数组：抹掉所有早于 60s 前的时间戳
  while (stamps.length > 0 && now - stamps[0] >= WINDOW_MS) {
    stamps.shift()
  }
  return stamps
}

function computeWaitMs(stamps: number[], maxPerMinute: number, now: number): number {
  if (stamps.length < maxPerMinute) return 0
  // 队首过期时即可释放 1 个名额
  const oldest = stamps[0]
  const wait = WINDOW_MS - (now - oldest)
  // jitter ±100ms 防止多 worker 同步唤醒
  const jitter = Math.floor((Math.random() - 0.5) * 200)
  return Math.max(0, wait + jitter)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      cleanup()
      reject(new Error('throttle wait aborted'))
    }

    function cleanup() {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    if (signal) {
      if (signal.aborted) {
        cleanup()
        reject(new Error('throttle wait aborted'))
        return
      }
      signal.addEventListener('abort', onAbort)
    }
  })
}

export interface AcquireOptions {
  apiKey: string
  signal?: AbortSignal
  /** 用于日志回调，便于 wrapper 把 throttle 事件挂上 traceId */
  onWait?: (waitMs: number, reason: 'ipm' | 'rpm') => void
}

/**
 * 在发起一次 Google 生图请求前调用。若 IPM 或 RPM 任一已满，sleep 到队首过期。
 * sleep 完成后再检查一次窗口（自旋避免并发抢同一名额导致瞬时超限）。
 *
 * 失败的请求不退还令牌：Google 服务端按调用次数计算，重试也会消耗下一个 60s 窗口的额度。
 */
export async function acquireGoogleImageSlot(
  options: AcquireOptions,
): Promise<void> {
  const { apiKey, signal, onWait } = options
  const bucket = getBuckets(apiKey)
  const maxIpm = getMaxIpm()
  const maxRpm = getMaxRpm()

  // 最多自旋 5 次（实际仅在多 worker 高并发抢同一名额时 > 1）
  for (let spin = 0; spin < 5; spin += 1) {
    const now = Date.now()
    pruneExpired(bucket.imageStamps, now)
    pruneExpired(bucket.requestStamps, now)

    const waitIpm = computeWaitMs(bucket.imageStamps, maxIpm, now)
    const waitRpm = computeWaitMs(bucket.requestStamps, maxRpm, now)
    const waitMs = Math.max(waitIpm, waitRpm)

    if (waitMs <= 0) {
      const stamp = Date.now()
      bucket.imageStamps.push(stamp)
      bucket.requestStamps.push(stamp)
      return
    }

    if (onWait) {
      onWait(waitMs, waitIpm >= waitRpm ? 'ipm' : 'rpm')
    }

    await sleep(waitMs, signal)
  }

  // 走到这里说明窗口竞争极度激烈，强行写入（让上游 fetch 自己撞 429 再走 retry）
  const stamp = Date.now()
  bucket.imageStamps.push(stamp)
  bucket.requestStamps.push(stamp)
}

/** 测试 / debug 用：清空全部桶。生产代码不要调用。 */
export function __resetThrottleForTests(): void {
  const store = getStore()
  store.buckets.clear()
}
