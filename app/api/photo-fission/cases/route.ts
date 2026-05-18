import { NextResponse } from 'next/server'
import { PHOTO_FISSION_CASES } from '@/lib/types'

export async function GET() {
  return NextResponse.json({ cases: PHOTO_FISSION_CASES })
}
