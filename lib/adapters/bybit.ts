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
    const [spotResult, linearResult, inverseResult, optionResult] = await Promise.allSettled([
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'spot',    paginate: true }),
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'linear',  paginate: true }),
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'inverse', paginate: true }),
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'option',  paginate: true }),
    ])

    const spotTrades    = spotResult.status    === 'fulfilled' ? spotResult.value    : []
    const linearTrades  = linearResult.status  === 'fulfilled' ? linearResult.value  : []
    const inverseTrades = inverseResult.status === 'fulfilled' ? inverseResult.value : []
    const optionTrades  = optionResult.status  === 'fulfilled' ? optionResult.value  : []

    console.log('Bybit category spot trades:',    spotTrades.length)
    console.log('Bybit category linear trades:',  linearTrades.length)
    console.log('Bybit category inverse trades:',  inverseTrades.length)
    console.log('Bybit category option trades:',  optionTrades.length)

    return [
      ...spotTrades,
      ...linearTrades,
      ...inverseTrades,
      ...optionTrades,
    ].map((t) => mapCcxtTrade(t, 'bybit'))
  }
}
