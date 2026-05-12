import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import Redis from 'ioredis'

const QUEUE_KEY   = 'fullscan:queue'
const LOCK_PREFIX = 'fullscan:lock:'

let _redis: Redis | null = null
function getRedis(): Redis {
  if (!_redis) _redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')
  return _redis
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body      = await req.json() as Record<string, unknown>
  const accountId = body.account_id as string | undefined

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const redis   = getRedis()
  const lockVal = await redis.get(`${LOCK_PREFIX}${accountId}`)
  if (lockVal) {
    return NextResponse.json({ error: 'sync_in_progress', jobId: lockVal }, { status: 409 })
  }

  const { data: job, error: insertError } = await supabaseAdmin
    .from('full_sync_jobs')
    .insert({
      account_id:   accountId,
      exchange:     (account as Record<string, string>).exchange,
      status:       'pending',
      current_step: 0,
      total_steps:  0,
      failed_items: [],
    })
    .select('id')
    .single()

  if (insertError || !job) {
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
  }

  const jobId = (job as Record<string, string>).id
  await redis.lpush(QUEUE_KEY, jobId)

  return NextResponse.json({ jobId })
}
