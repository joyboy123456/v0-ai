import { NextResponse } from 'next/server'
import { GoogleImageError } from './google-image-retry'

function getUpstreamAdvice(error: GoogleImageError): string {
  switch (error.category) {
    case 'rate_limit':
      return '请稍后重试，或切换到可用额度更充足的模型供应商'
    case 'server_error':
      return '上游服务暂不可用，请稍后重试'
    case 'payload_too_large':
      return '上游认为图片或参考图组合过大，可减少参考图数量或降低图片尺寸后重试'
    case 'auth_failed':
      return '请检查该模型供应商的 API Key、余额或权限配置'
    case 'bad_request':
      return '请检查参考图格式、数量和提示词内容是否符合该模型供应商要求'
    case 'network':
      return '请稍后重试；如果持续失败，请检查服务器到上游的网络连接'
    case 'safety_block':
    case 'image_safety':
    case 'prohibited':
      return '请调整参考图或提示词，避免触发上游安全策略'
    case 'empty_output':
      return '上游未返回图片，可重试或换一个模型供应商'
    case 'api_error':
    case 'unknown':
    default:
      return '请稍后重试；如果持续失败，请查看服务日志中的上游原始错误'
  }
}

export function jsonErrorResponse(error: unknown, status: number, fallback = '未知错误') {
  if (error instanceof GoogleImageError) {
    return NextResponse.json(
      {
        error: error.message,
        source: 'upstream',
        code: error.category,
        advice: getUpstreamAdvice(error),
        upstreamStatus: error.httpStatus,
      },
      { status },
    )
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status },
  )
}
