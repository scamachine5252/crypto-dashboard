import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { MexcAdapter } from '@/lib/adapters/mexc'
import type { Trade, DateRange } from '@/lib/types'

const CHUNK_DAYS   = 90
const TOTAL_DAYS   = 90
const TOTAL_CHUNKS = TOTAL_DAYS / CHUNK_DAYS

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body               = await req.json() as Record<string, unknown>
  const accountId          = body.account_id          as string | undefined
  const chunkIndex         = body.chunk_index         as number | undefined
  const referenceTimestamp = body.reference_timestamp as number | undefined

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

  // Compute time window from chunk_index, anchored to reference_timestamp so all
  // chunks in the same job use the same origin and don't drift as the job progresses.
  const now     = referenceTimestamp ?? Date.now()
  const chunkMs = CHUNK_DAYS * 24 * 60 * 60 * 1000
  const since   = now - (TOTAL_CHUNKS - chunkIndex) * chunkMs
  const until   = since + chunkMs

  const accountRecord = account as Record<string, string>
  const adapter = new MexcAdapter({
    apiKey:    decrypt(accountRecord.api_key),
    apiSecret: decrypt(accountRecord.api_secret),
  })

  let trades: Trade[]
  try {
    trades = await adapter.getTrades('all', {} as DateRange, since, 1000, until)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // ── Store raw fills (idempotent, best-effort) ────────────────────────────────
  if (trades.length > 0) {
    const fillRows = trades.map((t: Trade) => ({
      account_id:  accountId,
      exchange:    'mexc',
      exec_id:     t.id,
      symbol:      t.symbol,
      category:    t.tradeType,
      exec_time:   t.closedAt,
      side:        t.side === 'long' ? 'buy' : 'sell',
      exec_qty:    t.quantity,
      exec_price:  t.exitPrice,
      exec_pnl:    t.pnl,
      exec_fee:    Math.abs(t.fee),
      closed_size: null,
      position_idx: null,
      raw_data:    { id: t.id, symbol: t.symbol, pnl: t.pnl },
      source:      'rest' as const,
    }))
    const { error: fillsError } = await supabaseAdmin
      .from('raw_fills')
      .upsert(fillRows, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })
    if (fillsError) {
      console.warn('[mexc/full] raw_fills upsert warning:', fillsError.message)
    }
  }

  return NextResponse.json({ fills: trades.length, failedCategories: [] })
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
