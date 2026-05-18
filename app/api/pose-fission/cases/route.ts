import { NextResponse } from 'next/server'
import { listPoseFissionCases } from '@/lib/server/pose-fission-service'

export async function GET() {
  return NextResponse.json({
    cases: listPoseFissionCases(),
  })
}
