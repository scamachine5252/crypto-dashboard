import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BinanceAdapter } from '@/lib/adapters/binance'
import type { Trade } from '@/lib/types'

// ---------------------------------------------------------------------------
// POST — sync one raw Binance symbol across all 26 7-day windows (full 180 days).
// The caller (frontend) passes symbol (e.g. 'BTCUSDT') obtained from the discover route.
// Each call makes exactly 26 userTrades requests — always fits in Vercel's 30s timeout.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body       = await req.json() as Record<string, unknown>
  const accountId  = body.account_id as string | undefined
  const symbol     = body.symbol     as string | undefined
  const weeks      = body.weeks      as number[] | undefined

  if (!accountId)                        return NextResponse.json({ error: 'account_id required' }, { status: 400 })
  if (typeof symbol !== 'string' || !symbol.trim()) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 })
  }
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return NextResponse.json({ error: 'weeks required' }, { status: 400 })
  }

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id, api_key, api_secret, instrument')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const instrument        = (account as Record<string, string>).instrument
  const isPortfolioMargin = instrument === 'portfolio_margin'

  const adapter = new BinanceAdapter({
    apiKey:          decrypt((account as Record<string, string>).api_key),
    apiSecret:       decrypt((account as Record<string, string>).api_secret),
    portfolioMargin: isPortfolioMargin,
  })

  const { trades, failedSymbols } = await adapter.getFullTrades(symbol.trim(), weeks)

  let synced = 0
  if (trades.length > 0) {
    const seen = new Set<string>()
    const rows = trades
      .filter((t: Trade) => {
        const key = `${accountId}|${t.symbol}|${t.openedAt}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((t: Trade) => ({
        account_id:  accountId,
        exchange:    'binance',
        symbol:      t.symbol,
        side:        t.side === 'long' ? 'buy' : 'sell',
        direction:   t.side === 'long' || t.side === 'short' ? t.side : 'unknown',
        entry_price: t.entryPrice,
        exit_price:  t.exitPrice,
        quantity:    t.quantity,
        pnl:         t.pnl,
        fee:         t.fee,
        opened_at:   t.openedAt,
        closed_at:   t.closedAt,
        trade_type:  t.tradeType,
      }))

    const { error: upsertError } = await supabaseAdmin
      .from('trades')
      .upsert(rows, { onConflict: 'account_id,symbol,opened_at' })

    if (upsertError) {
      console.error('Trades upsert error:', JSON.stringify(upsertError))
      return NextResponse.json({ synced: 0, failedSymbols, upsertError: upsertError.message }, { status: 500 })
    }
    synced = rows.length
  }

  return NextResponse.json({ synced, failedSymbols })
}

// ---------------------------------------------------------------------------
// PATCH — mark full scan complete, write last_full_sync_at
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as Record<string, unknown>
  const accountId   = body.account_id   as string | undefined
  const failedCount = body.failed_count as number | undefined

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('accounts')
    .update({
      last_full_sync_at:       new Date().toISOString(),
      full_sync_failed_count:  typeof failedCount === 'number' ? failedCount : 0,
    })
    .eq('id', accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
