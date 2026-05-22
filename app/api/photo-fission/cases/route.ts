import { NextResponse } from 'next/server'
import { getVisibleCases } from '@/lib/server/photo-fission-case-store'

export async function GET() {
  const cases = await getVisibleCases()
  return NextResponse.json({ cases })
}
