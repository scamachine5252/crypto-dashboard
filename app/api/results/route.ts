import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

type BalRow   = { account_id: string; usdt_balance: number; total_equity_usdt: number | null; recorded_at: string }
type TradeRow = { account_id: string; pnl: number | null; fee: number | null; closed_at: string }
type TxRow    = { account_id: string; type: string; amount: number }
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

  // Fetch USDT balance history (ascending so last record per day wins) — paginated
  const PAGE = 1000
  const allBalances: BalRow[] = []
  let balFrom = 0
  while (true) {
    const { data, error: balErr } = await supabaseAdmin
      .from('balances')
      .select('account_id, usdt_balance, total_equity_usdt, recorded_at')
      .in('account_id', accountIds)
      .is('token_symbol', null)
      .gte('recorded_at', sinceDate)
      .lte('recorded_at', untilDate)
      .order('recorded_at', { ascending: true })
      .range(balFrom, balFrom + PAGE - 1)
    if (balErr) return NextResponse.json({ error: balErr.message }, { status: 500 })
    if (!data || data.length === 0) break
    allBalances.push(...(data as BalRow[]))
    if (data.length < PAGE) break
    balFrom += PAGE
  }

  // Group by (account_id, date) — last write per day wins; equity-first
  const dayMap: Record<string, Record<string, number>> = {}
  for (const row of allBalances) {
    const date = row.recorded_at.slice(0, 10)
    if (!dayMap[row.account_id]) dayMap[row.account_id] = {}
    dayMap[row.account_id][date] = Number(row.total_equity_usdt ?? row.usdt_balance)
  }

  const balanceHistory: { accountId: string; date: string; usdt: number }[] = []
  for (const [accountId, dates] of Object.entries(dayMap)) {
    for (const [date, usdt] of Object.entries(dates)) {
      balanceHistory.push({ accountId, date, usdt })
    }
  }

  // Fetch trades for PnL/fee aggregation — paginated
  const tradeRows: TradeRow[] = []
  let trFrom = 0
  while (true) {
    const { data, error: tradeErr } = await supabaseAdmin
      .from('trades')
      .select('account_id, pnl, fee, closed_at')
      .in('account_id', accountIds)
      .gte('closed_at', sinceDate)
      .lte('closed_at', untilDate)
      .not('closed_at', 'is', null)
      .range(trFrom, trFrom + PAGE - 1)
    if (tradeErr) return NextResponse.json({ error: tradeErr.message }, { status: 500 })
    if (!data || data.length === 0) break
    tradeRows.push(...(data as TradeRow[]))
    if (data.length < PAGE) break
    trFrom += PAGE
  }

  // Daily PnL per account
  const pnlDayMap: Record<string, Record<string, number>> = {}
  for (const t of tradeRows) {
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

  // Net deposits per account (deposits - withdrawals in range)
  const { data: txData } = await supabaseAdmin
    .from('transactions')
    .select('account_id, type, amount')
    .in('account_id', accountIds)
    .gte('recorded_at', sinceDate)
    .lte('recorded_at', untilDate)

  const netDepositsMap: Record<string, number> = {}
  for (const tx of (txData ?? []) as TxRow[]) {
    const sign = tx.type === 'deposit' ? 1 : -1
    netDepositsMap[tx.account_id] = (netDepositsMap[tx.account_id] ?? 0) + sign * Number(tx.amount)
  }

  // Last balance per account strictly BEFORE sinceDate — used as startUsdt to avoid double-counting deposits
  const { data: priorBals } = await supabaseAdmin
    .from('balances')
    .select('account_id, usdt_balance, total_equity_usdt')
    .in('account_id', accountIds)
    .is('token_symbol', null)
    .lt('recorded_at', sinceDate)
    .order('recorded_at', { ascending: false })

  type PriorBalRow = { account_id: string; usdt_balance: number; total_equity_usdt: number | null }
  const startBalMap: Record<string, number> = {}
  const seenPrior = new Set<string>()
  for (const row of (priorBals ?? []) as PriorBalRow[]) {
    if (!seenPrior.has(row.account_id)) {
      startBalMap[row.account_id] = Number(row.total_equity_usdt ?? row.usdt_balance)
      seenPrior.add(row.account_id)
    }
  }

  // Account summaries: first/last balance + total fees/pnl in range
  const accountSummaries = (accounts as AccRow[]).map((acc) => {
    const accDates = Object.keys(dayMap[acc.id] ?? {}).sort()
    const startUsdt = startBalMap[acc.id] ?? 0
    const endUsdt   = accDates.length > 0 ? dayMap[acc.id][accDates[accDates.length - 1]] : 0
    const accTrades = tradeRows.filter((t) => t.account_id === acc.id)
    const totalFees = accTrades.reduce((s, t) => s + Number(t.fee ?? 0), 0)
    const totalPnl  = accTrades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
    const netDeposits   = netDepositsMap[acc.id] ?? 0
    const deltaUsdt     = endUsdt - startUsdt
    const tradingResult = deltaUsdt - netDeposits
    return {
      accountId:   acc.id,
      accountName: acc.account_name,
      exchange:    acc.exchange,
      fund:        acc.fund,
      startUsdt,
      endUsdt,
      deltaUsdt,
      netDeposits,
      tradingResult,
      totalFees,
      totalPnl,
    }
  })

  return NextResponse.json({ accounts, balanceHistory, dailyPnl, accountSummaries })
}
