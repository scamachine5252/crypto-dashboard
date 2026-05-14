import Redis from 'ioredis'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { FillProcessor } from './fill-processor'
import { PositionReconstructor } from './position-reconstructor'
import { BybitConnector } from './connectors/bybit-connector'
import { BinanceConnector } from './connectors/binance-connector'
import { OkxConnector } from './connectors/okx-connector'
import { MexcConnector } from './connectors/mexc-connector'
import { BybitAdapter } from '@/lib/adapters/bybit'
import { OkxAdapter } from '@/lib/adapters/okx'
import { MexcAdapter } from '@/lib/adapters/mexc'
import type { RawFill } from './fill-processor'
import type { DateRange } from '@/lib/types'
import type { RawExecution } from '@/lib/adapters/bybit'

export interface AccountRow {
  id:              string
  exchange:        string
  api_key:         string
  api_secret:      string
  passphrase?:     string
  instrument?:     string
  is_suspended?:   boolean
}

export class ConnectorManager {
  private redis:        Redis
  private processor:    FillProcessor
  private reconstructor: PositionReconstructor
  private connectors:   Array<{ disconnect(): void }> = []

  constructor(redisUrl = 'redis://127.0.0.1:6379') {
    this.redis        = new Redis(redisUrl)
    this.reconstructor = new PositionReconstructor()
    this.processor    = new FillProcessor(this.redis, {
      onReconstruct: (accountId, exchange) =>
        void this.reconstructor.reconstruct(accountId, exchange)
          .catch(e => console.error('[reconstructor] error:', e)),
    })
  }

  async start(): Promise<void> {
    const { data: accounts, error } = await supabaseAdmin
      .from('accounts')
      .select('id, exchange, api_key, api_secret, passphrase, instrument, is_suspended')

    if (error) throw new Error(`ConnectorManager: failed to load accounts: ${error.message}`)

    const activeAccounts = (accounts ?? []).filter((a: AccountRow) => !a.is_suspended)
    const accountIds = activeAccounts.map((a: AccountRow) => a.id)

    // Single batch query instead of N per-account queries
    const fillMap = new Map<string, number>()
    if (accountIds.length > 0) {
      const { data: latestFills } = await supabaseAdmin
        .rpc('latest_fill_per_account', { account_ids: accountIds })
      for (const row of (latestFills ?? []) as Array<{ account_id: string; exec_time: string }>) {
        fillMap.set(row.account_id, new Date(row.exec_time).getTime())
      }
    }

    for (const acct of activeAccounts as AccountRow[]) {
      const lastFillTime = fillMap.get(acct.id) ?? 0
      try {
        await this.startConnector(acct, lastFillTime)
      } catch (e) {
        console.error(`[connector-manager] failed to start connector for ${acct.id}:`, e)
      }
    }
  }

  stop(): void {
    for (const c of this.connectors) c.disconnect()
    this.connectors = []
    this.redis.disconnect()
  }

  async stopAndWait(timeoutMs = 30_000): Promise<void> {
    this.stop()
    // Give connectors up to timeoutMs to finish in-flight gap fills / writes
    await Promise.race([
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
      // Connectors have no explicit "done" signal — the timeout is the backstop
    ])
  }

  private async startConnector(acct: AccountRow, lastFillTime: number): Promise<void> {
    const apiKey    = decrypt(acct.api_key)
    const apiSecret = decrypt(acct.api_secret)

    if (acct.exchange === 'bybit') {
      const adapter = new BybitAdapter({ apiKey, apiSecret })
      const fetchGapFills = async (since: number, until: number): Promise<RawFill[]> => {
        const { rawExecutions } = await adapter.getTradesForChunk(since, until)
        return rawExecutions.flatMap(({ category, executions }: { category: string; executions: RawExecution[] }) =>
          executions.map((exec: RawExecution) => ({
            account_id:   acct.id,
            exchange:     'bybit',
            exec_id:      `${exec.orderId}_${exec.execTime}_${exec.execQty}`,
            symbol:       exec.symbol,
            category,
            exec_time:    new Date(Number(exec.execTime)),
            side:         exec.side,
            exec_qty:     Number(exec.execQty),
            exec_price:   Number(exec.execPrice),
            exec_pnl:     Number(exec.execPnl) || null,
            exec_fee:     Math.abs(Number(exec.execFee)),
            closed_size:  Number(exec.closedSize) || null,
            position_idx: exec.positionIdx ? Number(exec.positionIdx) : null,
            raw_data:     exec,
            source:       'rest' as const,
          }))
        )
      }
      const connector = new BybitConnector({
        apiKey, apiSecret, accountId: acct.id, lastFillTime,
        fillProcessor: this.processor, fetchGapFills,
      })
      this.connectors.push(connector)
      void connector.connect()  // runs its own reconnect loop — do not await
      return
    }

    if (acct.exchange === 'binance') {
      // Binance gap fill requires symbol discovery — handled by ReconciliationScheduler every 24h.
      // WS connector gets no fetchGapFills; the 24h REST reconciliation covers missed fills.
      const connector = new BinanceConnector({
        apiKey, apiSecret, accountId: acct.id, lastFillTime,
        portfolioMargin: acct.instrument === 'portfolio_margin',
        fillProcessor: this.processor,
      })
      this.connectors.push(connector)
      void connector.connect()  // runs its own reconnect loop — do not await
      return
    }

    if (acct.exchange === 'okx') {
      const passphrase = acct.passphrase ? decrypt(acct.passphrase) : ''
      const adapter    = new OkxAdapter({ apiKey, apiSecret, passphrase })
      const fetchGapFills = async (since: number, until: number): Promise<RawFill[]> => {
        const trades = await adapter.getTrades('', {} as DateRange, since, 1000, until)
        return trades.map(t => ({
          account_id:   acct.id,
          exchange:     'okx',
          exec_id:      t.id,
          symbol:       t.symbol,
          category:     t.tradeType,
          exec_time:    new Date(t.closedAt),
          side:         t.side === 'long' ? 'buy' : 'sell',
          exec_qty:     t.quantity,
          exec_price:   t.exitPrice,
          exec_pnl:     t.pnl || null,
          exec_fee:     Math.abs(t.fee),
          closed_size:  null,
          position_idx: null,
          raw_data:     t,
          source:       'rest' as const,
        }))
      }
      const connector = new OkxConnector({
        apiKey, apiSecret, passphrase, accountId: acct.id, lastFillTime,
        fillProcessor: this.processor, fetchGapFills,
      })
      this.connectors.push(connector)
      void connector.connect()  // runs its own reconnect loop — do not await
      return
    }

    if (acct.exchange === 'mexc') {
      const adapter = new MexcAdapter({
        apiKey:    apiKey,
        apiSecret: apiSecret,
      })
      const fetchFills = async (since: number): Promise<RawFill[]> => {
        const trades = await adapter.getTrades('', {} as DateRange, since, 1000, Date.now())
        return trades.map(t => ({
          account_id:   acct.id,
          exchange:     'mexc',
          exec_id:      t.id,
          symbol:       t.symbol,
          category:     t.tradeType,
          exec_time:    new Date(t.closedAt),
          side:         t.side === 'long' ? 'buy' : 'sell',
          exec_qty:     t.quantity,
          exec_price:   t.exitPrice,
          exec_pnl:     t.pnl,
          exec_fee:     Math.abs(t.fee),
          closed_size:  null,
          position_idx: null,
          raw_data:     t,
          source:       'rest' as const,
        }))
      }
      const connector = new MexcConnector({
        accountId: acct.id, lastFillTime, fillProcessor: this.processor, fetchFills,
      })
      this.connectors.push(connector)
      void connector.connect()
      return
    }

    console.warn(`[connector-manager] no connector for exchange: ${acct.exchange}`)
  }
}
