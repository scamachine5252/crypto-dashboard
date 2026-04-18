import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult, RawPosition } from './types'
import type { DailyPnLEntry, Trade, DateRange, ExchangeId, TradeSide, TradeType } from '../types'
import { mapCcxtTrade } from './ccxt-utils'

// ---------------------------------------------------------------------------
// Raw execution record from Bybit /v5/execution/list
// ---------------------------------------------------------------------------
export interface RawExecution {
  execTime:   string  // ms timestamp
  symbol:     string  // e.g. 'BTCUSDT'
  side:       string  // 'Buy' | 'Sell'
  execType:   string  // 'Trade' | 'Funding' | 'AdlTrade' | 'BustTrade'
  execPrice:  string
  execQty:    string
  execPnl:    string  // USDT for linear; base currency for inverse; 0 for opening fills
  execFee:    string  // commission (positive = cost, negative = income)
  closedSize: string  // qty closed by this fill; 0 for pure opening fills
  orderId:    string
}

// ---------------------------------------------------------------------------
// Reconstruct closed positions from execution fills.
//
// Bybit's /v5/execution/list returns individual fills with real execTime.
// This function groups them into position lifecycles and emits one Trade per
// closing fill (partial or full), with:
//   openedAt = execTime of the first opening fill of this position cycle
//   closedAt = execTime of this closing fill
// ---------------------------------------------------------------------------
export function reconstructPositions(
  executions: RawExecution[],
  category: 'linear' | 'inverse',
): Trade[] {
  // Separate trade fills from funding entries
  const tradeFills   = executions.filter(e => e.execType === 'Trade')
  const fundingFills = executions.filter(e => e.execType === 'Funding')

  // Sort trade fills chronologically
  tradeFills.sort((a, b) => Number(a.execTime) - Number(b.execTime))

  // Per-symbol funding accumulation (for proportional distribution)
  const fundingBySymbol: Record<string, number> = {}
  for (const f of fundingFills) {
    fundingBySymbol[f.symbol] = (fundingBySymbol[f.symbol] ?? 0) + Number(f.execFee)
  }

  // Per-symbol total closed size (denominator for proportional funding)
  const totalClosedBySymbol: Record<string, number> = {}
  for (const f of tradeFills) {
    const closed = Number(f.closedSize)
    if (closed > 0) {
      totalClosedBySymbol[f.symbol] = (totalClosedBySymbol[f.symbol] ?? 0) + closed
    }
  }

  // Per-symbol position state
  type SymbolState = {
    size:     number
    avgEntry: number
    openTime: string
    openSide: TradeSide
  }
  const stateMap = new Map<string, SymbolState>()

  const result: Trade[] = []

  for (const exec of tradeFills) {
    const qty       = Number(exec.execQty)
    const price     = Number(exec.execPrice)
    const closedQty = Number(exec.closedSize)
    const openedQty = qty - closedQty

    let state = stateMap.get(exec.symbol) ?? { size: 0, avgEntry: 0, openTime: '', openSide: 'long' as TradeSide }

    // ── Closing component ──────────────────────────────────────────────────
    if (closedQty > 0) {
      // PnL: linear is already USDT; inverse is in base currency → convert
      const rawPnl = Number(exec.execPnl)
      const pnl = category === 'inverse' ? rawPnl * price : rawPnl

      // Proportional funding for this close
      const totalFunding   = fundingBySymbol[exec.symbol]  ?? 0
      const totalClosed    = totalClosedBySymbol[exec.symbol] ?? 1
      const proportional   = closedQty / totalClosed
      const fundingForFill = totalFunding * proportional

      result.push({
        id:           exec.orderId || String(Math.random()),
        subAccountId: 'bybit' as ExchangeId,
        exchangeId:   'bybit' as ExchangeId,
        symbol:       bybitIdToSymbol(exec.symbol, category),
        side:         state.openSide,
        tradeType:    'futures' as TradeType,
        entryPrice:   state.avgEntry,
        exitPrice:    price,
        quantity:     closedQty,
        pnl,
        pnlPercent:   0,
        fee:          Number(exec.execFee) + fundingForFill,
        durationMin:  0,
        leverage:     1,
        fundingCost:  0,
        isOvernight:  false,
        openedAt:     state.openTime,
        closedAt:     new Date(Number(exec.execTime)).toISOString(),
      })

      state = { ...state, size: state.size - closedQty }

      // If position fully closed (or flipped negative — guard), reset
      if (state.size <= 0) {
        state = { size: 0, avgEntry: 0, openTime: '', openSide: 'long' }
      }
    }

    // ── Opening component ──────────────────────────────────────────────────
    if (openedQty > 0) {
      if (state.size === 0) {
        // New position cycle starts here
        state.openTime = new Date(Number(exec.execTime)).toISOString()
        state.openSide = exec.side === 'Buy' ? 'long' : 'short'
        state.avgEntry = price
      } else {
        // Scale-in: update weighted average entry
        state.avgEntry = (state.avgEntry * state.size + price * openedQty) / (state.size + openedQty)
      }
      state = { ...state, size: state.size + openedQty }
    }

    stateMap.set(exec.symbol, state)
  }

  return result
}

function mapCcxtPosition(p: ccxt.Position): RawPosition {
  const symbol = p.symbol ?? ''
  const info = (p.info ?? {}) as Record<string, unknown>
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
    liquidationPrice: Number(info['liqPrice'] ?? 0),
    openTimestamp: Number(p.timestamp ?? 0),
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

  // Fetch raw execution fills from /v5/execution/list.
  // Returns Trade + Funding execType records for position reconstruction.
  // Same 7-day window constraint as the old closed-pnl endpoint.
  private async fetchBybitExecutions(
    category: 'linear' | 'inverse',
    since?: number,
    until?: number,
  ): Promise<RawExecution[]> {
    const executions: RawExecution[] = []
    let cursor: string | undefined

    do {
      const params: Record<string, unknown> = { category, limit: 100 }
      if (since !== undefined) params['startTime'] = since
      if (until !== undefined) params['endTime']   = until
      if (cursor) params['cursor'] = cursor

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (this.exchange as any).privateGetV5ExecutionList(params) as Record<string, unknown>
      const res  = (response?.result ?? {}) as Record<string, unknown>
      const list = (res.list ?? []) as Array<Record<string, string>>

      if (list.length === 0) break

      for (const row of list) {
        if (row['execType'] === 'Trade' || row['execType'] === 'Funding') {
          executions.push(row as unknown as RawExecution)
        }
      }

      cursor = res.nextPageCursor as string | undefined
    } while (cursor)

    return executions
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

    // Futures: use execution/list — real fill timestamps + execPnl per closing fill
    const [linearResult, inverseResult] = await Promise.allSettled([
      this.fetchBybitExecutions('linear',  since, until).then(e => reconstructPositions(e, 'linear')),
      this.fetchBybitExecutions('inverse', since, until).then(e => reconstructPositions(e, 'inverse')),
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
