import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

type BalRow   = { account_id: string; usdt_balance: number; recorded_at: string }
type TradeRow = { account_id: string; pnl: number | null; fee: number | null; closed_at: string }
type AccRow   = { id: string; account_name: string; exchange: string; fund: string }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0')
  const until = Number(req.nextUrl.searchParams.get('until') ?? Date.now())

  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, fund')

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ accounts: [], balanceHistory: [], dailyPnl: [], accountSummaries: [] })
  }

  const accountIds = (accounts as AccRow[]).map((a) => a.id)
  const sinceDate = new Date(since).toISOString()
  const untilDate = new Date(until).toISOString()

  // Fetch USDT balance history (ascending so last record per day wins)
  const { data: balances, error: balErr } = await supabaseAdmin
    .from('balances')
    .select('account_id, usdt_balance, recorded_at')
    .in('account_id', accountIds)
    .is('token_symbol', null)
    .gte('recorded_at', sinceDate)
    .lte('recorded_at', untilDate)
    .order('recorded_at', { ascending: true })

  if (balErr) return NextResponse.json({ error: balErr.message }, { status: 500 })

  // Group by (account_id, date) — last write per day wins
  const dayMap: Record<string, Record<string, number>> = {}
  for (const row of ((balances ?? []) as BalRow[])) {
    const date = row.recorded_at.slice(0, 10)
    if (!dayMap[row.account_id]) dayMap[row.account_id] = {}
    dayMap[row.account_id][date] = Number(row.usdt_balance)
  }

  const balanceHistory: { accountId: string; date: string; usdt: number }[] = []
  for (const [accountId, dates] of Object.entries(dayMap)) {
    for (const [date, usdt] of Object.entries(dates)) {
      balanceHistory.push({ accountId, date, usdt })
    }
  }

  // Fetch trades for PnL/fee aggregation
  const { data: tradeRows, error: tradeErr } = await supabaseAdmin
    .from('trades')
    .select('account_id, pnl, fee, closed_at')
    .in('account_id', accountIds)
    .gte('closed_at', sinceDate)
    .lte('closed_at', untilDate)
    .not('closed_at', 'is', null)

  if (tradeErr) return NextResponse.json({ error: tradeErr.message }, { status: 500 })

  // Daily PnL per account
  const pnlDayMap: Record<string, Record<string, number>> = {}
  for (const t of ((tradeRows ?? []) as TradeRow[])) {
    const date = t.closed_at.slice(0, 10)
    if (!pnlDayMap[t.account_id]) pnlDayMap[t.account_id] = {}
    pnlDayMap[t.account_id][date] = (pnlDayMap[t.account_id][date] ?? 0) + Number(t.pnl ?? 0)
  }

  const dailyPnl: { accountId: string; date: string; pnl: number }[] = []
  for (const [accountId, dates] of Object.entries(pnlDayMap)) {
    for (const [date, pnl] of Object.entries(dates)) {
      dailyPnl.push({ accountId, date, pnl })
    }
  }

  // Account summaries: first/last balance + total fees/pnl in range
  const accountSummaries = (accounts as AccRow[]).map((acc) => {
    const accDates = Object.keys(dayMap[acc.id] ?? {}).sort()
    const startUsdt = accDates.length > 0 ? dayMap[acc.id][accDates[0]] : 0
    const endUsdt   = accDates.length > 0 ? dayMap[acc.id][accDates[accDates.length - 1]] : 0
    const accTrades = ((tradeRows ?? []) as TradeRow[]).filter((t) => t.account_id === acc.id)
    const totalFees = accTrades.reduce((s, t) => s + Number(t.fee ?? 0), 0)
    const totalPnl  = accTrades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
    return {
      accountId:   acc.id,
      accountName: acc.account_name,
      exchange:    acc.exchange,
      fund:        acc.fund,
      startUsdt,
      endUsdt,
      deltaUsdt: endUsdt - startUsdt,
      totalFees,
      totalPnl,
    }
  })

  return NextResponse.json({ accounts, balanceHistory, dailyPnl, accountSummaries })
}
