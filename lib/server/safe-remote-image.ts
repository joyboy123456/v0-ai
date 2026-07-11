import { lookup as dnsLookup } from 'node:dns'
import { lookup as dnsLookupAsync } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

export const MAX_INPUT_IMAGE_BYTES = 7_500_000
export const MAX_GENERATED_IMAGE_BYTES = 30_000_000

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_USER_AGENT = 'YibaiFission/1.0'

type SupportedProtocol = 'http:' | 'https:'

export interface SafeRemoteImageOptions {
  maxBytes: number
  timeoutMs?: number
  maxRedirects?: number
  allowedProtocols?: readonly SupportedProtocol[]
}

export interface SafeRemoteImageResult {
  buffer: Buffer
  contentType: string | null
  finalUrl: string
}

type DownloadHopResult = SafeRemoteImageResult

interface RedirectHopResult {
  redirectUrl: string
}

type HopResult = DownloadHopResult | RedirectHopResult

/**
 * 下载公网图片，并在实际建连的 DNS lookup 阶段阻断私网地址。
 * 每个重定向都会重新校验 URL 和 DNS，响应体按流读取并在超过上限时立即中止。
 */
export async function downloadSafeRemoteImage(
  input: string,
  options: SafeRemoteImageOptions,
): Promise<SafeRemoteImageResult> {
  const allowedProtocols = options.allowedProtocols ?? ['http:', 'https:']
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  let currentUrl = parseAndValidateRemoteUrl(input, allowedProtocols)

  for (let redirectCount = 0; ; redirectCount += 1) {
    const result = await downloadOneHop(currentUrl, options)
    if (!('redirectUrl' in result)) return result
    if (redirectCount >= maxRedirects) {
      throw new Error(`远程图片重定向次数超过上限（${maxRedirects} 次）`)
    }
    currentUrl = parseAndValidateRemoteUrl(
      new URL(result.redirectUrl, currentUrl).toString(),
      allowedProtocols,
    )
  }
}

/**
 * 在只保存 URL、尚不下载的入口提前校验公网 DNS。
 * 真正下载时仍必须使用 downloadSafeRemoteImage，防止 DNS rebinding。
 */
export async function assertSafeRemoteUrl(
  input: string,
  allowedProtocols: readonly SupportedProtocol[] = ['http:', 'https:'],
): Promise<URL> {
  const parsed = parseAndValidateRemoteUrl(input, allowedProtocols)
  const hostname = normalizeHostname(parsed.hostname)
  if (isIP(hostname)) return parsed

  const addresses = await dnsLookupAsync(hostname, { all: true, verbatim: true })
  if (addresses.length === 0) {
    throw new Error('远程图片域名无法解析')
  }
  assertAllAddressesPublic(addresses.map((item) => item.address))
  return parsed
}

export function parseAndValidateRemoteUrl(
  input: string,
  allowedProtocols: readonly SupportedProtocol[] = ['http:', 'https:'],
): URL {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new Error('远程图片 URL 格式无效')
  }

  if (!allowedProtocols.includes(parsed.protocol as SupportedProtocol)) {
    throw new Error(`远程图片 URL 协议不支持：${parsed.protocol || '未知'}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error('远程图片 URL 不能包含用户名或密码')
  }

  const hostname = normalizeHostname(parsed.hostname)
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('远程图片 URL 不能指向本机或内网地址')
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error('远程图片 URL 不能指向本机或内网地址')
  }

  return parsed
}

export function isPublicIpAddress(input: string): boolean {
  const address = normalizeHostname(input)
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

export async function collectBodyWithLimit(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > maxBytes) {
      throw new Error(`远程图片超过大小上限（${formatMegabytes(maxBytes)} MB）`)
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks, totalBytes)
}

async function downloadOneHop(
  url: URL,
  options: SafeRemoteImageOptions,
): Promise<HopResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`远程图片下载超时（${timeoutMs}ms）`))
  }, timeoutMs)

  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = transport(url, {
        method: 'GET',
        signal: controller.signal,
        lookup: safeLookup,
        headers: {
          Accept: 'image/*,*/*;q=0.1',
          'Accept-Encoding': 'identity',
          'User-Agent': DEFAULT_USER_AGENT,
        },
      })
      request.once('response', resolve)
      request.once('error', reject)
      request.end()
    })

    const statusCode = response.statusCode ?? 0
    if (statusCode >= 300 && statusCode < 400) {
      const location = response.headers.location
      response.resume()
      if (!location) throw new Error(`远程图片重定向缺少 Location（HTTP ${statusCode}）`)
      return { redirectUrl: location }
    }
    if (statusCode < 200 || statusCode >= 300) {
      response.resume()
      throw new Error(`远程图片下载失败：HTTP ${statusCode}`)
    }

    const contentLength = readContentLength(response)
    if (contentLength !== null && contentLength > options.maxBytes) {
      response.destroy()
      throw new Error(
        `远程图片超过大小上限（${formatMegabytes(options.maxBytes)} MB）`,
      )
    }

    try {
      const buffer = await collectBodyWithLimit(response, options.maxBytes)
      return {
        buffer,
        contentType: normalizeContentType(response.headers['content-type']),
        finalUrl: url.toString(),
      }
    } catch (error) {
      response.destroy(error instanceof Error ? error : undefined)
      throw error
    }
  } finally {
    clearTimeout(timeout)
  }
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, '', 0)
      return
    }

    try {
      const requestedFamily = normalizeRequestedFamily(options.family)
      const candidates = requestedFamily
        ? addresses.filter((item) => item.family === requestedFamily)
        : addresses
      if (candidates.length === 0) {
        throw new Error('远程图片域名没有可用的 DNS 地址')
      }

      // 域名同时解析出公网和私网时也拒绝，避免轮询或 Happy Eyeballs 选中私网。
      assertAllAddressesPublic(addresses.map((item) => item.address))
      if (options.all) {
        callback(null, candidates)
      } else {
        callback(null, candidates[0].address, candidates[0].family)
      }
    } catch (lookupError) {
      callback(toErrnoException(lookupError), '', 0)
    }
  })
}

function assertAllAddressesPublic(addresses: string[]) {
  const blocked = addresses.find((address) => !isPublicIpAddress(address))
  if (blocked) {
    throw new Error(`远程图片域名解析到非公网地址：${blocked}`)
  }
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false
  }

  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6Bytes(address)
  if (!bytes) return false

  const allZero = bytes.every((byte) => byte === 0)
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  if (allZero || loopback) return false

  // IPv4-compatible / IPv4-mapped IPv6 地址必须按嵌入的 IPv4 再校验。
  const firstTenZero = bytes.slice(0, 10).every((byte) => byte === 0)
  const firstTwelveZero = bytes.slice(0, 12).every((byte) => byte === 0)
  if (
    (firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff) ||
    firstTwelveZero
  ) {
    return isPublicIpv4(bytes.slice(12).join('.'))
  }

  // NAT64 well-known prefix：防止把私网 IPv4 藏在 IPv6 末尾。
  const isNat64 =
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  if (isNat64 && !isPublicIpv4(bytes.slice(12).join('.'))) return false

  if ((bytes[0] & 0xfe) === 0xfc) return false // fc00::/7 ULA
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false // fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return false // fec0::/10
  if (bytes[0] === 0xff) return false // multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return false // 2001:db8::/32 documentation
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false // 6to4
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes[4] === 0x00 &&
    bytes[5] === 0x01
  ) {
    return false // 64:ff9b:1::/48 local-use NAT64
  }
  return true
}

function parseIpv6Bytes(address: string): number[] | null {
  const zoneIndex = address.indexOf('%')
  const clean = (zoneIndex >= 0 ? address.slice(0, zoneIndex) : address).toLowerCase()
  const halves = clean.split('::')
  if (halves.length > 2) return null

  const left = parseIpv6Segments(halves[0])
  const right = parseIpv6Segments(halves[1] ?? '')
  if (!left || !right) return null

  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null
  }

  const segments = [...left, ...Array.from({ length: missing }, () => 0), ...right]
  if (segments.length !== 8) return null
  return segments.flatMap((segment) => [segment >> 8, segment & 0xff])
}

function parseIpv6Segments(part: string): number[] | null {
  if (!part) return []
  const rawSegments = part.split(':')
  const result: number[] = []

  for (const raw of rawSegments) {
    if (raw.includes('.')) {
      if (!isPublicOrPrivateIpv4Syntax(raw)) return null
      const octets = raw.split('.').map(Number)
      result.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
      continue
    }
    if (!/^[0-9a-f]{1,4}$/.test(raw)) return null
    result.push(Number.parseInt(raw, 16))
  }
  return result
}

function isPublicOrPrivateIpv4Syntax(address: string): boolean {
  const octets = address.split('.').map(Number)
  return (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  )
}

function normalizeHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return withoutBrackets.replace(/\.$/, '').toLowerCase()
}

function normalizeRequestedFamily(value: number | string | undefined): 4 | 6 | null {
  if (value === 4 || value === 'IPv4') return 4
  if (value === 6 || value === 'IPv6') return 6
  return null
}

function readContentLength(response: IncomingMessage): number | null {
  const value = response.headers['content-length']
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function normalizeContentType(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.split(';')[0]?.trim().toLowerCase() || null
}

function toErrnoException(error: unknown): NodeJS.ErrnoException {
  const normalized = error instanceof Error ? error : new Error(String(error))
  const errnoError = normalized as NodeJS.ErrnoException
  errnoError.code = errnoError.code ?? 'EACCES'
  return errnoError
}

function formatMegabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace(/\.0$/, '')
}
