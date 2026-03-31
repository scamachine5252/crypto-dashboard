import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult, RawPosition } from './types'
import { mapCcxtTrade } from './ccxt-utils'
import type { DailyPnLEntry, Trade, DateRange } from '../types'

interface MexcCredentials {
  apiKey: string
  apiSecret: string
}

export class MexcAdapter implements ExchangeAdapter {
  private spot: ccxt.mexc
  private swap: ccxt.mexc

  constructor(credentials: MexcCredentials) {
    const common = {
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      enableRateLimit: true,
    }
    this.spot = new ccxt.mexc({ ...common, options: { defaultType: 'spot' } })
    this.swap = new ccxt.mexc({ ...common, options: { defaultType: 'swap' } })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.spot.fetchBalance()
      return true
    } catch {
      return false
    }
  }

  async fetchBalance(): Promise<BalanceResult> {
    const [spotResult, swapResult] = await Promise.allSettled([
      this.spot.fetchBalance(),
      this.swap.fetchBalance(),
    ])

    if (spotResult.status === 'rejected' && swapResult.status === 'rejected') {
      throw spotResult.reason
    }

    let usdt = 0
    const tokens: Record<string, number> = {}

    for (const result of [spotResult, swapResult]) {
      if (result.status !== 'fulfilled') continue
      const total = (result.value.total ?? {}) as unknown as Record<string, number>
      usdt += total['USDT'] ?? 0
      for (const [symbol, amount] of Object.entries(total)) {
        if (symbol !== 'USDT' && typeof amount === 'number' && amount > 0) {
          tokens[symbol] = (tokens[symbol] ?? 0) + amount
        }
      }
    }

    return { usdt, tokens }
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    limit?: number,
    until?: number,
  ): Promise<Trade[]> {
    const untilParam = until ? { until } : {}
    const [spotResult, swapResult] = await Promise.allSettled([
      this.spot.fetchMyTrades(undefined, since, limit ?? 100, { paginate: true, ...untilParam }),
      this.swap.fetchMyTrades(undefined, since, limit ?? 100, { paginate: true, ...untilParam }),
    ])

    const trades: Trade[] = []
    if (spotResult.status === 'fulfilled') {
      trades.push(...spotResult.value.map((t) => mapCcxtTrade(t, 'mexc')))
    }
    if (swapResult.status === 'fulfilled') {
      trades.push(...swapResult.value.map((t) => mapCcxtTrade(t, 'mexc')))
    }
    return trades
  }

  async fetchPositions(): Promise<RawPosition[]> {
    try {
      const raw = await this.swap.fetchPositions()
      return raw
        .filter((p) => p.contracts && Math.abs(Number(p.contracts)) > 0)
        .map((p): RawPosition => {
          const symbol = p.symbol ?? ''
          return {
            symbol: symbol.includes(':') ? symbol.split(':')[0] : symbol,
            side: (p.side === 'short' ? 'short' : 'long') as 'long' | 'short',
            size: Math.abs(Number(p.contracts ?? 0) * Number(p.contractSize ?? 1)),
            entryPrice: Number(p.entryPrice ?? 0),
            markPrice: Number(p.markPrice ?? 0),
            notional: Math.abs(Number(p.notional ?? 0)),
            unrealizedPnl: Number(p.unrealizedPnl ?? 0),
            leverage: Number(p.leverage ?? 1),
            margin: Number(p.initialMargin ?? 0),
            liquidationPrice: Number(p.liquidationPrice ?? 0),
            openTimestamp: Number(p.timestamp ?? 0),
          }
        })
    } catch {
      return []
    }
  }

  getDailyPnL(_subAccountId: string, _dateRange: DateRange): Promise<DailyPnLEntry[]> {
    return Promise.resolve([])
  }
}
