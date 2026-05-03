import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter } from '@/lib/adapters/bybit'
import type { ReconstructionStateJson } from '@/lib/adapters/bybit'
import type { Trade, DateRange } from '@/lib/types'

const CHUNK_DAYS   = 7    // Bybit Unified API enforces 7-day max window per request
const TOTAL_DAYS   = 182  // 26 × 7 days
const TOTAL_CHUNKS = TOTAL_DAYS / CHUNK_DAYS  // 26

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body           = await req.json() as Record<string, unknown>
  const accountId      = body.account_id      as string | undefined
  const chunkIndex     = body.chunk_index     as number | undefined
  const inheritedState = body.inherited_state as ReconstructionStateJson | undefined

  const referenceTimestamp = typeof body.reference_timestamp === 'number' ? body.reference_timestamp : undefined

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

  // Compute time window from chunk_index.
  // Use reference_timestamp if provided so all 26 chunks share the same anchor point —
  // prevents window drift when chunks are called sequentially over many seconds.
  // chunk 0 = oldest (182d–175d ago), chunk 25 = newest (7d–0d ago)
  const refTs   = referenceTimestamp ?? Date.now()
  const chunkMs = CHUNK_DAYS * 24 * 60 * 60 * 1000
  const since   = refTs - (TOTAL_CHUNKS - chunkIndex) * chunkMs
  const until   = since + chunkMs

  const adapter = new BybitAdapter({
    apiKey:    decrypt((account as Record<string, string>).api_key),
    apiSecret: decrypt((account as Record<string, string>).api_secret),
  })

  let trades: Trade[]
  let finalState: ReconstructionStateJson
  try {
    // since/until are exactly 7 days apart — within Bybit's API limit.
    // inheritedState carries open positions from the previous chunk.
    const result = await adapter.getTradesForChunk(since, until, inheritedState)
    trades     = result.trades
    finalState = result.finalState
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[bybit/full] chunk=${chunkIndex} getTradesForChunk error:`, message)
    return NextResponse.json({ error: message, chunk_index: chunkIndex }, { status: 500 })
  }

  console.log(`[bybit/full] chunk=${chunkIndex} trades=${trades.length} window=${new Date(since).toISOString()}..${new Date(until).toISOString()}`)

  let synced = 0
  let skippedNoOpenTime = 0
  if (trades.length > 0) {
    const seen = new Set<string>()
    const rows = trades
      .filter((t: Trade) => {
        // Skip trades where openedAt is unknown (position opened before this chunk's window
        // and not carried via inherited_state — e.g., positions older than 182 days)
        if (!t.openedAt) {
          skippedNoOpenTime++
          return false
        }
        const key = `${accountId}|${t.symbol}|${t.openedAt}|${t.closedAt}`
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

    if (rows.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from('trades')
        .upsert(rows, { onConflict: 'account_id,symbol,opened_at,closed_at' })

      if (upsertError) {
        console.error(`[bybit/full] chunk=${chunkIndex} upsert error:`, JSON.stringify(upsertError))
        return NextResponse.json({ synced: 0, failedCategories: [], upsertError: upsertError.message, chunk_index: chunkIndex }, { status: 500 })
      }
    }
    synced = rows.length
  }

  const warnings: string[] = trades
    .filter((t: Trade) => !t.openedAt)
    .map((t: Trade) => `no openedAt: ${t.symbol} closed=${t.closedAt}`)

  console.log(`[bybit/full] chunk=${chunkIndex} synced=${synced} skippedNoOpenTime=${skippedNoOpenTime}`)
  return NextResponse.json({
    synced,
    failedCategories:     [],
    skipped_no_open_time: skippedNoOpenTime,
    warnings,
    final_state:          finalState,  // pass to next chunk as inherited_state
  })
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

// Unused — kept for ExchangeAdapter interface compatibility if needed
export { TOTAL_CHUNKS }
