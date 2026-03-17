import 'server-only'
import ccxt from 'ccxt'
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
    return []
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    limit?: number,
  ): Promise<Trade[]> {
    const raw = await this.exchange.fetchMyTrades(undefined, since, limit ?? 100)
    return raw.map((t) => mapCcxtTrade(t, 'okx'))
  }
}
