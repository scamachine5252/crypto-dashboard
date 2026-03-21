import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import * as ccxt from 'ccxt'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BinanceAdapter } from '@/lib/adapters/binance'
import type { Trade } from '@/lib/types'

const CHUNK_SIZE = 50

async function loadSortedUsdtSymbols(): Promise<string[]> {
  const exchange = new ccxt.binance()
  const markets = await exchange.loadMarkets()
  return Object.values(markets)
    .filter((m): m is NonNullable<typeof m> => m != null && m.quote === 'USDT')
    .map((m) => m.symbol)
    .sort()
}

// ---------------------------------------------------------------------------
// POST — sync one chunk of symbols for one account
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as Record<string, unknown>
  const accountId  = body.account_id  as string | undefined
  const chunkIndex = body.chunk_index as number | undefined

  if (!accountId)               return NextResponse.json({ error: 'account_id required' }, { status: 400 })
  if (chunkIndex === undefined) return NextResponse.json({ error: 'chunk_index required' }, { status: 400 })
  if (typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json({ error: 'chunk_index must be a non-negative integer' }, { status: 400 })
  }

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id, api_key, api_secret')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  let allSymbols: string[]
  try {
    allSymbols = await loadSortedUsdtSymbols()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
  const start  = chunkIndex * CHUNK_SIZE
  const symbols = allSymbols.slice(start, start + CHUNK_SIZE)

  if (symbols.length === 0) {
    return NextResponse.json({ synced: 0, failedSymbols: [] })
  }

  const adapter = new BinanceAdapter({
    apiKey:    decrypt((account as Record<string, string>).api_key),
    apiSecret: decrypt((account as Record<string, string>).api_secret),
  })

  const { trades, failedSymbols } = await adapter.getFullTrades(symbols)

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
  const accountId = body.account_id as string | undefined

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('accounts')
    .update({ last_full_sync_at: new Date().toISOString() })
    .eq('id', accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
