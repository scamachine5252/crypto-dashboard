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
}

export class ReconciliationScheduler {
  private timer:               ReturnType<typeof setInterval> | null = null
  private binanceTimer:        ReturnType<typeof setInterval> | null = null
  private binanceStartupTimer: ReturnType<typeof setTimeout>  | null = null

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
      .select('id, exchange, api_key, api_secret, passphrase, instrument, is_suspended')
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
      .select('id, exchange, api_key, api_secret, passphrase, instrument, is_suspended')
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
    const since = Date.now() - WINDOW_MS
    const until = Date.now()
    let filled = 0

    if      (account.exchange === 'bybit')   filled = await this.reconcileBybit(account, since, until)
    else if (account.exchange === 'okx')     filled = await this.reconcileOkx(account, since, until)
    else if (account.exchange === 'mexc')    filled = await this.reconcileMexc(account, since)
    else if (account.exchange === 'binance') filled = await this.reconcileBinance(account)

    if (filled > 0) {
      await new PositionReconstructor().reconstruct(account.id, account.exchange)
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
      throw e
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
        await new PositionReconstructor().reconstruct(account.id, 'binance')
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
