import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { Trade, ExchangeId, TradeType, TradeSide } from '@/lib/types'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0')
  const until = Number(req.nextUrl.searchParams.get('until') ?? Date.now())

  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, fund')

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ accounts: [], trades: [] })
  }

  const accountIds = accounts.map((a: { id: string }) => a.id)
  const sinceDate = new Date(since).toISOString()
  const untilDate = new Date(until).toISOString()

  // Supabase PostgREST caps at 1000 rows per request — paginate to fetch all
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

  const trades: Trade[] = allRows.map((t: {
    id: string; account_id: string; exchange: string; symbol: string
    direction: string | null; trade_type: string; entry_price: string | null
    exit_price: string | null; quantity: string | null; pnl: string | null
    fee: string | null; opened_at: string | null; closed_at: string
  }) => ({
    id: t.id,
    subAccountId: t.account_id,
    exchangeId: t.exchange as ExchangeId,
    symbol: t.symbol,
    side: (t.direction === 'long' || t.direction === 'short') ? t.direction as TradeSide : 'long',
    tradeType: t.trade_type as TradeType,
    entryPrice: Number(t.entry_price ?? 0),
    exitPrice: Number(t.exit_price ?? 0),
    quantity: Number(t.quantity ?? 0),
    pnl: Number(t.pnl ?? 0),
    pnlPercent: 0,
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
  }))

  return NextResponse.json({ accounts, trades })
}
