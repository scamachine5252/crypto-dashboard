import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { Trade, ExchangeId, TradeType, TradeSide } from '@/lib/types'

type DbTrade = {
  id: string
  account_id: string
  exchange: string
  symbol: string
  direction: string | null
  trade_type: string
  entry_price: number | null
  exit_price: number | null
  quantity: number | null
  pnl: number | null
  fee: number | null
  opened_at: string | null
  closed_at: string
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0')
  const until = Number(req.nextUrl.searchParams.get('until') ?? Date.now())

  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, fund')

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts || accounts.length === 0) return NextResponse.json({ trades: [], accounts: [] })

  const accountIds = (accounts as Array<{ id: string }>).map((a) => a.id)
  const sinceDate = new Date(since).toISOString()
  const untilDate = new Date(until).toISOString()

  const { data: rows, error: tradeErr } = await supabaseAdmin
    .from('trades')
    .select('id, account_id, exchange, symbol, direction, trade_type, entry_price, exit_price, quantity, pnl, fee, opened_at, closed_at')
    .in('account_id', accountIds)
    .gte('closed_at', sinceDate)
    .lte('closed_at', untilDate)
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: false })
    .limit(10000)

  if (tradeErr) return NextResponse.json({ error: tradeErr.message }, { status: 500 })

  const trades: Trade[] = ((rows ?? []) as DbTrade[]).map((t) => ({
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

  return NextResponse.json({ trades, accounts })
}
