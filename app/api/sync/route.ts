import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'
import { MexcAdapter }    from '@/lib/adapters/mexc'
import { extractBybitTransfers } from '@/lib/backfill-utils'
import type { ExchangeAdapter } from '@/lib/adapters/types'
import type { DateRange } from '@/lib/types'
import * as ccxt from 'ccxt'
import { runRiskEvaluation } from '@/lib/risk/run-evaluation'

type AccountRow = {
  id: string
  account_name: string
  exchange: string
  api_key: string
  api_secret: string
  passphrase: string | null
  instrument: string | null
}

type AccountResult = {
  ok: boolean
  accountName: string
  diag: Record<string, unknown>
}

async function syncAccount(row: AccountRow, dateRange: DateRange): Promise<AccountResult> {
  const diag: Record<string, unknown> = { account: row.account_name, exchange: row.exchange }

  const apiKey    = decrypt(row.api_key)
  const apiSecret = decrypt(row.api_secret)

  let adapter: ExchangeAdapter
  switch (row.exchange) {
    case 'bybit':
      adapter = new BybitAdapter({ apiKey, apiSecret })
      break
    case 'binance': {
      const isPortfolioMargin = row.instrument === 'portfolio_margin'
      adapter = new BinanceAdapter({
        apiKey, apiSecret,
        ...(isPortfolioMargin ? { portfolioMargin: true } : {}),
      })
      break
    }
    case 'okx': {
      const passphrase = row.passphrase ? decrypt(row.passphrase) : ''
      adapter = new OkxAdapter({ apiKey, apiSecret, passphrase })
      break
    }
    case 'mexc':
      adapter = new MexcAdapter({ apiKey, apiSecret })
      break
    default:
      throw new Error(`Unknown exchange: ${row.exchange}`)
  }

  // Fetch and persist balance
  const balance = await adapter.fetchBalance()
  diag.balance = { usdt: balance.usdt, tokens: Object.keys(balance.tokens) }
  const recordedAt = new Date().toISOString()

  // Batch all balance inserts: one USDT row + one row per token
  const balanceRows = [
    {
      account_id:        row.id,
      usdt_balance:      balance.usdt,
      total_equity_usdt: balance.totalEquityUsdt ?? null,
      recorded_at:       recordedAt,
    },
    ...Object.entries(balance.tokens).map(([symbol, amount]) => ({
      account_id:    row.id,
      usdt_balance:  0,
      token_symbol:  symbol,
      token_balance: amount,
      recorded_at:   recordedAt,
    })),
  ]
  await supabaseAdmin.from('balances').insert(balanceRows)

  // Fetch and upsert trades
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000
  const trades = await adapter.getTrades('all', dateRange, since)
  diag.tradesFetched = trades.length
  if (trades.length > 0) {
    const allTrades = trades.map((t) => ({
      account_id:  row.id,
      exchange:    row.exchange,
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
    // Deduplicate by unique constraint key — PostgreSQL cannot upsert the same key twice
    const seen = new Set<string>()
    const tradesToInsert = allTrades.filter((t) => {
      const key = `${t.account_id}|${t.symbol}|${t.opened_at}|${t.closed_at}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const { error: tradesError } = await supabaseAdmin
      .from('trades')
      .upsert(tradesToInsert, { onConflict: 'account_id,symbol,opened_at,closed_at' })
    if (tradesError) {
      diag.tradesUpsertError = tradesError
      console.error('Trades upsert error:', JSON.stringify(tradesError))
    } else {
      diag.tradesUpserted = trades.length
    }
  }

  // Fetch and upsert deposits/withdrawals for last 48h
  const txRows: Array<Record<string, unknown>> = []
  try {
    if (row.exchange === 'bybit') {
      const bybitEx = new ccxt.bybit({
        apiKey,
        secret: apiSecret,
        options: { defaultType: 'unified' },
      })
      // External deposits
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const depRaw = await (bybitEx as any).privateGetV5AssetDepositQueryRecord({
          startTime: since, endTime: Date.now(), limit: 50,
        }) as Record<string, unknown>
        const depList = ((depRaw?.result as Record<string, unknown>)?.rows ?? []) as Array<Record<string, string>>
        for (const d of depList) {
          if (!d['txID']) continue
          txRows.push({
            account_id: row.id, exchange: 'bybit', type: 'deposit',
            asset: d['coin'] ?? 'USDT', amount: Number(d['amount'] ?? 0),
            fee: null, status: d['status'] ?? null, tx_id: d['txID'],
            recorded_at: new Date(Number(d['depositFeeTime'] ?? d['createTime'] ?? since)).toISOString(),
          })
        }
      } catch { /* ok */ }
      // External withdrawals
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wdRaw = await (bybitEx as any).privateGetV5AssetWithdrawQueryRecord({
          startTime: since, endTime: Date.now(), limit: 50,
        }) as Record<string, unknown>
        const wdList = ((wdRaw?.result as Record<string, unknown>)?.list ?? []) as Array<Record<string, string>>
        for (const w of wdList) {
          if (!w['withdrawId'] && !w['id']) continue
          txRows.push({
            account_id: row.id, exchange: 'bybit', type: 'withdrawal',
            asset: w['coin'] ?? 'USDT', amount: Number(w['amount'] ?? 0),
            fee: w['withdrawFee'] ? Number(w['withdrawFee']) : null,
            status: w['status'] ?? null, tx_id: w['withdrawId'] ?? w['id'],
            recorded_at: new Date(Number(w['updateTime'] ?? w['createTime'] ?? since)).toISOString(),
          })
        }
      } catch { /* ok */ }
      // Internal sub-account transfers via transaction-log (TRANSFER_IN / TRANSFER_OUT)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resp = await (bybitEx as any).privateGetV5AccountTransactionLog({
          accountType: 'UNIFIED', startTime: since, endTime: Date.now(), limit: 100,
        }) as Record<string, unknown>
        const list = ((resp?.result as Record<string, unknown>)?.list ?? []) as import('@/lib/backfill-utils').BybitTxLogRow[]
        const transfers = extractBybitTransfers(list, row.id) as unknown as Record<string, unknown>[]
        txRows.push(...transfers)
      } catch { /* ok */ }
    } else if (row.exchange === 'binance') {
      const binEx = new ccxt.binance({ apiKey, secret: apiSecret })
      // External blockchain deposits/withdrawals
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const deposits = await (binEx as any).fetchDeposits(undefined, since, 100) as Array<Record<string, unknown>>
        for (const d of deposits) {
          const info = (d['info'] ?? {}) as Record<string, string>
          txRows.push({
            account_id: row.id, exchange: 'binance', type: 'deposit',
            asset: String(d['currency'] ?? 'USDT'), amount: Number(d['amount'] ?? 0),
            fee: d['fee'] ? Number((d['fee'] as Record<string, unknown>)['cost'] ?? 0) : null,
            status: String(d['status'] ?? ''), tx_id: String(d['id'] ?? info['txId'] ?? ''),
            recorded_at: d['datetime'] ? String(d['datetime']) : new Date(Number(d['timestamp'])).toISOString(),
          })
        }
      } catch { /* ok */ }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const withdrawals = await (binEx as any).fetchWithdrawals(undefined, since, 100) as Array<Record<string, unknown>>
        for (const w of withdrawals) {
          const info = (w['info'] ?? {}) as Record<string, string>
          txRows.push({
            account_id: row.id, exchange: 'binance', type: 'withdrawal',
            asset: String(w['currency'] ?? 'USDT'), amount: Number(w['amount'] ?? 0),
            fee: w['fee'] ? Number((w['fee'] as Record<string, unknown>)['cost'] ?? 0) : null,
            status: String(w['status'] ?? ''), tx_id: String(w['id'] ?? info['id'] ?? ''),
            recorded_at: w['datetime'] ? String(w['datetime']) : new Date(Number(w['timestamp'])).toISOString(),
          })
        }
      } catch { /* ok */ }
      // Internal sub-account transfers (type=1: in, type=2: out)
      for (const transferType of [1, 2] as const) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const resp = await (binEx as any).sapiGetSubAccountTransferSubUserHistory({
            type: transferType, startTime: since, endTime: Date.now(), limit: 500,
          }) as Array<Record<string, string>>
          if (!Array.isArray(resp)) continue
          for (const item of resp) {
            const tranId = String(item['tranId'] ?? '')
            if (!tranId) continue
            const amount = Number(item['qty'] ?? item['amount'] ?? 0)
            if (amount === 0) continue
            if (item['status'] && item['status'] !== 'SUCCESS') continue
            txRows.push({
              account_id: row.id, exchange: 'binance',
              type: transferType === 1 ? 'deposit' : 'withdrawal',
              asset: item['asset'] ?? 'USDT', amount,
              fee: null, status: 'completed',
              tx_id: `subtransfer_${tranId}`,
              recorded_at: new Date(Number(item['time'] ?? 0)).toISOString(),
            })
          }
        } catch { /* ok */ }
      }
      // Internal transfers via Futures/PM income history
      try {
        const incomeRows: Array<Record<string, string>> = []
        const isPortfolioMargin = row.instrument === 'portfolio_margin'
        const methods = isPortfolioMargin
          ? ['papiGetUmIncome', 'papiGetCmIncome']
          : ['fapiPrivateGetIncome']
        for (const method of methods) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resp = await (binEx as any)[method]({
              incomeType: 'TRANSFER', startTime: since, endTime: Date.now(), limit: 1000,
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
          txRows.push({
            account_id: row.id, exchange: 'binance',
            // PM income distributions (Flexible Earn / BTC lending yield) are not capital inflows
            type: isPortfolioMargin ? 'income' : (amount > 0 ? 'deposit' : 'withdrawal'),
            asset: item['asset'] ?? 'USDT', amount: Math.abs(amount),
            fee: null, status: 'completed',
            tx_id: `income_${tranId}`,
            recorded_at: new Date(Number(item['time'] ?? 0)).toISOString(),
          })
        }
      } catch { /* ok */ }
    }
    const validTx = txRows.filter(r => r['tx_id'])
    if (validTx.length > 0) {
      await supabaseAdmin.from('transactions').upsert(validTx, { onConflict: 'account_id,tx_id', ignoreDuplicates: true })
      diag.transactionsSynced = validTx.length
    }
  } catch (txErr) {
    diag.transactionsError = txErr instanceof Error ? txErr.message : String(txErr)
  }

  await supabaseAdmin
    .from('accounts')
    .update({ last_incremental_sync_at: new Date().toISOString() })
    .eq('id', row.id)

  diag.status = 'ok'
  return { ok: true, accountName: row.account_name, diag }
}

// ---------------------------------------------------------------------------
// Shared sync logic
// ---------------------------------------------------------------------------
async function runSync(): Promise<NextResponse> {
  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, api_key, api_secret, passphrase, instrument')

  if (accountsError) {
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
  }

  const rows = (accounts ?? []) as AccountRow[]
  const dateRange: DateRange = { start: '2000-01-01', end: '2099-12-31' }

  // Process all accounts in parallel — previously sequential (for...of), causing
  // 10× the latency as each account's exchange API calls blocked the next.
  const settled = await Promise.allSettled(
    rows.map((row) => syncAccount(row, dateRange))
  )

  let synced = 0
  let errors = 0
  const syncedAccounts: string[] = []
  const diagnostics: Record<string, unknown>[] = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      synced++
      syncedAccounts.push(result.value.accountName)
      diagnostics.push(result.value.diag)
    } else {
      errors++
      const row = rows[i]
      diagnostics.push({
        account:  row.account_name,
        exchange: row.exchange,
        status:   'error',
        error:    result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
      console.error(`Sync error for account ${row.account_name}:`, result.reason)
    }
  }

  // Risk evaluation after sync — errors don't block response
  let riskResult: { evaluated: number; violations: number } = { evaluated: 0, violations: 0 }
  try {
    riskResult = await runRiskEvaluation()
  } catch (e) {
    console.error('Risk evaluation error:', e)
  }

  return NextResponse.json(
    { synced, errors, accounts: syncedAccounts, diagnostics, risk: riskResult },
    { status: 200 },
  )
}

// POST /api/sync — manual trigger
export async function POST(_req: NextRequest): Promise<NextResponse> {
  return runSync()
}

// GET /api/sync — Vercel Cron Job trigger (runs on schedule)
export async function GET(_req: NextRequest): Promise<NextResponse> {
  return runSync()
}
