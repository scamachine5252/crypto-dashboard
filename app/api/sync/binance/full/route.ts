import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BinanceAdapter } from '@/lib/adapters/binance'
// ---------------------------------------------------------------------------
// POST — sync one raw Binance symbol across all 26 7-day windows (full 180 days).
// The caller (frontend) passes symbol (e.g. 'BTCUSDT') obtained from the discover route.
// Each call makes exactly 26 userTrades requests — always fits in Vercel's 30s timeout.
//
// IMPORTANT: This route writes ONLY to raw_fills. PositionReconstructor is the
// sole writer of trades. Writing trades here caused duplicate rows when
// discoverTradedSymbols returned different weekIndices on re-runs, producing
// rows with different opened_at that both survived the upsert conflict key.
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

  let failedSymbols: { symbol: string; error: string }[], rawFills: import('@/lib/adapters/binance').RawFapiTrade[]
  try {
    ;({ failedSymbols, rawFills } = await adapter.getFullTrades(symbol.trim(), weeks))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[binance/full] getFullTrades error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // ── Store raw fills (idempotent, best-effort) ────────────────────────────────
  // exec_id = tradeId (field 'id') — unique fill ID from Binance FAPI/PAPI.
  if (rawFills.length > 0) {
    const fillRows = rawFills.map(f => ({
      account_id:  accountId,
      exchange:    'binance',
      exec_id:     String(f.id),
      symbol:      f.symbol,
      category:    f.positionSide,  // 'LONG'/'SHORT'/'BOTH' — hedge/one-way signal
      exec_time:   f.time != null ? new Date(Number(f.time)).toISOString() : new Date().toISOString(),
      side:        f.side,
      exec_qty:    Number(f.qty),
      exec_price:  Number(f.price),
      exec_pnl:    Number(f.realizedPnl),
      exec_fee:    Math.abs(Number(f.commission)),
      closed_size: null,
      position_idx: null,
      raw_data:    f,
      source:      'rest' as const,
    }))
    const { error: fillsError } = await supabaseAdmin
      .from('raw_fills')
      .upsert(fillRows, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })
    if (fillsError) {
      console.warn('[binance/full] raw_fills upsert warning:', fillsError.message)
    }
  }

  return NextResponse.json({ fills: rawFills.length, failedSymbols })
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
