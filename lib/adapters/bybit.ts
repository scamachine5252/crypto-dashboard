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
    until?: number,
  ): Promise<Trade[]> {
    // until must be passed to CCXT so Bybit receives the correct endTime per page.
    // Bybit's Unified Account API enforces a 7-day max window per request —
    // callers must ensure until - since <= 7 days (the full route uses 7-day chunks).
    const untilParam = until !== undefined ? { until } : {}
    const [spotResult, linearResult, inverseResult, optionResult] = await Promise.allSettled([
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'spot',    paginate: true, ...untilParam }),
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'linear',  paginate: true, ...untilParam }),
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'inverse', paginate: true, ...untilParam }),
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'option',  paginate: true, ...untilParam }),
    ])

    const spotTrades    = spotResult.status    === 'fulfilled' ? spotResult.value    : []
    const linearTrades  = linearResult.status  === 'fulfilled' ? linearResult.value  : []
    const inverseTrades = inverseResult.status === 'fulfilled' ? inverseResult.value : []
    const optionTrades  = optionResult.status  === 'fulfilled' ? optionResult.value  : []

    return [
      ...spotTrades,
      ...linearTrades,
      ...inverseTrades,
      ...optionTrades,
    ].map((t) => mapCcxtTrade(t, 'bybit'))
  }
}
