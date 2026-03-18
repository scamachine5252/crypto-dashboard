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
      await this.exchange.fetchBalance()
      return true
    } catch {
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
    const categories = ['spot', 'linear', 'inverse', 'option'] as const
    const results = await Promise.allSettled(
      categories.map((category) =>
        this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category, paginate: true }),
      ),
    )
    const all: Trade[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        all.push(...result.value.map((t) => mapCcxtTrade(t, 'bybit')))
      }
    }
    return all
  }
}
