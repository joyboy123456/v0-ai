import { NextResponse, type NextRequest } from 'next/server'

import {
  buildLocalAssetPublicUrl,
  getLocalImageForPublicUrl,
} from '@/lib/server/storage'
import { isLocal } from '@/lib/server/storage-mode'

interface RouteContext {
  params: Promise<{
    path: string[]
  }>
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, context: RouteContext) {
  if (!isLocal()) {
    return new NextResponse(null, { status: 404 })
  }

  const { path } = await context.params
  if (!Array.isArray(path) || path.length === 0) {
    return new NextResponse(null, { status: 404 })
  }

  const publicUrl = buildLocalAssetPublicUrl(path.join('/'))
  const image = await getLocalImageForPublicUrl(publicUrl)
  if (!image) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(image.body, {
    status: 200,
    headers: {
      'content-type': image.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
