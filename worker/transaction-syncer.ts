import 'server-only'
import * as ccxt from 'ccxt'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import {
  extractBybitTransfers,
  extractBybitFundingFees,
  type BybitTxLogRow,
} from '@/lib/backfill-utils'
import { binanceBanGuard } from './binance-ban-guard'

const WINDOW_MS        = 7 * 24 * 60 * 60 * 1000   // rolling 7-day lookback
const INTERVAL_MS      = 6 * 60 * 60 * 1000          // run every 6h
const STARTUP_DELAY_MS = 8 * 60 * 1000               // +8min after worker start

// Rate-limit budget per full run (11 accounts):
//   Bybit (4):       3 calls each × ~5 wt  = ~60 wt  (limit: 120 req/min/key)
//   Binance reg (4): ~4 calls each × ~5 wt = ~80 wt  (limit: 2400 wt/min)
//   Binance PM (3):  ~5 calls each × ~5 wt = ~75 wt
//   Total: ~215 wt every 6h → negligible risk

interface AccountRow {
  id:          string
  exchange:    string
  api_key:     string
  api_secret:  string
  passphrase?: string | null
  instrument?: string | null
}

type TxInsert = {
  account_id:  string
  exchange:    string
  type:        string
  asset:       string
  amount:      number
  fee:         number | null
  status:      string | null
  tx_id:       string
  recorded_at: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FapiEx = Record<string, (p: unknown) => Promise<unknown>>

export class TransactionSyncer {
  private timer:        ReturnType<typeof setInterval> | null = null
  private startupTimer: ReturnType<typeof setTimeout>  | null = null

  start(): void {
    // +8min delay: after Binance reconciler (+5min) and balance poller (+3min)
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      void this.runAll()
      this.timer = setInterval(() => void this.runAll(), INTERVAL_MS)
      this.timer.unref?.()
    }, STARTUP_DELAY_MS)
  }

  stop(): void {
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null }
    if (this.timer)        { clearInterval(this.timer);       this.timer = null }
  }

  async runAll(): Promise<void> {
    console.log('[transaction-syncer] starting run')

    const { data: accounts, error } = await supabaseAdmin
      .from('accounts')
      .select('id, exchange, api_key, api_secret, passphrase, instrument, is_suspended')
      .eq('is_suspended', false)

    if (error) {
      console.error('[transaction-syncer] failed to load accounts:', error.message)
      return
    }

    for (const acct of (accounts ?? []) as AccountRow[]) {
      try {
        if (acct.exchange === 'bybit') {
          await this.syncBybit(acct)
        } else if (acct.exchange === 'binance') {
          await this.syncBinance(acct)
        }
        // OKX: /api/v5/account/bills type=8 — add when OKX accounts go live
      } catch (e) {
        console.error(`[transaction-syncer] ${acct.id} (${acct.exchange}) failed:`, e)
      }
    }

    console.log('[transaction-syncer] run complete')
  }

  // ---------------------------------------------------------------------------
  // Bybit: deposits + withdrawals + tx-log (transfers + funding fees)
  // ---------------------------------------------------------------------------
  private async syncBybit(acct: AccountRow): Promise<void> {
    const since = Date.now() - WINDOW_MS
    const until = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ex = new (ccxt as any).bybit({
      apiKey: decrypt(acct.api_key),
      secret: decrypt(acct.api_secret),
      options: { defaultType: 'unified' },
    }) as FapiEx

    const rows: TxInsert[] = []

    // External deposits
    try {
      const raw    = await ex['privateGetV5AssetDepositQueryRecord']({ startTime: since, endTime: until, limit: 50 }) as Record<string, unknown>
      const list   = ((raw?.result as Record<string, unknown>)?.rows ?? []) as Array<Record<string, string>>
      for (const d of list) {
        if (!d['txID']) continue
        rows.push({
          account_id: acct.id, exchange: 'bybit', type: 'deposit',
          asset:       d['coin'] ?? 'USDT',
          amount:      Math.abs(Number(d['amount'] ?? 0)),
          fee:         null, status: d['status'] ?? null,
          tx_id:       d['txID'],
          recorded_at: new Date(Number(d['depositFeeTime'] ?? d['createTime'] ?? since)).toISOString(),
        })
      }
    } catch { /* no deposits */ }

    // External withdrawals
    try {
      const raw    = await ex['privateGetV5AssetWithdrawQueryRecord']({ startTime: since, endTime: until, limit: 50 }) as Record<string, unknown>
      const result = (raw?.result ?? {}) as Record<string, unknown>
      const list   = (result.rows ?? result.list ?? []) as Array<Record<string, string>>
      for (const w of list) {
        const id = w['withdrawId'] ?? w['id']
        if (!id) continue
        rows.push({
          account_id: acct.id, exchange: 'bybit', type: 'withdrawal',
          asset:       w['coin'] ?? 'USDT',
          amount:      Math.abs(Number(w['amount'] ?? 0)),
          fee:         w['withdrawFee'] ? Number(w['withdrawFee']) : null,
          status:      w['status'] ?? null, tx_id: String(id),
          recorded_at: new Date(Number(w['updateTime'] ?? w['createTime'] ?? since)).toISOString(),
        })
      }
    } catch { /* no withdrawals */ }

    // Transaction log — transfers (TRANSFER_IN/OUT) + funding fees (SETTLEMENT)
    try {
      const txLogRows: BybitTxLogRow[] = []
      let cursor: string | undefined
      do {
        const params: Record<string, unknown> = { accountType: 'UNIFIED', startTime: since, endTime: until, limit: 100 }
        if (cursor) params['cursor'] = cursor
        const resp   = await ex['privateGetV5AccountTransactionLog'](params) as Record<string, unknown>
        const result = (resp?.result ?? {}) as Record<string, unknown>
        const list   = (result.list ?? []) as BybitTxLogRow[]
        txLogRows.push(...list)
        cursor = result.nextPageCursor as string | undefined
        if (!cursor || list.length === 0) break
      } while (cursor)

      rows.push(...(extractBybitTransfers(txLogRows, acct.id) as unknown as TxInsert[]))
      rows.push(...(extractBybitFundingFees(txLogRows, acct.id) as unknown as TxInsert[]))
    } catch (e) {
      console.warn(`[transaction-syncer] Bybit tx-log failed for ${acct.id}:`, e)
    }

    await this.upsert(rows)
  }

  // ---------------------------------------------------------------------------
  // Binance: deposits + withdrawals + sub-transfers + funding fees (FAPI / PAPI)
  // ---------------------------------------------------------------------------
  private async syncBinance(acct: AccountRow): Promise<void> {
    if (binanceBanGuard.isBanned()) {
      console.warn('[transaction-syncer] Binance IP banned — skipping')
      return
    }

    const since = Date.now() - WINDOW_MS
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ex = new (ccxt as any).binance({
      apiKey: decrypt(acct.api_key),
      secret: decrypt(acct.api_secret),
    }) as FapiEx

    const rows: TxInsert[] = []

    // External deposits
    try {
      const deposits = await (ex as unknown as ccxt.binance).fetchDeposits(undefined, since, 200) as unknown as Array<Record<string, unknown>>
      for (const d of deposits) {
        const info  = (d['info'] ?? {}) as Record<string, string>
        const txId  = String(d['id'] ?? info['txId'] ?? '')
        if (!txId) continue
        rows.push({
          account_id: acct.id, exchange: 'binance', type: 'deposit',
          asset:       String(d['currency'] ?? 'USDT'),
          amount:      Math.abs(Number(d['amount'] ?? 0)),
          fee:         d['fee'] ? Number((d['fee'] as Record<string, unknown>)['cost'] ?? 0) : null,
          status:      String(d['status'] ?? ''), tx_id: txId,
          recorded_at: d['datetime'] ? String(d['datetime']) : new Date(Number(d['timestamp'])).toISOString(),
        })
      }
    } catch { /* ok */ }

    // External withdrawals
    try {
      const withdrawals = await (ex as unknown as ccxt.binance).fetchWithdrawals(undefined, since, 200) as unknown as Array<Record<string, unknown>>
      for (const w of withdrawals) {
        const info = (w['info'] ?? {}) as Record<string, string>
        const txId = String(w['id'] ?? info['id'] ?? '')
        if (!txId) continue
        rows.push({
          account_id: acct.id, exchange: 'binance', type: 'withdrawal',
          asset:       String(w['currency'] ?? 'USDT'),
          amount:      Math.abs(Number(w['amount'] ?? 0)),
          fee:         w['fee'] ? Number((w['fee'] as Record<string, unknown>)['cost'] ?? 0) : null,
          status:      String(w['status'] ?? ''), tx_id: txId,
          recorded_at: w['datetime'] ? String(w['datetime']) : new Date(Number(w['timestamp'])).toISOString(),
        })
      }
    } catch { /* ok */ }

    // Internal sub-account transfers (type 1 = in from master, 2 = out to master)
    for (const transferType of [1, 2] as const) {
      try {
        const resp = await ex['sapiGetSubAccountTransferSubUserHistory']({
          type: transferType, startTime: since, endTime: Date.now(), limit: 200,
        }) as Array<Record<string, string>>
        if (!Array.isArray(resp)) continue
        for (const item of resp) {
          const tranId = String(item['tranId'] ?? '')
          if (!tranId) continue
          const amount = Number(item['qty'] ?? item['amount'] ?? 0)
          if (amount === 0) continue
          if (item['status'] && item['status'] !== 'SUCCESS') continue
          rows.push({
            account_id: acct.id, exchange: 'binance',
            type:        transferType === 1 ? 'deposit' : 'withdrawal',
            asset:       item['asset'] ?? 'USDT',
            amount:      Math.abs(amount),
            fee: null, status: 'completed',
            tx_id:       `subtransfer_${tranId}`,
            recorded_at: new Date(Number(item['time'] ?? 0)).toISOString(),
          })
        }
      } catch { /* endpoint unavailable for this account */ }
    }

    // Funding fees — paginated within the 7-day window
    try {
      const isPM    = acct.instrument === 'portfolio_margin'
      const methods = isPM
        ? ['papiGetUmIncome', 'papiGetCmIncome']
        : ['fapiPrivateGetIncome']

      for (const method of methods) {
        if (!(method in ex)) continue
        let cursor = since
        while (true) {
          const result = await ex[method]({
            incomeType: 'FUNDING_FEE',
            startTime:  cursor,
            endTime:    Date.now(),
            limit:      1000,
          }) as Array<Record<string, string>>

          if (!Array.isArray(result) || result.length === 0) break

          for (const row of result) {
            const tranId = String(row['tranId'] ?? '')
            if (!tranId) continue
            const amount = Number(row['income'] ?? 0)
            if (amount === 0) continue
            rows.push({
              account_id: acct.id, exchange: 'binance', type: 'funding_fee',
              asset:       row['asset'] ?? 'USDT',
              amount,   // signed: positive = received, negative = paid
              fee: null, status: 'completed',
              tx_id:       `funding_${tranId}`,
              recorded_at: new Date(Number(row['time'] ?? 0)).toISOString(),
            })
          }

          if (result.length < 1000) break
          cursor = Number(result[result.length - 1]['time']) + 1
        }
      }
    } catch (e) {
      await binanceBanGuard.recordIfBanned(e)
      console.warn(`[transaction-syncer] Binance funding fees failed for ${acct.id}:`, e)
    }

    await this.upsert(rows)
  }

  // ---------------------------------------------------------------------------
  // Shared upsert — ON CONFLICT (account_id, tx_id) DO NOTHING
  // ---------------------------------------------------------------------------
  private async upsert(rows: TxInsert[]): Promise<void> {
    const valid = rows.filter(r => r.tx_id)
    if (valid.length === 0) return

    const { error } = await supabaseAdmin
      .from('transactions')
      .upsert(valid, { onConflict: 'account_id,tx_id', ignoreDuplicates: true })

    if (error) console.error('[transaction-syncer] upsert failed:', error.message)
  }
}
