// @ts-nocheck — Deno Edge Function; imports resolved by Deno runtime, not tsc
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STALE_THRESHOLD_MS  = 30 * 60 * 1000   // 30 minutes
const JOB_DEDUP_WINDOW_MS = 60 * 60 * 1000   // don't create a job if one was created in the last hour

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: status, error: statusError } = await supabase
    .from('worker_status')
    .select('last_heartbeat')
    .eq('id', 1)
    .single()

  // Guard: if the worker_status row doesn't exist, the worker has never started (not a stale worker).
  // Avoid creating recovery jobs that can never run.
  if (statusError || !status) {
    console.log('[watchdog] worker_status row missing — worker not yet started, skipping recovery')
    return new Response(JSON.stringify({ status: 'no_worker_row' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const isAlive = Date.now() - new Date(status.last_heartbeat).getTime() < STALE_THRESHOLD_MS

  if (isAlive) {
    return new Response(JSON.stringify({ status: 'worker_alive' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Worker is stale — create recovery jobs only for accounts with no active or recently-created job
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, exchange')
    .eq('is_suspended', false)

  const dedupCutoff = new Date(Date.now() - JOB_DEDUP_WINDOW_MS).toISOString()

  let created = 0
  for (const account of accounts ?? []) {
    const { data: existing } = await supabase
      .from('full_sync_jobs')
      .select('id')
      .eq('account_id', account.id)
      .or(`status.in.(pending,processing),created_at.gte.${dedupCutoff}`)
      .limit(1)
      .maybeSingle()

    if (!existing) {
      await supabase.from('full_sync_jobs').insert({
        account_id:   account.id,
        exchange:     account.exchange,
        status:       'pending',
        current_step: 0,
        total_steps:  0,
        failed_items: [],
      })
      created++
    }
  }

  const msg = `worker stale since ${status.last_heartbeat} — created ${created} recovery jobs`
  console.log(`[watchdog] ${msg}`)
  return new Response(JSON.stringify({ status: 'worker_stale', jobs_created: created }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
