import { NextResponse } from 'next/server'
import { listPoseCases } from '@/lib/server/pose-fission-service'

export async function GET() {
  return NextResponse.json({
    cases: listPoseCases(),
  })
}
