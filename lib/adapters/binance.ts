import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult, RawPosition } from './types'
import type { DailyPnLEntry, Trade, DateRange } from '../types'

interface BinanceCredentials {
  apiKey: string
  apiSecret: string
  portfolioMargin?: boolean
}

export interface FullTradesResult {
  trades: Trade[]
  failedSymbols: { symbol: string; error: string }[]
}

type RawFapiTrade = {
  symbol: string; side: string; price: string; qty: string
  realizedPnl: string; commission: string; commissionAsset: string
  time: number; positionSide: string; orderId: number; id: number
}

type FapiEx = {
  fapiPrivateGetIncome:     (p: Record<string, unknown>) => Promise<Array<{ symbol: string; time: number }>>
  fapiPrivateGetUserTrades: (p: Record<string, unknown>) => Promise<RawFapiTrade[]>
}

export interface DiscoveredSymbol {
  rawSymbol: string
  weekIndices: number[]  // which of the 26 7-day windows had income events for this symbol
}

export class BinanceAdapter implements ExchangeAdapter {
  private exchange: ccxt.binance

  constructor(credentials: BinanceCredentials) {
    this.exchange = new ccxt.binance({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      enableRateLimit: true,
      options: {
        defaultType: 'future',
        ...(credentials.portfolioMargin ? { portfolioMargin: true } : {}),
      },
    })
  }

  async fetchPositions(): Promise<RawPosition[]> {
    try {
      const raw = await this.exchange.fetchPositions()
      return raw
        .filter((p) => p.contracts && Math.abs(Number(p.contracts)) > 0)
        .map((p) => {
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
            leverage: (() => {
              const notional = Math.abs(Number(p.notional ?? 0))
              const margin   = Number(p.initialMargin ?? 0)
              if (margin > 0) return notional / margin
              return Number(p.leverage ?? 1)
            })(),
            margin: Number(p.initialMargin ?? 0),
            liquidationPrice: Number(info['liquidationPrice'] ?? 0),
            openTimestamp: Number(p.timestamp ?? 0),
          }
        })
    } catch {
      return []
    }
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
      const firstRejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (firstRejected) throw firstRejected.reason
      throw new Error('fetchBalance: all wallet types failed')
    }

    return { usdt, tokens }
  }

  async getDailyPnL(_subAccountId: string, _dateRange: DateRange): Promise<DailyPnLEntry[]> {
    return []
  }

  // Quick Sync (48h) — income discovery + userTrades with proper endTime
  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    _limit?: number,
    _until?: number,
  ): Promise<Trade[]> {
    const effectiveSince = since ?? (Date.now() - 48 * 60 * 60 * 1000)
    const effectiveEnd   = Date.now()
    const trades: Trade[] = []
    const fapi = this.exchange as unknown as FapiEx

    // Discover symbols traded in this window
    let activeRawSymbols: string[] = []
    try {
      const income = await fapi.fapiPrivateGetIncome({
        incomeType: 'REALIZED_PNL',
        startTime:  effectiveSince,
        endTime:    effectiveEnd,
        limit:      1000,
      })
      activeRawSymbols = [...new Set(income.map((i) => i.symbol))]
    } catch {
      return trades
    }

    // Fetch fills per discovered symbol
    for (const rawSymbol of activeRawSymbols) {
      try {
        const rows = await fapi.fapiPrivateGetUserTrades({
          symbol:    rawSymbol,
          startTime: effectiveSince,
          endTime:   effectiveEnd,
          limit:     1000,
        })
        for (const r of rows) trades.push(this.mapRawFapiTrade(r, rawSymbol))
      } catch {
        // Skip symbol — not fatal
      }
    }
    return trades
  }

  // Full History — discover all traded symbols for the full 180-day scan window.
  // Returns each symbol with the specific week indices (0–25) where it had income events.
  // The caller uses weekIndices to only query those 7-day windows, skipping empty ones.
  // Example: BTCUSDT traded in weeks 0,3,15 → 3 userTrades calls instead of 26.
  async discoverTradedSymbols(): Promise<DiscoveredSymbol[]> {
    const DAY    = 24 * 60 * 60 * 1000
    const WINDOW = 7 * DAY
    const scanStart = Date.now() - 180 * DAY
    const fapi = this.exchange as unknown as FapiEx
    try {
      const rows = await fapi.fapiPrivateGetIncome({
        incomeType: 'REALIZED_PNL',
        startTime:  scanStart,
        endTime:    Date.now(),
        limit:      1000,
      })

      // Group income events by symbol, compute which week indices each symbol is active in
      const symbolWeeks = new Map<string, Set<number>>()
      for (const row of rows) {
        const t = Number(row.time)
        const weekIndex = Number.isFinite(t) ? Math.floor((t - scanStart) / WINDOW) : 0
        const clamped   = Math.min(Math.max(weekIndex, 0), 25)
        if (!symbolWeeks.has(row.symbol)) symbolWeeks.set(row.symbol, new Set())
        symbolWeeks.get(row.symbol)!.add(clamped)
      }

      return Array.from(symbolWeeks.entries()).map(([rawSymbol, weeks]) => ({
        rawSymbol,
        weekIndices: Array.from(weeks).sort((a, b) => a - b),
      }))
    } catch {
      return []
    }
  }

  // Full History — ONE raw symbol, querying only the week indices where income events exist.
  // weekIndices comes from discoverTradedSymbols() — typically 1–10 weeks per symbol,
  // not always 26. This makes the per-symbol call much faster for infrequently-traded pairs.
  async getFullTrades(rawSymbol: string, weekIndices: number[]): Promise<FullTradesResult> {
    const DAY    = 24 * 60 * 60 * 1000
    const WINDOW = 7 * DAY
    const scanStart = Date.now() - 180 * DAY
    const fapi = this.exchange as unknown as FapiEx
    const trades: Trade[] = []
    const failedSymbols: { symbol: string; error: string }[] = []

    for (const weekIndex of weekIndices) {
      const windowStart = scanStart + weekIndex * WINDOW
      const windowEnd   = Math.min(windowStart + WINDOW, Date.now())
      try {
        const rows = await fapi.fapiPrivateGetUserTrades({
          symbol:    rawSymbol,
          startTime: windowStart,
          endTime:   windowEnd,
          limit:     1000,
        })
        for (const r of rows) trades.push(this.mapRawFapiTrade(r, rawSymbol))
      } catch (err) {
        const base = rawSymbol.endsWith('USDT') ? rawSymbol.slice(0, -4) : rawSymbol
        const errMsg = err instanceof Error ? err.message : String(err)
failedSymbols.push({
          symbol: `${base}/USDT:USDT`,
          error:  errMsg,
        })
        break  // symbol is invalid — skip remaining windows
      }
    }

    return { trades, failedSymbols }
  }

  private mapRawFapiTrade(r: RawFapiTrade, rawSymbol: string): Trade {
    const base     = rawSymbol.endsWith('USDT') ? rawSymbol.slice(0, -4) : rawSymbol
    const qty      = Number(r.qty)
    const pnl      = Number(r.realizedPnl)
    const exitPrice  = Number(r.price)
    // Hedge mode:   positionSide = 'LONG' | 'SHORT'
    // One-way mode: positionSide = 'BOTH' — BUY closes short, SELL closes long
    const isShort = r.positionSide === 'SHORT' ||
      (r.positionSide === 'BOTH' && r.side === 'BUY' && pnl !== 0)
    // entryPrice derivation: Binance calculates realizedPnl from the position's
    // average entry price, so inverting gives the mathematically exact entryPrice.
    const derived    = qty > 0 ? (isShort ? exitPrice + pnl / qty : exitPrice - pnl / qty) : exitPrice
    const entryPrice = Number.isFinite(derived) && derived > 0 ? derived : exitPrice
    const ts = new Date(Number(r.time)).toISOString()
    return {
      id:           String(r.id),
      symbol:       `${base}/USDT:USDT`,
      side:         isShort ? 'short' : 'long',
      entryPrice,
      exitPrice,
      quantity:     qty,
      pnl,
      fee:          Number(r.commission),
      openedAt:     ts,
      closedAt:     ts,
      tradeType:    'futures',
      pnlPercent:   0,
      durationMin:  0,
      leverage:     1,
      fundingCost:  0,
      isOvernight:  false,
      exchangeId:   'binance' as const,
      subAccountId: '',
    }
  }
}
