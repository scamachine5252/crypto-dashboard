import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import * as ccxt from 'ccxt'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'

// GET /api/debug/trades?account_id=xxx&category=linear&limit=3
// Returns raw CCXT trade info fields so we can see what PnL fields are available.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const accountId = req.nextUrl.searchParams.get('account_id')
  const category  = req.nextUrl.searchParams.get('category') ?? 'linear'
  const limit     = Number(req.nextUrl.searchParams.get('limit') ?? '3')

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange, api_key, api_secret, passphrase')
    .eq('id', accountId)
    .single()

  if (error || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const acc = account as Record<string, string>

  try {
    let raw: ccxt.Trade[]

    if (acc.exchange === 'bybit') {
      const exchange = new ccxt.bybit({
        apiKey: decrypt(acc.api_key),
        secret: decrypt(acc.api_secret),
        options: { defaultType: 'unified' },
      })
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000 // last 7 days
      raw = await exchange.fetchMyTrades(undefined, since, limit, { category }) as ccxt.Trade[]
    } else if (acc.exchange === 'binance') {
      const exchange = new ccxt.binance({
        apiKey: decrypt(acc.api_key),
        secret: decrypt(acc.api_secret),
        options: { defaultType: 'future' },
      })
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000
      raw = await exchange.fetchMyTrades('BTC/USDT', since, limit) as ccxt.Trade[]
    } else {
      return NextResponse.json({ error: 'Unsupported exchange' }, { status: 400 })
    }

    const result = raw.map((t) => ({
      id:       t.id,
      symbol:   t.symbol,
      side:     t.side,
      price:    t.price,
      amount:   t.amount,
      fee:      t.fee,
      datetime: t.datetime,
      // The raw info fields — this is what we use for PnL
      info:     t.info,
    }))

    return NextResponse.json({ exchange: acc.exchange, category, count: result.length, trades: result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
