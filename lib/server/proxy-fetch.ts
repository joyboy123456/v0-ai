/**
 * 统一的对外 fetch 封装。
 *
 * 设计要点：
 * - 不要给全局 fetch 传外部 undici 包的 Agent / ProxyAgent / headersTimeout。
 *   项目依赖的 undici 包（8.x）与 Node 22 内置 fetch 所用 undici（6.x）
 *   的 Dispatcher 接口不兼容，传 8.x 的 Dispatcher 会抛
 *   `UND_ERR_INVALID_ARG: invalid onRequestStart method`，导致所有生图请求失败。
 * - 应用层超时由调用方用 AbortController 控制（见 google-genai-adapter.ts
 *   的 fetchWithTimeout）。undici 内置 headersTimeout=300s 是真实超时信号，
 *   触发后由重试机制处理，不在这里强行抬高。
 * - 如未来需要挂 HTTP 代理，需改用与 Node 内置 undici 兼容的 dispatcher
 *   （例如通过 node --import 或反向代理方案），切勿直接传外部 undici 的 Agent。
 */
export const proxyFetch: typeof fetch = (input, init) => fetch(input, init)
