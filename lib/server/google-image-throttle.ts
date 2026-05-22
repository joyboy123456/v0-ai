/**
 * 进程级生图客户端节流（IPM / RPM 令牌桶）。
 *
 * v2（2026-05-19）：支持多 provider 并发。
 * - 令牌桶按 providerId（而非 apiKey）隔离
 * - maxIpm / maxRpm 由调用方传入（provider 级别配置），不再读全局 env
 * - 向后兼容：不传 providerId 时降级到 apiKey 作为桶 key
 * - 不传 maxIpm/maxRpm 时降级读 GOOGLE_IMAGE_IPM/RPM env
 *
 * 失败也算配额消耗（不退还令牌），与 Google 服务端实际计算口径保持一致。
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

function getBuckets(bucketKey: string): ApiKeyBuckets {
  const store = getStore()
  let bucket = store.buckets.get(bucketKey)
  if (!bucket) {
    bucket = { imageStamps: [], requestStamps: [] }
    store.buckets.set(bucketKey, bucket)
  }
  return bucket
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
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
  /** provider 唯一标识，用于令牌桶隔离。不传时降级到 apiKey */
  providerId?: string
  /** 该 provider 的 IPM 上限。不传时降级读 GOOGLE_IMAGE_IPM env（默认 10） */
  maxIpm?: number
  /** 该 provider 的 RPM 上限。不传时降级读 GOOGLE_IMAGE_RPM env（默认 150） */
  maxRpm?: number
}

/**
 * 在发起一次生图请求前调用。若 IPM 或 RPM 任一已满，sleep 到队首过期。
 * sleep 完成后再检查一次窗口（自旋避免并发抢同一名额导致瞬时超限）。
 *
 * 失败的请求不退还令牌：服务端按调用次数计算，重试也会消耗下一个 60s 窗口的额度。
 */
export async function acquireGoogleImageSlot(
  options: AcquireOptions,
): Promise<void> {
  const { apiKey, signal, onWait, providerId, maxIpm: optIpm, maxRpm: optRpm } = options
  const bucketKey = providerId || apiKey || '__no_key__'
  const bucket = getBuckets(bucketKey)
  const maxIpm = optIpm ?? readPositiveInt(process.env.GOOGLE_IMAGE_IPM, 10)
  const maxRpm = optRpm ?? readPositiveInt(process.env.GOOGLE_IMAGE_RPM, 150)

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
