import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { extractBybitTransfers } from '@/lib/backfill-utils'
import * as ccxt from 'ccxt'

// Bybit: 7-day windows — same as balance backfill
const BYBIT_CHUNK_DAYS    = 7
const BYBIT_TOTAL_CHUNKS  = 13

// Binance: single chunk (90-day window works for deposits/withdrawals)
const BINANCE_TOTAL_CHUNKS = 1
const BINANCE_LOOKBACK_DAYS = 90

// ---------------------------------------------------------------------------
// GET — totalChunks
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

  const exchange    = (account as Record<string, string>).exchange
  const totalChunks = exchange === 'bybit' ? BYBIT_TOTAL_CHUNKS : BINANCE_TOTAL_CHUNKS

  return NextResponse.json({ totalChunks })
}

// ---------------------------------------------------------------------------
// POST — process one chunk
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body       = await req.json() as Record<string, unknown>
  const accountId  = body.account_id as string | undefined
  const chunkIndex = typeof body.chunk_index === 'number' ? body.chunk_index : 0

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange, api_key, api_secret')
    .eq('id', accountId)
    .single()

  if (accErr || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const acc = account as Record<string, string>

  try {
    if (acc.exchange === 'bybit') {
      return await backfillBybitTransactions(acc, chunkIndex)
    } else if (acc.exchange === 'binance') {
      return await backfillBinanceTransactions(acc)
    } else {
      return NextResponse.json({ error: `Exchange ${acc.exchange} not supported` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Bybit transactions backfill
// ---------------------------------------------------------------------------
async function backfillBybitTransactions(acc: Record<string, string>, chunkIndex: number): Promise<NextResponse> {
  const now     = Date.now()
  const chunkMs = BYBIT_CHUNK_DAYS * 24 * 60 * 60 * 1000
  const until   = now - (BYBIT_TOTAL_CHUNKS - 1 - chunkIndex) * chunkMs
  const since   = until - chunkMs

  const exchange = new ccxt.bybit({
    apiKey: decrypt(acc.api_key),
    secret: decrypt(acc.api_secret),
    options: { defaultType: 'unified' },
  })

  const toInsert: Array<Record<string, unknown>> = []

  // Deposits
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const depRaw = await (exchange as any).privateGetV5AssetDepositQueryRecord({
      startTime: since,
      endTime:   until,
      limit:     50,
    }) as Record<string, unknown>
    const depResult = (depRaw?.result ?? {}) as Record<string, unknown>
    const depList   = (depResult.rows ?? []) as Array<Record<string, string>>

    for (const d of depList) {
      if (!d['txID']) continue
      toInsert.push({
        account_id:  acc.id,
        exchange:    'bybit',
        type:        'deposit',
        asset:       d['coin'] ?? 'USDT',
        amount:      Number(d['amount'] ?? 0),
        fee:         null,
        status:      d['status'] ?? null,
        tx_id:       d['txID'],
        recorded_at: new Date(Number(d['depositFeeTime'] ?? d['createTime'] ?? since)).toISOString(),
      })
    }
  } catch {
    // No deposits in this window — ok
  }

  // Withdrawals
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wdRaw = await (exchange as any).privateGetV5AssetWithdrawQueryRecord({
      startTime: since,
      endTime:   until,
      limit:     50,
    }) as Record<string, unknown>
    const wdResult = (wdRaw?.result ?? {}) as Record<string, unknown>
    const wdList   = (wdResult.rows ?? wdResult.list ?? []) as Array<Record<string, string>>

    for (const w of wdList) {
      if (!w['withdrawId'] && !w['id']) continue
      toInsert.push({
        account_id:  acc.id,
        exchange:    'bybit',
        type:        'withdrawal',
        asset:       w['coin'] ?? 'USDT',
        amount:      Number(w['amount'] ?? 0),
        fee:         w['withdrawFee'] ? Number(w['withdrawFee']) : null,
        status:      w['status'] ?? null,
        tx_id:       w['withdrawId'] ?? w['id'],
        recorded_at: new Date(Number(w['updateTime'] ?? w['createTime'] ?? since)).toISOString(),
      })
    }
  } catch {
    // No withdrawals in this window — ok
  }

  // Internal transfers from Unified account transaction log:
  // TRANSFER_IN = funding wallet → unified (deposit equivalent)
  // TRANSFER_OUT = unified → funding wallet (withdrawal equivalent)
  // This is the primary funding mechanism for Bybit sub-accounts.
  try {
    const rows: import('@/lib/backfill-utils').BybitTxLogRow[] = []
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
      const list   = (result.list ?? []) as import('@/lib/backfill-utils').BybitTxLogRow[]
      rows.push(...list)
      cursor = result.nextPageCursor as string | undefined
      if (!cursor || list.length === 0) break
    } while (cursor)

    toInsert.push(...(extractBybitTransfers(rows, acc.id) as unknown as Record<string, unknown>[]))
  } catch {
    // Transaction log unavailable for this window — ok
  }

  const { inserted, skipped } = await upsertTransactions(toInsert)

  return NextResponse.json({
    inserted,
    skipped,
    chunk: chunkIndex,
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
  })
}

// ---------------------------------------------------------------------------
// Binance transactions backfill (single chunk)
// ---------------------------------------------------------------------------
async function backfillBinanceTransactions(acc: Record<string, string>): Promise<NextResponse> {
  const since = Date.now() - BINANCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  const exchange = new ccxt.binance({
    apiKey: decrypt(acc.api_key),
    secret: decrypt(acc.api_secret),
  })

  const toInsert: Array<Record<string, unknown>> = []

  // Deposits
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deposits = await (exchange as any).fetchDeposits(undefined, since, 500) as Array<Record<string, unknown>>
    for (const d of deposits) {
      const info = (d['info'] ?? {}) as Record<string, string>
      toInsert.push({
        account_id:  acc.id,
        exchange:    'binance',
        type:        'deposit',
        asset:       String(d['currency'] ?? 'USDT'),
        amount:      Number(d['amount'] ?? 0),
        fee:         d['fee'] ? Number((d['fee'] as Record<string, unknown>)['cost'] ?? 0) : null,
        status:      String(d['status'] ?? ''),
        tx_id:       String(d['id'] ?? info['txId'] ?? ''),
        recorded_at: d['datetime'] ? String(d['datetime']) : new Date(Number(d['timestamp'])).toISOString(),
      })
    }
  } catch {
    // ok
  }

  // Withdrawals
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withdrawals = await (exchange as any).fetchWithdrawals(undefined, since, 500) as Array<Record<string, unknown>>
    for (const w of withdrawals) {
      const info = (w['info'] ?? {}) as Record<string, string>
      toInsert.push({
        account_id:  acc.id,
        exchange:    'binance',
        type:        'withdrawal',
        asset:       String(w['currency'] ?? 'USDT'),
        amount:      Number(w['amount'] ?? 0),
        fee:         w['fee'] ? Number((w['fee'] as Record<string, unknown>)['cost'] ?? 0) : null,
        status:      String(w['status'] ?? ''),
        tx_id:       String(w['id'] ?? info['id'] ?? ''),
        recorded_at: w['datetime'] ? String(w['datetime']) : new Date(Number(w['timestamp'])).toISOString(),
      })
    }
  } catch {
    // ok
  }

  // Internal sub-account transfers via /sapi/v1/sub-account/transfer/subUserHistory
  // Accessible with sub-account's own API keys (type=1: in from master, type=2: out to master)
  for (const transferType of [1, 2] as const) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (exchange as any).sapiGetSubAccountTransferSubUserHistory({
        type:      transferType,
        startTime: since,
        endTime:   Date.now(),
        limit:     500,
      }) as Array<Record<string, string>>
      if (!Array.isArray(resp)) continue
      for (const item of resp) {
        const tranId = String(item['tranId'] ?? '')
        if (!tranId) continue
        const amount = Number(item['qty'] ?? item['amount'] ?? 0)
        if (amount === 0) continue
        if (item['status'] && item['status'] !== 'SUCCESS') continue
        toInsert.push({
          account_id:  acc.id,
          exchange:    'binance',
          type:        transferType === 1 ? 'deposit' : 'withdrawal',
          asset:       item['asset'] ?? 'USDT',
          amount,
          fee:         null,
          status:      'completed',
          tx_id:       `subtransfer_${tranId}`,
          recorded_at: new Date(Number(item['time'] ?? 0)).toISOString(),
        })
      }
    } catch {
      // endpoint unavailable for this account — ok
    }
  }

  // Internal transfers via Futures income history (non-PM accounts: FAPI; PM: PAPI UM+CM)
  try {
    const incomeRows: Array<Record<string, string>> = []
    const isPortfolioMargin = acc.instrument === 'portfolio_margin'
    const methods = isPortfolioMargin
      ? ['papiGetUmIncome', 'papiGetCmIncome']
      : ['fapiPrivateGetIncome']
    for (const method of methods) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp = await (exchange as any)[method]({
          incomeType: 'TRANSFER',
          startTime:  since,
          endTime:    Date.now(),
          limit:      1000,
        })
        if (Array.isArray(resp)) {
          incomeRows.push(...(resp as Array<Record<string, string>>))
        }
      } catch { /* method unavailable */ }
    }
    for (const item of incomeRows) {
      const amount = Number(item['income'] ?? 0)
      if (amount === 0) continue
      const tranId = String(item['tranId'] ?? '')
      if (!tranId) continue
      toInsert.push({
        account_id:  acc.id,
        exchange:    'binance',
        type:        amount > 0 ? 'deposit' : 'withdrawal',
        asset:       item['asset'] ?? 'USDT',
        amount:      Math.abs(amount),
        fee:         null,
        status:      'completed',
        tx_id:       `income_${tranId}`,
        recorded_at: new Date(Number(item['time'] ?? 0)).toISOString(),
      })
    }
  } catch { /* ok */ }

  const { inserted, skipped } = await upsertTransactions(toInsert)

  return NextResponse.json({ inserted, skipped, chunk: 0 })
}

// ---------------------------------------------------------------------------
// Shared upsert — ON CONFLICT (account_id, tx_id) DO NOTHING
// ---------------------------------------------------------------------------
async function upsertTransactions(
  rows: Array<Record<string, unknown>>,
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 }

  // Filter out rows without tx_id — can't deduplicate without it
  const valid   = rows.filter(r => r['tx_id'])
  const invalid = rows.length - valid.length

  if (valid.length === 0) return { inserted: 0, skipped: invalid }

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .upsert(valid, { onConflict: 'account_id,tx_id', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(`transactions upsert failed: ${error.message}`)

  const inserted = (data ?? []).length
  const skipped  = valid.length - inserted + invalid

  return { inserted, skipped }
}
