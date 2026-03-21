import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult } from './types'
import type { DailyPnLEntry, Trade, DateRange } from '../types'
import { mapCcxtTrade } from './ccxt-utils'

interface BinanceCredentials {
  apiKey: string
  apiSecret: string
}

export class BinanceAdapter implements ExchangeAdapter {
  private exchange: ccxt.binance

  constructor(credentials: BinanceCredentials) {
    this.exchange = new ccxt.binance({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
    })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.fetchBalance()
      return true
    } catch {
      return false
    }
  }

  async fetchBalance(): Promise<BalanceResult> {
    const walletTypes = ['spot', 'future', 'delivery'] as const

    const results = await Promise.allSettled(
      walletTypes.map((type) => this.exchange.fetchBalance({ type }))
    )

    let usdt = 0
    const tokens: Record<string, number> = {}
    let anySucceeded = false

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      anySucceeded = true
      const total = (result.value.total ?? {}) as unknown as Record<string, number>
      usdt += total['USDT'] ?? 0
      for (const [symbol, amount] of Object.entries(total)) {
        if (symbol !== 'USDT' && typeof amount === 'number' && amount > 0) {
          tokens[symbol] = (tokens[symbol] ?? 0) + amount
        }
      }
    }

    if (!anySucceeded) {
      const firstRejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      throw firstRejected.reason
    }

    return { usdt, tokens }
  }

  async getDailyPnL(_subAccountId: string, _dateRange: DateRange): Promise<DailyPnLEntry[]> {
    return []
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    _since?: number,
    _limit?: number,
  ): Promise<Trade[]> {
    // Binance fetchMyTrades requires a specific symbol — fetching all trades
    // without a symbol is not supported by the Binance API. Returning empty
    // until symbol-based fetching is implemented (Block 5 roadmap).
    return []
  }
}
