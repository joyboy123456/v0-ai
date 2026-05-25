/**
 * ModelRouter `/v1/videos/generations` 客户端（异步双段式）。
 *
 * 文档：ModelRouter API 完整文档（base = https://model-router.edu-aliyun.com/v1）
 *
 * 调用流程：
 *   1) POST `/v1/videos/generations` 提交任务，返回 task_id
 *   2) 轮询 GET `/v1/tasks/{task_id}` 直到 status ∈ {SUCCEEDED, FAILED}
 *
 * 字段兼容策略：
 *   ModelRouter 不同模型返回结构略有差异（DashScope native vs OpenAI-compatible），
 *   `extractTaskId` / `extractStatus` / `extractVideoUrl` 都尝试多个常见路径，
 *   命中即返回，避免硬编码导致单个模型集成失败。
 *
 * 设计原则：
 *   - 不做客户端节流（ModelRouter 按 API Key QPS 限流，由服务端兜底）
 *   - 超时阈值与 polling 间隔可配置，方便压测时调整
 *   - 失败响应原样抛出 HTTP body，便于上游日志快速定位 ModelRouter 报错原因
 */

const BASE_URL = 'https://model-router.edu-aliyun.com/v1'

const SUBMIT_TIMEOUT_MS = 120_000
const POLL_TIMEOUT_MS = 30_000
const POLL_MAX_WAIT_MS = 10 * 60 * 1000
const POLL_INTERVAL_MS = 8_000
const POLL_BACKOFF_STEP_MS = 2_000
const POLL_INTERVAL_CAP_MS = 30_000

function getApiKey(): string {
  const key = process.env.VIDEO_API_KEY ?? process.env.MODELROUTER_API_KEY ?? ''
  if (!key) {
    throw new Error(
      'ModelRouter API Key 未配置，请在 .env.local 设置 VIDEO_API_KEY 或 MODELROUTER_API_KEY',
    )
  }
  return key
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }
}

export interface SubmitVideoOptions {
  model: string
  prompt: string
  /** 形如 "1920*1080" / "1280*720"；不传由模型默认 */
  size?: string
  /** 视频时长（秒），常见 "3" / "5" / "10"；不传由模型默认 */
  duration?: string
  /** 图生视频时的参考图 URL（必须公网可访问） */
  imageUrl?: string
}

type RawTaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'

interface TaskResponseJson {
  output?: {
    task_id?: string
    task_status?: RawTaskStatus
    video_url?: string
    results?:
      | { video_url?: string }
      | Array<{ video_url?: string; url?: string }>
  }
  task_id?: string
  id?: string
  status?: RawTaskStatus
  result?: { video_url?: string }
  data?: { task_id?: string; status?: RawTaskStatus; video_url?: string }
  video_url?: string
  error?: string
  message?: string
  code?: string
}

function extractTaskId(json: TaskResponseJson): string | undefined {
  return (
    json.output?.task_id ??
    json.task_id ??
    json.id ??
    json.data?.task_id
  )
}

function extractStatus(json: TaskResponseJson): string {
  const raw =
    json.output?.task_status ??
    json.status ??
    json.data?.status ??
    'UNKNOWN'
  return String(raw).toUpperCase()
}

function extractVideoUrl(json: TaskResponseJson): string | undefined {
  const outputResults = json.output?.results
  if (Array.isArray(outputResults)) {
    for (const item of outputResults) {
      if (item?.video_url) return item.video_url
      if (item?.url) return item.url
    }
  } else if (outputResults?.video_url) {
    return outputResults.video_url
  }
  return (
    json.output?.video_url ??
    json.result?.video_url ??
    json.data?.video_url ??
    json.video_url
  )
}

function extractErrorMessage(json: TaskResponseJson): string {
  return (
    json.error ??
    json.message ??
    (json.code ? `code=${json.code}` : '') ??
    '未知错误'
  )
}

async function withTimeout<T>(
  promise: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutHint: string,
): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await promise(controller.signal)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(timeoutHint)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function submitVideoGeneration(
  options: SubmitVideoOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
  }
  if (options.size) body.size = options.size
  if (options.duration) body.duration = options.duration
  if (options.imageUrl) body.image_url = options.imageUrl

  return withTimeout(
    async (signal) => {
      const response = await fetch(`${BASE_URL}/videos/generations`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
        signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
          `视频生成提交失败：HTTP ${response.status}${text ? ` — ${text.slice(0, 500)}` : ''}`,
        )
      }

      const data = (await response.json()) as TaskResponseJson
      const taskId = extractTaskId(data)
      if (!taskId) {
        throw new Error(
          `视频生成提交失败：未返回 task_id — ${JSON.stringify(data).slice(0, 500)}`,
        )
      }
      return taskId
    },
    SUBMIT_TIMEOUT_MS,
    '视频生成提交超时（120s）',
  )
}

export async function getTaskStatus(taskId: string): Promise<TaskResponseJson> {
  return withTimeout(
    async (signal) => {
      const response = await fetch(`${BASE_URL}/tasks/${taskId}`, {
        method: 'GET',
        headers: authHeaders(),
        signal,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
          `任务查询失败：HTTP ${response.status}${text ? ` — ${text.slice(0, 500)}` : ''}`,
        )
      }

      return (await response.json()) as TaskResponseJson
    },
    POLL_TIMEOUT_MS,
    '任务查询超时（30s）',
  )
}

export interface PollVideoOptions {
  /** 轮询整体超时，默认 10 分钟 */
  maxWaitMs?: number
  /** 起始轮询间隔，默认 8s */
  initialIntervalMs?: number
  /** 每轮递增量，默认 2s */
  backoffStepMs?: number
  /** 轮询间隔上限，默认 30s */
  intervalCapMs?: number
  /** 进度回调（可选） */
  onProgress?: (info: {
    status: string
    elapsedMs: number
    attempt: number
  }) => void
}

export async function pollVideoTask(
  taskId: string,
  options: PollVideoOptions = {},
): Promise<string> {
  const maxWaitMs = options.maxWaitMs ?? POLL_MAX_WAIT_MS
  const initialIntervalMs = options.initialIntervalMs ?? POLL_INTERVAL_MS
  const backoffStepMs = options.backoffStepMs ?? POLL_BACKOFF_STEP_MS
  const intervalCapMs = options.intervalCapMs ?? POLL_INTERVAL_CAP_MS

  const startTime = Date.now()
  let interval = initialIntervalMs
  let attempt = 0

  while (Date.now() - startTime < maxWaitMs) {
    attempt += 1
    const json = await getTaskStatus(taskId)
    const status = extractStatus(json)

    options.onProgress?.({
      status,
      elapsedMs: Date.now() - startTime,
      attempt,
    })

    if (status === 'SUCCEEDED') {
      const videoUrl = extractVideoUrl(json)
      if (!videoUrl) {
        throw new Error(
          `视频生成完成但未返回视频 URL — ${JSON.stringify(json).slice(0, 500)}`,
        )
      }
      return videoUrl
    }

    if (status === 'FAILED') {
      throw new Error(`视频生成失败：${extractErrorMessage(json)}`)
    }

    await new Promise((resolve) => setTimeout(resolve, interval))
    interval = Math.min(intervalCapMs, interval + backoffStepMs)
  }

  throw new Error(
    `视频生成超时（已等待 ${Math.round(maxWaitMs / 1000 / 60)} 分钟），请重试`,
  )
}
