import ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult } from './types'
import type { DailyPnLEntry, Trade, DateRange } from '../types'

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
    const total = (raw.total ?? {}) as Record<string, number>

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
    // Real implementation: fetch closed PnL from Bybit and aggregate by day
    return []
  }

  async getTrades(_subAccountId: string, _dateRange: DateRange): Promise<Trade[]> {
    // Real implementation: fetch trade history from Bybit
    return []
  }
}
