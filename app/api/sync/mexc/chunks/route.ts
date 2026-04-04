import 'server-only'
import { NextResponse } from 'next/server'

const CHUNK_DAYS = 90
const TOTAL_DAYS = 90

export async function GET(): Promise<NextResponse> {
  const totalChunks = TOTAL_DAYS / CHUNK_DAYS
  return NextResponse.json({ totalChunks, chunkDays: CHUNK_DAYS, totalDays: TOTAL_DAYS })
}
