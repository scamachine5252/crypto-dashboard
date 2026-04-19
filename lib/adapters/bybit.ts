import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult, RawPosition } from './types'
import type { DailyPnLEntry, Trade, DateRange, ExchangeId, TradeSide, TradeType } from '../types'
import { mapCcxtTrade } from './ccxt-utils'

// ---------------------------------------------------------------------------
// Raw execution record from Bybit /v5/execution/list
// NOTE: execPnl is NOT returned by the REST endpoint — it is absent (undefined).
//       Use closedSize > 0 as the closing-fill signal, not execPnl.
// ---------------------------------------------------------------------------
export interface RawExecution {
  execTime:   string  // ms timestamp
  symbol:     string  // e.g. 'BTCUSDT'
  side:       string  // 'Buy' | 'Sell'
  execType:   string  // 'Trade' | 'Funding' | 'AdlTrade' | 'BustTrade'
  execPrice:  string
  execQty:    string
  execPnl:    string  // absent in REST responses; present in some account types
  execFee:    string  // commission (positive = cost, negative = income for rebates)
  closedSize: string  // qty closed by this fill; '0' for pure opening fills
  orderId:    string
}

// ---------------------------------------------------------------------------
// Stateful position tracking — serializable so it can be passed between chunks
// ---------------------------------------------------------------------------
export interface SymbolState {
  size:     number    // current open size (positive = long, treated as unsigned here)
  avgEntry: number    // weighted-average entry price
  openTime: string    // ISO timestamp of the first opening fill
  openSide: TradeSide // 'long' | 'short'
}

// Plain JSON — safe to pass in HTTP request/response bodies between chunks
export type ReconstructionStateJson = Record<string, {
  size:     number
  avgEntry: number
  openTime: string
  openSide: string
}>

function stateFromJson(json: ReconstructionStateJson): Map<string, SymbolState> {
  const map = new Map<string, SymbolState>()
  for (const [sym, s] of Object.entries(json)) {
    map.set(sym, {
      size:     s.size,
      avgEntry: s.avgEntry,
      openTime: s.openTime,
      openSide: s.openSide as TradeSide,
    })
  }
  return map
}

function stateToJson(map: Map<string, SymbolState>): ReconstructionStateJson {
  const json: ReconstructionStateJson = {}
  for (const [sym, s] of map.entries()) {
    if (s.size > 0) {  // only persist open positions; closed ones are not needed next chunk
      json[sym] = { size: s.size, avgEntry: s.avgEntry, openTime: s.openTime, openSide: s.openSide }
    }
  }
  return json
}

// ---------------------------------------------------------------------------
// Reconstruct closed positions from execution fills.
//
// Signal: closedSize > 0 marks a closing fill (confirmed by live API inspection:
// 101/500 rows had non-zero closedSize; execPnl was absent for all 500 rows).
//
// PnL: use execPnl when present; otherwise calculate from reconstructed avgEntry.
// This handles the common case where Bybit REST does not include execPnl.
//
// Stateful: accepts initialState from the previous chunk so cross-chunk
// positions (opened in chunk N, closed in chunk N+1) are reconstructed correctly.
// ---------------------------------------------------------------------------
export function reconstructPositions(
  executions: RawExecution[],
  category: 'linear' | 'inverse',
  initialState?: ReconstructionStateJson,
): { trades: Trade[], finalState: ReconstructionStateJson } {
  const tradeFills   = executions.filter(e => e.execType === 'Trade')
  const fundingFills = executions.filter(e => e.execType === 'Funding')

  // Sort trade fills chronologically — required for correct state tracking
  tradeFills.sort((a, b) => Number(a.execTime) - Number(b.execTime))

  // Per-symbol funding accumulation (for proportional distribution across closes)
  const fundingBySymbol: Record<string, number> = {}
  for (const f of fundingFills) {
    fundingBySymbol[f.symbol] = (fundingBySymbol[f.symbol] ?? 0) + Number(f.execFee)
  }

  // Per-symbol total closed qty — denominator for proportional funding
  // Uses closedSize (correct signal, confirmed by live API data)
  const totalClosedBySymbol: Record<string, number> = {}
  for (const f of tradeFills) {
    const cs = Number(f.closedSize)
    if (cs > 0) {
      totalClosedBySymbol[f.symbol] = (totalClosedBySymbol[f.symbol] ?? 0) + cs
    }
  }

  // Initialize per-symbol state from previous chunk (or empty for first chunk)
  const stateMap: Map<string, SymbolState> = initialState
    ? stateFromJson(initialState)
    : new Map()

  const trades: Trade[] = []

  for (const exec of tradeFills) {
    const qty       = Number(exec.execQty)
    const price     = Number(exec.execPrice)
    const closedQty = Number(exec.closedSize)  // 0 for opening fills; >0 for closing fills

    let state = stateMap.get(exec.symbol) ?? {
      size: 0, avgEntry: 0, openTime: '', openSide: 'long' as TradeSide,
    }

    if (closedQty > 0) {
      // ── Closing fill ────────────────────────────────────────────────────────
      // PnL: prefer execPnl if present, otherwise reconstruct from prices.
      // execPnl is absent (undefined) in Bybit REST responses for most accounts.
      const pnlRaw = exec.execPnl !== undefined && exec.execPnl !== null && exec.execPnl !== ''
        ? Number(exec.execPnl)
        : NaN  // absent → calculate below

      let pnl: number
      if (!isNaN(pnlRaw)) {
        // execPnl present: linear = already USDT; inverse = base currency → convert
        pnl = category === 'inverse' ? pnlRaw * price : pnlRaw
      } else {
        // execPnl absent: reconstruct from weighted-average entry price
        const dir = state.openSide === 'long' ? 1 : -1
        if (category === 'inverse' && state.avgEntry > 0) {
          // Inverse: PnL in USDT ≈ closedQty × (exitPrice/entryPrice − 1) × dir
          pnl = dir * closedQty * (price / state.avgEntry - 1)
        } else {
          // Linear: PnL in USDT = (exitPrice − entryPrice) × closedQty × dir
          pnl = dir * (price - state.avgEntry) * closedQty
        }
      }

      // Proportional funding for this closing fill
      const totalFunding   = fundingBySymbol[exec.symbol] ?? 0
      const totalClosed    = totalClosedBySymbol[exec.symbol] ?? 1
      const fundingForFill = totalFunding * (closedQty / totalClosed)

      trades.push({
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

      state = { ...state, size: Math.max(0, state.size - closedQty) }
    }

    // ── Opening fill (or the opened portion of a flip/partial-close fill) ────
    const openedQty = qty - closedQty
    if (openedQty > 0) {
      if (state.size === 0) {
        // New position cycle — record start time and side
        state = {
          size:     openedQty,
          avgEntry: price,
          openTime: new Date(Number(exec.execTime)).toISOString(),
          openSide: exec.side === 'Buy' ? 'long' : 'short',
        }
      } else {
        // Scale-in: update weighted-average entry price
        state = {
          ...state,
          avgEntry: (state.avgEntry * state.size + price * openedQty) / (state.size + openedQty),
          size:     state.size + openedQty,
        }
      }
    }

    stateMap.set(exec.symbol, state)
  }

  return { trades, finalState: stateToJson(stateMap) }
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
  // Paginates via cursor until all fills within the time window are fetched.
  private async fetchBybitExecutions(
    category: 'linear' | 'inverse',
    since?: number,
    until?: number,
  ): Promise<RawExecution[]> {
    const executions: RawExecution[] = []
    let cursor: string | undefined
    let pageNum = 0
    let totalRawRows = 0

    do {
      const params: Record<string, unknown> = { category, limit: 100 }
      if (since !== undefined) params['startTime'] = since
      if (until !== undefined) params['endTime']   = until
      if (cursor) params['cursor'] = cursor

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (this.exchange as any).privateGetV5ExecutionList(params) as Record<string, unknown>
      const res  = (response?.result ?? {}) as Record<string, unknown>
      const list = (res.list ?? []) as Array<Record<string, string>>

      totalRawRows += list.length
      pageNum++

      if (list.length === 0) break

      if (pageNum === 1 && list.length > 0) {
        const sample = list[0]
        console.log(`[bybit] execList ${category} p1: rows=${list.length} cursor="${res.nextPageCursor}" ` +
          `sample execType=${sample['execType']} execPnl=${sample['execPnl']} closedSize=${sample['closedSize']} execQty=${sample['execQty']}`)
      }

      for (const row of list) {
        if (row['execType'] === 'Trade' || row['execType'] === 'Funding') {
          executions.push(row as unknown as RawExecution)
        }
      }

      cursor = res.nextPageCursor as string | undefined
    } while (cursor)

    const nonZeroClosedSize = executions.filter(e => e.execType === 'Trade' && Number(e.closedSize) > 0).length
    console.log(`[bybit] execList ${category} done: pages=${pageNum} rawRows=${totalRawRows} executions=${executions.length} closingFills=${nonZeroClosedSize}`)

    return executions
  }

  // Fetch trades for a single time-bounded chunk, threading position state across chunks.
  // Called by the Full History sync route (chunk by chunk, oldest → newest).
  async getTradesForChunk(
    since: number,
    until: number,
    inheritedState?: ReconstructionStateJson,
  ): Promise<{ trades: Trade[], finalState: ReconstructionStateJson }> {
    const [spotResult, linearResult, inverseResult] = await Promise.allSettled([
      this.exchange.fetchMyTrades(undefined, since, 100, { category: 'spot', paginate: true }),
      this.fetchBybitExecutions('linear',  since, until).then(e => reconstructPositions(e, 'linear',  inheritedState)),
      this.fetchBybitExecutions('inverse', since, until).then(e => reconstructPositions(e, 'inverse', inheritedState)),
    ])

    if (linearResult.status === 'rejected' && inverseResult.status === 'rejected') {
      throw new Error(
        `Bybit execution list failed — linear: ${linearResult.reason}; inverse: ${inverseResult.reason}`
      )
    }

    const spotTrades  = spotResult.status   === 'fulfilled' ? spotResult.value.map(t => mapCcxtTrade(t, 'bybit')) : []
    const linearData  = linearResult.status === 'fulfilled' ? linearResult.value : { trades: [], finalState: {} as ReconstructionStateJson }
    const inverseData = inverseResult.status === 'fulfilled' ? inverseResult.value : { trades: [], finalState: {} as ReconstructionStateJson }

    // Merge final states: linear and inverse symbols are disjoint (BTCUSDT vs BTCUSD)
    const finalState: ReconstructionStateJson = { ...linearData.finalState, ...inverseData.finalState }

    return {
      trades: [...spotTrades, ...linearData.trades, ...inverseData.trades],
      finalState,
    }
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    limit?: number,
    until?: number,
  ): Promise<Trade[]> {
    const [spotResult, linearResult, inverseResult] = await Promise.allSettled([
      this.exchange.fetchMyTrades(undefined, since, limit ?? 100, { category: 'spot', paginate: true }),
      this.fetchBybitExecutions('linear',  since, until).then(e => reconstructPositions(e, 'linear')),
      this.fetchBybitExecutions('inverse', since, until).then(e => reconstructPositions(e, 'inverse')),
    ])

    if (linearResult.status === 'rejected' && inverseResult.status === 'rejected') {
      throw new Error(
        `Bybit execution list failed — linear: ${linearResult.reason}; inverse: ${inverseResult.reason}`
      )
    }

    const spotTrades    = spotResult.status    === 'fulfilled' ? spotResult.value.map(t => mapCcxtTrade(t, 'bybit')) : []
    const linearTrades  = linearResult.status  === 'fulfilled' ? linearResult.value.trades  : []
    const inverseTrades = inverseResult.status === 'fulfilled' ? inverseResult.value.trades : []

    return [...spotTrades, ...linearTrades, ...inverseTrades]
  }
}
