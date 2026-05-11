import Redis from 'ioredis'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { FillProcessor } from './fill-processor'
import { PositionReconstructor } from './position-reconstructor'
import { BybitConnector } from './connectors/bybit-connector'
import { BinanceConnector } from './connectors/binance-connector'
import { OkxConnector } from './connectors/okx-connector'

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

    for (const acct of (accounts ?? []) as AccountRow[]) {
      if (acct.is_suspended) continue

      // Fetch max exec_time from raw_fills for gap fill baseline
      const { data: latest } = await supabaseAdmin
        .from('raw_fills')
        .select('exec_time')
        .eq('account_id', acct.id)
        .order('exec_time', { ascending: false })
        .limit(1)
        .single()
      const lastFillTime = latest?.exec_time ? new Date(latest.exec_time as string).getTime() : 0

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

  private async startConnector(acct: AccountRow, lastFillTime: number): Promise<void> {
    const apiKey    = decrypt(acct.api_key)
    const apiSecret = decrypt(acct.api_secret)

    if (acct.exchange === 'bybit') {
      const connector = new BybitConnector({
        apiKey, apiSecret, accountId: acct.id, lastFillTime,
        fillProcessor: this.processor,
      })
      this.connectors.push(connector)
      await connector.connect()
      return
    }

    if (acct.exchange === 'binance') {
      const connector = new BinanceConnector({
        apiKey, apiSecret, accountId: acct.id, lastFillTime,
        portfolioMargin: acct.instrument === 'portfolio_margin',
        fillProcessor: this.processor,
      })
      this.connectors.push(connector)
      await connector.connect()
      return
    }

    if (acct.exchange === 'okx') {
      const passphrase = acct.passphrase ? decrypt(acct.passphrase) : ''
      const connector = new OkxConnector({
        apiKey, apiSecret, passphrase, accountId: acct.id, lastFillTime,
        fillProcessor: this.processor,
      })
      this.connectors.push(connector)
      await connector.connect()
      return
    }

    console.warn(`[connector-manager] no connector for exchange: ${acct.exchange}`)
  }
}
