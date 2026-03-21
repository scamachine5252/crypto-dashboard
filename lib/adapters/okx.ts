import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult } from './types'
import type { DailyPnLEntry, Trade, DateRange } from '../types'
import { mapCcxtTrade } from './ccxt-utils'

interface OkxCredentials {
  apiKey: string
  apiSecret: string
  passphrase: string
}

export class OkxAdapter implements ExchangeAdapter {
  private exchange: ccxt.okx

  constructor(credentials: OkxCredentials) {
    this.exchange = new ccxt.okx({
      apiKey:     credentials.apiKey,
      secret:     credentials.apiSecret,
      password:   credentials.passphrase,  // ccxt uses 'password' for OKX passphrase
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
    const untilParam = until !== undefined ? { until } : {}
    const instTypes = ['SPOT', 'SWAP', 'FUTURES', 'OPTION', 'MARGIN'] as const
    const results = await Promise.allSettled(
      instTypes.map((type) =>
        this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { type, paginate: true, ...untilParam }),
      ),
    )
    const all: Trade[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        all.push(...result.value.map((t) => mapCcxtTrade(t, 'okx')))
      }
    }
    return all
  }
}
