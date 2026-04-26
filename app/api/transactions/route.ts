import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

/**
 * GET /api/transactions?since=&until=&account_ids=id1,id2
 * Returns deposits and withdrawals for the given accounts and time range.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const params     = req.nextUrl.searchParams
  const since      = params.get('since')
  const until      = params.get('until')
  const accountIds = params.get('account_ids')?.split(',').filter(Boolean) ?? []

  if (accountIds.length === 0) {
    return NextResponse.json({ transactions: [] })
  }

  const PAGE = 1000
  const all: unknown[] = []
  let from = 0

  while (true) {
    let query = supabaseAdmin
      .from('transactions')
      .select('id, account_id, exchange, type, asset, amount, fee, status, tx_id, recorded_at')
      .in('account_id', accountIds)
      .order('recorded_at', { ascending: false })
      .range(from, from + PAGE - 1)

    if (since) query = query.gte('recorded_at', since)
    if (until) query = query.lte('recorded_at', until)

    const { data, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  return NextResponse.json({ transactions: all })
}
