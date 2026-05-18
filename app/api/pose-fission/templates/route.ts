import { NextResponse } from 'next/server'
import { listPoseTemplates } from '@/lib/server/pose-fission-service'

/**
 * 列出所有占位姿势模板，供前端 PoseLibraryDialog（PR3 实现）使用。
 *
 * MVP 阶段直接返回内存常量 POSE_TEMPLATES。后续若引入数据库或
 * 后台管理界面，仅需把这层换为 DB 查询，不影响调用方。
 */
export async function GET() {
  return NextResponse.json({
    templates: listPoseTemplates(),
  })
}
