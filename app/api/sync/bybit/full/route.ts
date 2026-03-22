import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter } from '@/lib/adapters/bybit'
import type { Trade, DateRange } from '@/lib/types'

const CHUNK_DAYS   = 7    // Bybit Unified API enforces 7-day max window per request
const TOTAL_DAYS   = 182  // 26 × 7 days
const TOTAL_CHUNKS = TOTAL_DAYS / CHUNK_DAYS  // 26

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body       = await req.json() as Record<string, unknown>
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

  // Compute time window from chunk_index
  // chunk 0 = oldest (180d–150d ago), chunk 5 = newest (30d–0d ago)
  const now     = Date.now()
  const chunkMs = CHUNK_DAYS * 24 * 60 * 60 * 1000
  const since   = now - (TOTAL_CHUNKS - chunkIndex) * chunkMs
  const until   = since + chunkMs

  const adapter = new BybitAdapter({
    apiKey:    decrypt((account as Record<string, string>).api_key),
    apiSecret: decrypt((account as Record<string, string>).api_secret),
  })

  let trades: Trade[]
  try {
    // since/until are exactly 7 days apart — within Bybit's API limit.
    // CCXT receives endTime correctly and paginates via cursor until exhausted.
    trades = await adapter.getTrades('all', {} as DateRange, since, 1000, until)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

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
        exchange:    'bybit',
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
      return NextResponse.json({ synced: 0, failedCategories: [], upsertError: upsertError.message }, { status: 500 })
    }
    synced = rows.length
  }

  return NextResponse.json({ synced, failedCategories: [] })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body        = await req.json() as Record<string, unknown>
  const accountId   = body.account_id   as string | undefined
  const failedCount = body.failed_count as number | undefined

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('accounts')
    .update({
      last_full_sync_at:      new Date().toISOString(),
      full_sync_failed_count: typeof failedCount === 'number' ? failedCount : 0,
    })
    .eq('id', accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
