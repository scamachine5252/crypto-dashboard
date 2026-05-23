import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter } from '@/lib/adapters/bybit'
import { OkxAdapter } from '@/lib/adapters/okx'
import { MexcAdapter } from '@/lib/adapters/mexc'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { PositionReconstructor } from './position-reconstructor'
import { binanceBanGuard } from './binance-ban-guard'
import type { Trade, DateRange } from '@/lib/types'
import type { RawExecution } from '@/lib/adapters/bybit'
import type { RawFapiTrade } from '@/lib/adapters/binance'

const WINDOW_MS        = 7 * 24 * 60 * 60 * 1000   // 7 days
const INTERVAL_MS      = 6 * 60 * 60 * 1000         // 6 hours
const BINANCE_INTERVAL    = 6 * 60 * 60 * 1000       // 6 hours — safe after startup stagger fix
const BINANCE_STARTUP_MS  = 5 * 60 * 1000            // 5-min delay on first run to avoid burst
const BINANCE_DELAY_MS = 500                         // between symbol requests

interface AccountRow {
  id:           string
  exchange:     string
  api_key:      string
  api_secret:   string
  passphrase?:  string | null
  instrument?:  string | null
  reconcile_consecutive_failures?: number
  reconcile_first_failure_at?:     string | null
  reconcile_backoff_until?:        string | null
}

export class ReconciliationScheduler {
  private timer:               ReturnType<typeof setInterval> | null = null
  private binanceTimer:        ReturnType<typeof setInterval> | null = null
  private binanceStartupTimer: ReturnType<typeof setTimeout>  | null = null
  private redisUrl:            string

  constructor(redisUrl = 'redis://127.0.0.1:6379') {
    this.redisUrl = redisUrl
  }

  start(): void {
    // Non-Binance: fire immediately, then every 6h
    void this.runAll()
    this.timer = setInterval(() => void this.runAll(), INTERVAL_MS)
    this.timer.unref?.()

    // Binance: 5-minute startup delay to avoid burst alongside balance-poller startup.
    // Steady-state weight: ~0.42 wt/min — well below the 2,400/min limit.
    this.binanceStartupTimer = setTimeout(() => {
      this.binanceStartupTimer = null
      void this.runBinance()
      this.binanceTimer = setInterval(() => void this.runBinance(), BINANCE_INTERVAL)
      this.binanceTimer.unref?.()
    }, BINANCE_STARTUP_MS)
  }

  stop(): void {
    if (this.binanceStartupTimer) { clearTimeout(this.binanceStartupTimer);  this.binanceStartupTimer = null }
    if (this.timer)               { clearInterval(this.timer);               this.timer = null }
    if (this.binanceTimer)        { clearInterval(this.binanceTimer);        this.binanceTimer = null }
  }

  async runAll(): Promise<void> {
    console.log('[reconciliation] starting run')

    const { data: allAccounts, error } = await supabaseAdmin
      .from('accounts')
      .select('id, exchange, api_key, api_secret, passphrase, instrument, is_suspended, reconcile_consecutive_failures, reconcile_first_failure_at, reconcile_backoff_until')
      .eq('is_suspended', false)

    if (error) {
      console.error('[reconciliation] failed to load accounts:', error.message)
      return
    }

    const accounts = (allAccounts ?? []).filter((a: AccountRow) => a.exchange !== 'binance')

    for (const account of accounts as AccountRow[]) {
      await this.reconcileAccount(account).catch(e =>
        console.error(`[reconciliation] account ${account.id} (${account.exchange}) failed:`, e)
      )
    }
    console.log('[reconciliation] run complete')
  }

  async runBinance(): Promise<void> {
    if (binanceBanGuard.isBanned()) {
      console.warn('[reconciliation] Binance IP banned — skipping Binance reconciliation')
      return
    }

    console.log('[reconciliation] starting Binance run')

    const { data: allAccounts, error } = await supabaseAdmin
      .from('accounts')
      .select('id, exchange, api_key, api_secret, passphrase, instrument, is_suspended, reconcile_consecutive_failures, reconcile_first_failure_at, reconcile_backoff_until')
      .eq('is_suspended', false)

    if (error) {
      console.error('[reconciliation] failed to load Binance accounts:', error.message)
      return
    }

    const accounts = (allAccounts ?? []).filter((a: AccountRow) => a.exchange === 'binance')

    for (const account of accounts as AccountRow[]) {
      await this.reconcileAccount(account).catch(e =>
        console.error(`[reconciliation] Binance account ${account.id} failed:`, e)
      )
    }
    console.log('[reconciliation] Binance run complete')
  }

  private async reconcileAccount(account: AccountRow): Promise<void> {
    if (account.reconcile_backoff_until && new Date(account.reconcile_backoff_until) > new Date()) {
      console.log(`[reconciliation] ${account.id} in backoff until ${account.reconcile_backoff_until} — skipping`)
      return
    }

    const since = Date.now() - WINDOW_MS
    const until = Date.now()
    let filled = 0

    if      (account.exchange === 'bybit')   filled = await this.reconcileBybit(account, since, until)
    else if (account.exchange === 'okx')     filled = await this.reconcileOkx(account, since, until)
    else if (account.exchange === 'mexc')    filled = await this.reconcileMexc(account, since)
    else if (account.exchange === 'binance') filled = await this.reconcileBinance(account)

    if (filled > 0) {
      await new PositionReconstructor(this.redisUrl).reconstruct(account.id, account.exchange)
    }
  }

  private async reconcileBybit(account: AccountRow, since: number, until: number): Promise<number> {
    const adapter = new BybitAdapter({
      apiKey:    decrypt(account.api_key),
      apiSecret: decrypt(account.api_secret),
    })
    const { rawExecutions } = await adapter.getTradesForChunk(since, until)
    const rows = rawExecutions.flatMap(({ category, executions }: { category: string; executions: RawExecution[] }) =>
      executions.map((exec: RawExecution) => ({
        account_id:   account.id,  exchange:    'bybit',
        exec_id:      `${exec.orderId}_${exec.execTime}_${exec.execQty}`,
        symbol:       exec.symbol, category,
        exec_time:    new Date(Number(exec.execTime)).toISOString(),
        side:         exec.side,
        exec_qty:     Number(exec.execQty),  exec_price: Number(exec.execPrice),
        exec_pnl:     Number(exec.execPnl) || null,  exec_fee:   Math.abs(Number(exec.execFee)),
        closed_size:  Number(exec.closedSize),
        position_idx: exec.positionIdx ? Number(exec.positionIdx) : null,
        raw_data:     exec,        source: 'rest' as const,
      }))
    )
    return this.upsert('bybit', rows)
  }

  private async reconcileOkx(account: AccountRow, since: number, until: number): Promise<number> {
    const adapter = new OkxAdapter({
      apiKey:     decrypt(account.api_key),
      apiSecret:  decrypt(account.api_secret),
      passphrase: account.passphrase ? decrypt(account.passphrase) : '',
    })
    const trades = await adapter.getTrades('', {} as DateRange, since, 1000, until)
    const rows = trades.map((t: Trade) => ({
      account_id:   account.id,  exchange:    'okx',
      exec_id:      t.id,        symbol:      t.symbol,  category: t.tradeType,
      exec_time:    t.closedAt,  side:        t.side === 'long' ? 'buy' : 'sell',
      exec_qty:     t.quantity,  exec_price:  t.exitPrice,
      exec_pnl:     t.pnl || null,  exec_fee:    Math.abs(t.fee),
      closed_size:  null,        position_idx: null,
      raw_data:     t,
      source: 'rest' as const,
    }))
    return this.upsert('okx', rows)
  }

  private async reconcileMexc(account: AccountRow, since: number): Promise<number> {
    const adapter = new MexcAdapter({
      apiKey:    decrypt(account.api_key),
      apiSecret: decrypt(account.api_secret),
    })
    const trades = await adapter.getTrades('', {} as DateRange, since, 1000, Date.now())
    const rows = trades.map((t: Trade) => ({
      account_id:   account.id,  exchange:    'mexc',
      exec_id:      t.id,        symbol:      t.symbol,  category: t.tradeType,
      exec_time:    t.closedAt,  side:        t.side === 'long' ? 'buy' : 'sell',
      exec_qty:     t.quantity,  exec_price:  t.exitPrice,
      exec_pnl:     t.pnl || null,  exec_fee:    Math.abs(t.fee),
      closed_size:  null,        position_idx: null,
      raw_data:     t,
      source: 'rest' as const,
    }))
    return this.upsert('mexc', rows)
  }

  private async pingBinanceAccount(adapter: BinanceAdapter): Promise<boolean> {
    try {
      await adapter.fetchBalance()
      return true
    } catch {
      return false
    }
  }

  private async updateReconcileState(
    accountId:         string,
    success:           boolean,
    currentFailures:   number,
    firstFailureAt:    string | null,
    credentialsBroken: boolean,
  ): Promise<void> {
    if (success) {
      await supabaseAdmin.from('accounts').update({
        reconcile_consecutive_failures: 0,
        reconcile_first_failure_at:     null,
        reconcile_backoff_until:        null,
      }).eq('id', accountId)
      return
    }

    // 999 = permanent flag for broken credentials (no backoff — user must fix API keys)
    const failures = credentialsBroken ? 999 : currentFailures + 1

    // Backoff: 2h → 4h → 6h cap, aligning with the 6h reconcile cycle
    const backoffHours = credentialsBroken
      ? 0
      : Math.min(2 * Math.pow(2, currentFailures), 6)

    const backoffUntil = backoffHours > 0
      ? new Date(Date.now() + backoffHours * 60 * 60 * 1000).toISOString()
      : null

    await supabaseAdmin.from('accounts').update({
      reconcile_consecutive_failures: failures,
      reconcile_first_failure_at:     firstFailureAt ?? new Date().toISOString(),
      reconcile_backoff_until:        backoffUntil,
    }).eq('id', accountId)

    console.warn(
      `[reconciliation] ${accountId} failure #${failures}` +
      (credentialsBroken ? ' — CREDENTIALS BROKEN (check API keys)' : ` — backoff ${backoffHours}h`),
    )
  }

  private async reconcileBinance(account: AccountRow): Promise<number> {
    if (binanceBanGuard.isBanned()) return 0

    const adapter = new BinanceAdapter({
      apiKey:          decrypt(account.api_key),
      apiSecret:       decrypt(account.api_secret),
      portfolioMargin: account.instrument === 'portfolio_margin',
    })

    let symbols: Awaited<ReturnType<typeof adapter.discoverTradedSymbols>>
    try {
      symbols = await adapter.discoverTradedSymbols()
    } catch (e) {
      await binanceBanGuard.recordIfBanned(e)
      const credentialsBroken = !(await this.pingBinanceAccount(adapter))
      await this.updateReconcileState(
        account.id,
        false,
        account.reconcile_consecutive_failures ?? 0,
        account.reconcile_first_failure_at ?? null,
        credentialsBroken,
      )
      throw e
    }

    // Success — reset any previous failure state
    if ((account.reconcile_consecutive_failures ?? 0) > 0) {
      await this.updateReconcileState(account.id, true, 0, null, false)
    }

    let total = 0
    let caughtError: unknown = null
    for (const { rawSymbol } of symbols) {
      if (binanceBanGuard.isBanned()) break
      try {
        const { rawFills } = await adapter.getFullTrades(rawSymbol, [25])
        const rows = rawFills.map((fill: RawFapiTrade) => ({
          account_id:   account.id,      exchange:    'binance',
          exec_id:      String(fill.id), symbol:      fill.symbol,
          category:     fill.positionSide,
          exec_time:    new Date(Number(fill.time)).toISOString(),
          side:         fill.side,
          exec_qty:     Number(fill.qty),           exec_price:  Number(fill.price),
          exec_pnl:     Number(fill.realizedPnl) || null,   exec_fee:    Math.abs(Number(fill.commission)),
          closed_size:  null, position_idx: null,
          raw_data:     fill, source: 'rest' as const,
        }))
        total += await this.upsert('binance', rows)
      } catch (e) {
        await binanceBanGuard.recordIfBanned(e)
        caughtError = e
        break  // stop fetching further symbols, but still trigger reconstruction for what succeeded
      }
      await new Promise(r => setTimeout(r, BINANCE_DELAY_MS))
    }

    if (caughtError) {
      // Partial run: some fills were written before the ban/error — reconstruct what we have
      if (total > 0) {
        await new PositionReconstructor(this.redisUrl).reconstruct(account.id, 'binance')
          .catch(e => console.error('[reconciliation] binance partial reconstruction failed:', e))
      }
      throw caughtError
    }
    return total
  }

  private async upsert(exchange: string, rows: unknown[]): Promise<number> {
    if (rows.length === 0) return 0
    const { error } = await supabaseAdmin
      .from('raw_fills')
      .upsert(rows, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })
    if (error) console.warn(`[reconciliation] ${exchange} upsert warning:`, error.message)
    return rows.length
  }
}
