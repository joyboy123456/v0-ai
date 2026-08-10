import { NextResponse, type NextRequest } from 'next/server'

import {
  AssetCutoutError,
  cutoutAssetForUser,
  type CutoutAssetServiceResult,
} from '@/lib/server/asset-cutout-service'
import { requireUser } from '@/lib/server/auth/require-user'

interface RouteContext {
  params: Promise<{
    assetId: string
  }>
}

interface CutoutRouteDependencies {
  authenticate: (
    request: NextRequest,
  ) => Promise<{ userId: string } | NextResponse>
  cutoutAsset: (
    assetId: string,
    userId: string,
  ) => Promise<CutoutAssetServiceResult>
}

export interface CutoutAssetDto {
  assetId: string
  url: string
  fileName: string
  fileType: 'image/png'
  width: number
  height: number
  sourceAssetId: string
}

export const runtime = 'nodejs'

const defaultDependencies: CutoutRouteDependencies = {
  authenticate: requireUser,
  cutoutAsset: cutoutAssetForUser,
}

export function createCutoutPostHandler(
  dependencies: CutoutRouteDependencies = defaultDependencies,
) {
  return async function POST(request: NextRequest, context: RouteContext) {
    const userResult = await dependencies.authenticate(request)
    if (userResult instanceof NextResponse) return userResult

    const { assetId: rawAssetId } = await context.params
    const assetId = rawAssetId?.trim()
    if (!assetId) {
      return NextResponse.json(
        {
          error: '缺少要抠图的 assetId',
          code: 'missing_asset_id',
          advice: '请重新选择图片后重试',
          retryable: false,
        },
        { status: 400 },
      )
    }

    try {
      const result = await dependencies.cutoutAsset(assetId, userResult.userId)
      return NextResponse.json({ asset: toCutoutAssetDto(result) })
    } catch (error) {
      if (error instanceof AssetCutoutError) {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            advice: error.advice,
            retryable: error.retryable,
            ...(error.requestId ? { requestId: error.requestId } : {}),
          },
          { status: error.status },
        )
      }

      console.error('[assets/cutout] 未预期的抠图错误：', error)
      return NextResponse.json(
        {
          error: '抠图失败，请稍后重试',
          code: 'cutout_failed',
          advice: '请稍后重试；失败不会扣除权益',
          retryable: true,
        },
        { status: 500 },
      )
    }
  }
}

export function toCutoutAssetDto(
  result: CutoutAssetServiceResult,
): CutoutAssetDto {
  return {
    assetId: result.asset.assetId,
    url: result.asset.fileUrl,
    fileName: result.asset.fileName,
    fileType: 'image/png',
    width: result.asset.width,
    height: result.asset.height,
    sourceAssetId: result.sourceAssetId,
  }
}

export const POST = createCutoutPostHandler()
