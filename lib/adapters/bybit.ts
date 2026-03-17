import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult } from './types'
import type { DailyPnLEntry, Trade, DateRange } from '../types'
import { mapCcxtTrade } from './ccxt-utils'

interface BybitCredentials {
  apiKey: string
  apiSecret: string
}

export class BybitAdapter implements ExchangeAdapter {
  private exchange: ccxt.bybit

  constructor(credentials: BybitCredentials) {
    this.exchange = new ccxt.bybit({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      options: { defaultType: 'unified' },
    })
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.exchange.fetchBalance()
      console.log('Bybit fetchBalance result keys:', Object.keys(result))
      console.log('Bybit fetchBalance total:', result.total)
      return true
    } catch (error: unknown) {
      console.error('Bybit testConnection error:', error instanceof Error ? error.message : String(error))
      return false
    }
  }

  async fetchBalance(): Promise<BalanceResult> {
    const raw = await this.exchange.fetchBalance()
    const total = (raw.total ?? {}) as unknown as Record<string, number>

    const usdt = total['USDT'] ?? 0
    const tokens: Record<string, number> = {}
    for (const [symbol, amount] of Object.entries(total)) {
      if (symbol !== 'USDT' && typeof amount === 'number' && amount > 0) {
        tokens[symbol] = amount
      }
    }
    return { usdt, tokens }
  }

  async getDailyPnL(_subAccountId: string, _dateRange: DateRange): Promise<DailyPnLEntry[]> {
    return []
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    limit?: number,
  ): Promise<Trade[]> {
    const raw = await this.exchange.fetchMyTrades(undefined, since, limit ?? 100)
    return raw.map((t) => mapCcxtTrade(t, 'bybit'))
  }
}
