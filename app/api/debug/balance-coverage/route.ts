import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { requireDebugAuth } from '@/lib/debug-auth'

/**
 * GET /api/debug/balance-coverage
 * Returns min/max date and row count per account in the balances table.
 * Used to verify that balance backfill actually wrote data.
 * Requires x-debug-secret header matching DEBUG_SECRET env var.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const deny = requireDebugAuth(req)
  if (deny) return deny

  // Fetch all accounts for name lookup
  const { data: accounts } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange')

  const nameMap: Record<string, string> = {}
  const exchMap: Record<string, string> = {}
  for (const a of (accounts ?? []) as Array<{ id: string; account_name: string; exchange: string }>) {
    nameMap[a.id] = a.account_name
    exchMap[a.id] = a.exchange
  }

  // Fetch all USDT balance rows (token_symbol IS NULL)
  const rows: Array<{ account_id: string; recorded_at: string }> = []
  let from = 0
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('balances')
      .select('account_id, recorded_at')
      .is('token_symbol', null)
      .order('recorded_at', { ascending: true })
      .range(from, from + 999)
    if (error || !data || data.length === 0) break
    rows.push(...(data as typeof rows))
    if (data.length < 1000) break
    from += 1000
  }

  // Group by account_id
  const grouped: Record<string, { min: string; max: string; count: number }> = {}
  for (const r of rows) {
    const g = grouped[r.account_id]
    if (!g) {
      grouped[r.account_id] = { min: r.recorded_at, max: r.recorded_at, count: 1 }
    } else {
      if (r.recorded_at < g.min) g.min = r.recorded_at
      if (r.recorded_at > g.max) g.max = r.recorded_at
      g.count++
    }
  }

  const result = Object.entries(grouped).map(([id, g]) => ({
    account_id:   id,
    account_name: nameMap[id] ?? id,
    exchange:     exchMap[id] ?? '?',
    min_date:     g.min.slice(0, 10),
    max_date:     g.max.slice(0, 10),
    row_count:    g.count,
    days_covered: Math.round((new Date(g.max).getTime() - new Date(g.min).getTime()) / 86400000),
  }))

  result.sort((a, b) => a.account_name.localeCompare(b.account_name))

  return NextResponse.json({ coverage: result, total_rows: rows.length })
}
