import 'server-only'
import { NextResponse } from 'next/server'

const CHUNK_DAYS = 30
const TOTAL_DAYS = 180

export async function GET(): Promise<NextResponse> {
  const totalChunks = TOTAL_DAYS / CHUNK_DAYS
  return NextResponse.json({ totalChunks, chunkDays: CHUNK_DAYS, totalDays: TOTAL_DAYS })
}
