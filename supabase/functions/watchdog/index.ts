// @ts-nocheck — Deno Edge Function; imports resolved by Deno runtime, not tsc
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const STALE_THRESHOLD_MS = 30 * 60 * 1000   // 30 minutes

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: status } = await supabase
    .from('worker_status')
    .select('last_heartbeat')
    .eq('id', 1)
    .single()

  const isAlive = status &&
    (Date.now() - new Date(status.last_heartbeat).getTime() < STALE_THRESHOLD_MS)

  if (isAlive) {
    return new Response(JSON.stringify({ status: 'worker_alive' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Worker is stale — create pending sync jobs for accounts without an active job
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, exchange')
    .eq('is_suspended', false)

  let created = 0
  for (const account of accounts ?? []) {
    const { data: existing } = await supabase
      .from('full_sync_jobs')
      .select('id')
      .eq('account_id', account.id)
      .in('status', ['pending', 'processing'])
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

  const msg = `worker stale since ${status?.last_heartbeat ?? 'unknown'} — created ${created} recovery jobs`
  console.log(`[watchdog] ${msg}`)
  return new Response(JSON.stringify({ status: 'worker_stale', jobs_created: created }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
