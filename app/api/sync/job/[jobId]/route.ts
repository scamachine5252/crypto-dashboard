import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await params

  const { data: job, error } = await supabaseAdmin
    .from('full_sync_jobs')
    .select(
      'id, account_id, exchange, status, current_step, total_steps, ' +
      'discovered_symbols_count, failed_items, error_message, created_at, started_at, completed_at',
    )
    .eq('id', jobId)
    .single()

  if (error || !job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  return NextResponse.json(job)
}
