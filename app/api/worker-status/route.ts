import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

const STALE_MS    = 30 * 60 * 1000   // 30 min
const STALE_HOURS = 24

export async function GET() {
  const { data: ws } = await supabaseAdmin
    .from('worker_status')
    .select('last_heartbeat, started_at')
    .eq('id', 1)
    .single()

  const lastHb      = ws?.last_heartbeat ? new Date(ws.last_heartbeat) : null
  const workerAlive = lastHb ? (Date.now() - lastHb.getTime() < STALE_MS) : false

  const { data: accounts } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange, account_name')
    .eq('is_suspended', false)

  const accountIds = (accounts ?? []).map((a: { id: string }) => a.id)

  const fillMap = new Map<string, string>()
  if (accountIds.length > 0) {
    const { data: lastFills } = await supabaseAdmin
      .from('raw_fills')
      .select('account_id, exec_time')
      .in('account_id', accountIds)
      .order('exec_time', { ascending: false })
      .limit(accountIds.length * 5)

    for (const fill of (lastFills ?? []) as Array<{ account_id: string; exec_time: string }>) {
      if (!fillMap.has(fill.account_id)) fillMap.set(fill.account_id, fill.exec_time)
    }
  }

  const accountStatuses = (accounts ?? []).map((a: { id: string; exchange: string; account_name: string }) => {
    const lastFillAt = fillMap.get(a.id) ?? null
    const stale = lastFillAt
      ? (Date.now() - new Date(lastFillAt).getTime() > STALE_HOURS * 60 * 60 * 1000)
      : true
    return { id: a.id, exchange: a.exchange, account_name: a.account_name, last_fill_at: lastFillAt, stale }
  })

  return NextResponse.json({
    worker: {
      alive:          workerAlive,
      last_heartbeat: ws?.last_heartbeat ?? null,
      started_at:     ws?.started_at ?? null,
    },
    accounts: accountStatuses,
  })
}
