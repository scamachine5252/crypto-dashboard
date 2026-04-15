import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { Trade, ExchangeId, TradeType, TradeSide } from '@/lib/types'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0')
  const until = Number(req.nextUrl.searchParams.get('until') ?? Date.now())

  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, fund, initial_aum')

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ accounts: [], trades: [] })
  }

  const accountIds = accounts.map((a: { id: string }) => a.id)
  const sinceDate = new Date(since).toISOString()
  const untilDate = new Date(until).toISOString()

  // ---------------------------------------------------------------------------
  // Initial capital per account
  // Priority: last USDT balance snapshot at/before period start
  //         → first balance snapshot within period
  //         → manual initial_aum
  //         → null (N/A — IC-dependent metrics will show "—")
  // ---------------------------------------------------------------------------
  const { data: allBalances } = await supabaseAdmin
    .from('balances')
    .select('account_id, usdt_balance, recorded_at')
    .in('account_id', accountIds)
    .is('token_symbol', null)
    .lte('recorded_at', untilDate)
    .order('recorded_at', { ascending: true })

  type BalRow = { account_id: string; usdt_balance: number; recorded_at: string }
  const bals = (allBalances ?? []) as BalRow[]

  type AccRow = { id: string; account_name: string; exchange: string; fund: string; initial_aum?: number | null }
  const icMap: Record<string, number | null> = {}

  for (const acc of accounts as AccRow[]) {
    const accBals = bals.filter((b) => b.account_id === acc.id)

    // Priority 1: last snapshot at or before period start (best IC proxy)
    const beforePeriod = accBals.filter((b) => b.recorded_at <= sinceDate)
    if (beforePeriod.length > 0) {
      icMap[acc.id] = Number(beforePeriod[beforePeriod.length - 1].usdt_balance)
      continue
    }

    // Priority 2: first snapshot within period (sync happened after period start)
    const inPeriod = accBals.filter((b) => b.recorded_at > sinceDate)
    if (inPeriod.length > 0) {
      icMap[acc.id] = Number(inPeriod[0].usdt_balance)
      continue
    }

    // Priority 3: manually entered initial AUM
    const aum = Number(acc.initial_aum ?? 0)
    icMap[acc.id] = aum > 0 ? aum : null
  }

  // ---------------------------------------------------------------------------
  // Trades — paginated
  // ---------------------------------------------------------------------------
  const PAGE = 1000
  const allRows: Array<{
    id: string; account_id: string; exchange: string; symbol: string
    direction: string | null; trade_type: string; entry_price: string | null
    exit_price: string | null; quantity: string | null; pnl: string | null
    fee: string | null; opened_at: string | null; closed_at: string
  }> = []
  let from = 0
  while (true) {
    const { data, error: pageErr } = await supabaseAdmin
      .from('trades')
      .select('id, account_id, exchange, symbol, direction, trade_type, entry_price, exit_price, quantity, pnl, fee, opened_at, closed_at')
      .in('account_id', accountIds)
      .gte('closed_at', sinceDate)
      .lte('closed_at', untilDate)
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (pageErr) return NextResponse.json({ error: pageErr.message }, { status: 500 })
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  type RawRow = {
    id: string; account_id: string; exchange: string; symbol: string
    direction: string | null; trade_type: string; entry_price: string | null
    exit_price: string | null; quantity: string | null; pnl: string | null
    fee: string | null; opened_at: string | null; closed_at: string
  }

  // Filter to closing fills only — opening fills (pnl=0) skew all metrics
  const closingRows = allRows.filter((t: RawRow) => Number(t.pnl ?? 0) !== 0)

  const trades: Trade[] = closingRows.map((t: RawRow) => {
    const pnl        = Number(t.pnl ?? 0)
    const entryPrice = Number(t.entry_price ?? 0)
    const quantity   = Number(t.quantity ?? 0)
    const notional   = entryPrice * quantity
    return {
    id: t.id,
    subAccountId: t.account_id,
    exchangeId: t.exchange as ExchangeId,
    symbol: t.symbol,
    side: (t.direction === 'long' || t.direction === 'short') ? t.direction as TradeSide : 'long',
    tradeType: t.trade_type as TradeType,
    entryPrice,
    exitPrice: Number(t.exit_price ?? 0),
    quantity,
    pnl,
    pnlPercent: notional > 0 ? (pnl / notional) * 100 : 0,
    fee: Number(t.fee ?? 0),
    durationMin: t.opened_at
      ? Math.round((new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()) / 60000)
      : 0,
    leverage: 1,
    fundingCost: 0,
    isOvernight: t.opened_at
      ? new Date(t.opened_at).getUTCDate() !== new Date(t.closed_at).getUTCDate()
      : false,
    openedAt: t.opened_at ?? t.closed_at,
    closedAt: t.closed_at,
  }})

  // Return accounts enriched with initialCapital
  const enrichedAccounts = (accounts as AccRow[]).map((a) => ({
    id: a.id,
    account_name: a.account_name,
    exchange: a.exchange,
    fund: a.fund,
    initialCapital: icMap[a.id] ?? null,  // null = IC unknown → N/A for IC-dependent metrics
  }))

  return NextResponse.json({ accounts: enrichedAccounts, trades })
}
