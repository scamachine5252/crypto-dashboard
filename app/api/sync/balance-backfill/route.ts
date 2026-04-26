import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { mergeBinanceBalances, extractUsdtFromSnapshot } from '@/lib/backfill-utils'
import * as ccxt from 'ccxt'

// Bybit: 7-day windows, 13 chunks = 91 days
const BYBIT_CHUNK_DAYS = 7
const BYBIT_TOTAL_CHUNKS = 13

// Binance: 30-day windows, 3 chunks = 90 days
const BINANCE_CHUNK_DAYS = 30
const BINANCE_TOTAL_CHUNKS = 3

// ---------------------------------------------------------------------------
// GET — return totalChunks for this account
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest): Promise<NextResponse> {
  const accountId = req.nextUrl.searchParams.get('account_id')
  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error } = await supabaseAdmin
    .from('accounts')
    .select('exchange')
    .eq('id', accountId)
    .single()

  if (error || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const exchange = (account as Record<string, string>).exchange
  const totalChunks = exchange === 'bybit' ? BYBIT_TOTAL_CHUNKS : BINANCE_TOTAL_CHUNKS

  return NextResponse.json({ totalChunks })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Group Bybit transaction-log rows by date, keep last cashBalance per day
function groupByDay(rows: Array<Record<string, string>>): Record<string, number> {
  const map: Record<string, { time: number; balance: number }> = {}
  for (const row of rows) {
    const t    = Number(row['transactionTime'])
    const date = new Date(t).toISOString().slice(0, 10)
    if (!map[date] || t > map[date].time) {
      map[date] = { time: t, balance: Number(row['cashBalance']) }
    }
  }
  const result: Record<string, number> = {}
  for (const [date, { balance }] of Object.entries(map)) result[date] = balance
  return result
}

// Fetch existing balance dates for an account (to skip duplicates)
async function existingDates(accountId: string): Promise<Set<string>> {
  const dates = new Set<string>()
  let from = 0
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('balances')
      .select('recorded_at')
      .eq('account_id', accountId)
      .is('token_symbol', null)
      .range(from, from + 999)
    if (error || !data || data.length === 0) break
    for (const row of data as Array<{ recorded_at: string }>) {
      dates.add(row.recorded_at.slice(0, 10))
    }
    if (data.length < 1000) break
    from += 1000
  }
  return dates
}

// ---------------------------------------------------------------------------
// POST — process one chunk
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body       = await req.json() as Record<string, unknown>
  const accountId  = body.account_id as string | undefined
  const chunkIndex = typeof body.chunk_index === 'number' ? body.chunk_index : undefined

  if (!accountId)           return NextResponse.json({ error: 'account_id required' }, { status: 400 })
  if (chunkIndex === undefined) return NextResponse.json({ error: 'chunk_index required' }, { status: 400 })

  const { data: account, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange, instrument, api_key, api_secret')
    .eq('id', accountId)
    .single()

  if (accErr || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const acc = account as Record<string, string>

  try {
    if (acc.exchange === 'bybit') {
      return await backfillBybit(acc, chunkIndex)
    } else if (acc.exchange === 'binance') {
      return await backfillBinance(acc, chunkIndex)
    } else {
      return NextResponse.json({ error: `Exchange ${acc.exchange} not supported` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Bybit backfill
// ---------------------------------------------------------------------------
async function backfillBybit(acc: Record<string, string>, chunkIndex: number): Promise<NextResponse> {
  const now   = Date.now()
  // chunk 0 = oldest, chunk 12 = newest
  const chunkMs = BYBIT_CHUNK_DAYS * 24 * 60 * 60 * 1000
  const until = now - (BYBIT_TOTAL_CHUNKS - 1 - chunkIndex) * chunkMs
  const since = until - chunkMs

  const exchange = new ccxt.bybit({
    apiKey: decrypt(acc.api_key),
    secret: decrypt(acc.api_secret),
    options: { defaultType: 'unified' },
  })

  // Paginate transaction log
  const rows: Array<Record<string, string>> = []
  let cursor: string | undefined
  do {
    const params: Record<string, unknown> = {
      accountType: 'UNIFIED',
      startTime:   since,
      endTime:     until,
      limit:       100,
    }
    if (cursor) params['cursor'] = cursor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp   = await (exchange as any).privateGetV5AccountTransactionLog(params) as Record<string, unknown>
    const result = (resp?.result ?? {}) as Record<string, unknown>
    const list   = (result.list ?? []) as Array<Record<string, string>>
    rows.push(...list)
    cursor = result.nextPageCursor as string | undefined
    if (!cursor || list.length === 0) break
  } while (cursor)

  const dayMap = groupByDay(rows)
  const skip   = await existingDates(acc.id)

  let inserted = 0
  let skipped  = 0
  for (const [date, balance] of Object.entries(dayMap)) {
    if (skip.has(date)) { skipped++; continue }
    // Use noon UTC so the date is unambiguous in any timezone
    const recordedAt = `${date}T12:00:00.000Z`
    const { error } = await supabaseAdmin.from('balances').insert({
      account_id:   acc.id,
      usdt_balance: balance,
      recorded_at:  recordedAt,
    })
    if (!error) inserted++
  }

  return NextResponse.json({
    inserted,
    skipped,
    chunk: chunkIndex,
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
  })
}

// ---------------------------------------------------------------------------
// Binance backfill
// ---------------------------------------------------------------------------
async function backfillBinance(acc: Record<string, string>, chunkIndex: number): Promise<NextResponse> {
  const now     = Date.now()
  const chunkMs = BINANCE_CHUNK_DAYS * 24 * 60 * 60 * 1000
  const until   = now - (BINANCE_TOTAL_CHUNKS - 1 - chunkIndex) * chunkMs
  const since   = until - chunkMs

  const exchange = new ccxt.binance({
    apiKey: decrypt(acc.api_key),
    secret: decrypt(acc.api_secret),
  })

  const isPortfolioMargin = acc.instrument === 'portfolio_margin'

  // Fetch a snapshot type and build a date→USDT map
  async function fetchSnapshotMap(type: string): Promise<Record<string, number>> {
    const map: Record<string, number> = {}
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (exchange as any).sapiGetAccountSnapshot({
        type,
        startTime: since,
        endTime:   until,
        limit:     30,
      }) as Record<string, unknown>
      const list = (resp?.snapshotVos ?? []) as Array<Record<string, unknown>>
      for (const snap of list) {
        const date = new Date(Number(snap['updateTime'])).toISOString().slice(0, 10)
        const data = (snap['data'] ?? {}) as Record<string, unknown>
        const bal  = extractUsdtFromSnapshot(data)
        // keep max per date in case of duplicate snapshots
        if (bal > (map[date] ?? 0)) map[date] = bal
      }
    } catch {
      // snapshot type unavailable — ok
    }
    return map
  }

  const [futuresMap, marginMap] = await Promise.all([
    fetchSnapshotMap('FUTURES'),
    fetchSnapshotMap('MARGIN'),
  ])

  const merged = mergeBinanceBalances(futuresMap, marginMap, isPortfolioMargin)

  const skip   = await existingDates(acc.id)
  let inserted = 0
  let skipped  = 0

  for (const [date, balance] of Object.entries(merged)) {
    if (skip.has(date)) { skipped++; continue }
    const recordedAt = `${date}T12:00:00.000Z`
    const { error } = await supabaseAdmin.from('balances').insert({
      account_id:   acc.id,
      usdt_balance: balance,
      recorded_at:  recordedAt,
    })
    if (!error) inserted++
  }

  return NextResponse.json({
    inserted,
    skipped,
    chunk: chunkIndex,
    futures_dates: Object.keys(futuresMap).length,
    margin_dates:  Object.keys(marginMap).length,
    is_portfolio_margin: isPortfolioMargin,
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
  })
}
