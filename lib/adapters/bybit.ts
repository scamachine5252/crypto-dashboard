import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult, RawPosition } from './types'
import type { DailyPnLEntry, Trade, DateRange, ExchangeId, TradeSide, TradeType } from '../types'
import { mapCcxtTrade } from './ccxt-utils'

function mapCcxtPosition(p: ccxt.Position): RawPosition {
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
  }
}

interface BybitCredentials {
  apiKey: string
  apiSecret: string
}

// Convert Bybit market ID → unified CCXT symbol
// linear:  BTCUSDT  → BTC/USDT:USDT
// inverse: BTCUSD   → BTC/USD:BTC
function bybitIdToSymbol(id: string, category: 'linear' | 'inverse'): string {
  if (category === 'linear') {
    if (id.endsWith('USDT')) return `${id.slice(0, -4)}/USDT:USDT`
    if (id.endsWith('USDC')) return `${id.slice(0, -4)}/USDC:USDC`
  }
  if (category === 'inverse') {
    if (id.endsWith('USD')) {
      const base = id.slice(0, -3)
      return `${base}/USD:${base}`
    }
  }
  return id
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

  async fetchPositions(): Promise<RawPosition[]> {
    try {
      const raw = await this.exchange.fetchPositions()
      return raw
        .filter((p) => p.contracts && Math.abs(Number(p.contracts)) > 0)
        .map(mapCcxtPosition)
    } catch {
      return []
    }
  }

  async getDailyPnL(_subAccountId: string, _dateRange: DateRange): Promise<DailyPnLEntry[]> {
    return []
  }

  // Fetch closed futures positions from /v5/position/closed-pnl.
  // This endpoint returns COMPLETED position records with real realized PnL —
  // unlike fetchMyTrades (fills), which returns closedPnl=0 for opening fills
  // and is unreliable for Bybit Unified accounts.
  // Max 7-day window per call (Bybit API hard limit — use 7-day chunks).
  private async fetchBybitClosedPnl(
    category: 'linear' | 'inverse',
    since?: number,
    until?: number,
  ): Promise<Trade[]> {
    const trades: Trade[] = []
    let cursor: string | undefined

    do {
      const params: Record<string, unknown> = { category, limit: 100 }
      if (since !== undefined) params['startTime'] = since
      if (until !== undefined) params['endTime'] = until
      if (cursor) params['cursor'] = cursor

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (this.exchange as any).privateGetV5PositionClosedPnl(params) as Record<string, unknown>
      const result = (response?.result ?? {}) as Record<string, unknown>
      const list = (result.list ?? []) as Array<Record<string, string>>

      if (list.length === 0) break

      for (const pos of list) {
        // side = direction of the CLOSING order:
        // "Sell" = selling to close a long position → trade direction is 'long'
        // "Buy"  = buying to close a short position → trade direction is 'short'
        const side: TradeSide = pos.side === 'Sell' ? 'long' : 'short'
        const symbol = bybitIdToSymbol(pos.symbol ?? 'UNKNOWN', category)

        trades.push({
          id:           pos.orderId ?? String(Math.random()),
          subAccountId: 'bybit' as ExchangeId,
          exchangeId:   'bybit' as ExchangeId,
          symbol,
          side,
          tradeType:    'futures' as TradeType,
          entryPrice:   Number(pos.avgEntryPrice ?? 0),
          exitPrice:    Number(pos.avgExitPrice ?? 0),
          quantity:     Number(pos.closedSize ?? pos.qty ?? 0),
          pnl:          Number(pos.closedPnl ?? 0),
          pnlPercent:   0,
          fee:          0,
          durationMin:  0,
          leverage:     Number(pos.leverage ?? 1),
          fundingCost:  0,
          isOvernight:  false,
          openedAt:     pos.createdTime
            ? new Date(Number(pos.createdTime)).toISOString()
            : new Date().toISOString(),
          closedAt:     pos.updatedTime
            ? new Date(Number(pos.updatedTime)).toISOString()
            : new Date().toISOString(),
        })
      }

      cursor = result.nextPageCursor as string | undefined
    } while (cursor)

    return trades
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    limit?: number,
    until?: number,
  ): Promise<Trade[]> {
    const untilParam = until !== undefined ? { until } : {}

    // Spot: use fills (closedPnl concept doesn't apply to spot)
    const [spotResult] = await Promise.allSettled([
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'spot', paginate: true, ...untilParam }),
    ])

    // Futures: use closed-pnl endpoint — returns real realized PnL per closed position
    const [linearResult, inverseResult] = await Promise.allSettled([
      this.fetchBybitClosedPnl('linear', since, until),
      this.fetchBybitClosedPnl('inverse', since, until),
    ])

    const spotTrades    = spotResult.status    === 'fulfilled' ? spotResult.value    : []
    const linearTrades  = linearResult.status  === 'fulfilled' ? linearResult.value  : []
    const inverseTrades = inverseResult.status === 'fulfilled' ? inverseResult.value : []

    return [
      ...spotTrades.map((t) => mapCcxtTrade(t, 'bybit')),
      ...linearTrades,
      ...inverseTrades,
    ]
  }
}
