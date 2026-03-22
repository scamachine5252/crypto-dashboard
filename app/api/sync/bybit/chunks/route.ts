import 'server-only'
import { NextResponse } from 'next/server'

const CHUNK_DAYS = 7    // Bybit Unified API enforces 7-day max window per request
const TOTAL_DAYS = 182  // 26 × 7 days

export async function GET(): Promise<NextResponse> {
  const totalChunks = TOTAL_DAYS / CHUNK_DAYS
  return NextResponse.json({ totalChunks, chunkDays: CHUNK_DAYS, totalDays: TOTAL_DAYS })
}
