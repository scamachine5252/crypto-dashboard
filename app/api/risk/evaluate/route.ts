import 'server-only'
import { NextResponse } from 'next/server'
import { runRiskEvaluation } from '@/lib/risk/run-evaluation'

export async function POST(): Promise<NextResponse> {
  const result = await runRiskEvaluation()
  return NextResponse.json(result)
}
