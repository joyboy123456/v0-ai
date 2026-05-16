import { NextResponse } from 'next/server'
import { createAsset } from '@/lib/server/task-store'

export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: '请上传图片文件' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const mimeType = file.type || 'image/png'
  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`

  const asset = await createAsset({
    fileName: file.name,
    fileType: mimeType,
    fileUrl: dataUrl,
    dataUrl,
  })

  return NextResponse.json({
    assetId: asset.assetId,
    url: asset.fileUrl,
    fileName: asset.fileName,
    width: asset.width,
    height: asset.height,
  })
}
