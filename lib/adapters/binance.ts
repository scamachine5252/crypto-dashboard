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

type RawPmPosition = {
  symbol: string
  positionAmt: string
  entryPrice: string
  markPrice: string
  unRealizedProfit: string
  liquidationPrice: string
  leverage: string
  notionalValue?: string
  initialMargin?: string
  positionSide: string
  updateTime: number
}

// FapiEx extends the CCXT binance instance with typed direct REST calls.
// PAPI methods are only used when portfolioMargin=true.
type FapiEx = {
  fapiPrivateGetIncome:     (p: Record<string, unknown>) => Promise<Array<{ symbol: string; time: number }>>
  fapiPrivateGetUserTrades: (p: Record<string, unknown>) => Promise<RawFapiTrade[]>
  // Portfolio Margin PAPI endpoints
  papiGetUmIncome:          (p: Record<string, unknown>) => Promise<Array<{ symbol: string; time: number }>>
  papiGetCmIncome:          (p: Record<string, unknown>) => Promise<Array<{ symbol: string; time: number }>>
  papiGetUmUserTrades:      (p: Record<string, unknown>) => Promise<RawFapiTrade[]>
  papiGetCmUserTrades:      (p: Record<string, unknown>) => Promise<RawFapiTrade[]>
  papiGetUmPositionRisk:    (p: Record<string, unknown>) => Promise<RawPmPosition[]>
  papiGetCmPositionRisk:    (p: Record<string, unknown>) => Promise<RawPmPosition[]>
  papiGetAccount:           (p: Record<string, unknown>) => Promise<{ actualEquity?: string; accountEquity?: string }>
}

export interface DiscoveredSymbol {
  rawSymbol: string
  weekIndices: number[]  // which of the 26 7-day windows had income events for this symbol
}

export class BinanceAdapter implements ExchangeAdapter {
  private exchange: ccxt.binance
  private isPortfolioMargin: boolean

  constructor(credentials: BinanceCredentials) {
    this.isPortfolioMargin = credentials.portfolioMargin ?? false
    this.exchange = new ccxt.binance({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      enableRateLimit: true,
      options: {
        defaultType: 'future',
        ...(this.isPortfolioMargin ? { portfolioMargin: true } : {}),
      },
    })
  }

  async fetchPositions(): Promise<RawPosition[]> {
    if (this.isPortfolioMargin) {
      return this.fetchPmPositions()
    }
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

  // Portfolio Margin: fetch both UM (USDT-M) and CM (Coin-M) positions via PAPI.
  private async fetchPmPositions(): Promise<RawPosition[]> {
    const fapi = this.exchange as unknown as FapiEx
    const [umResult, cmResult] = await Promise.allSettled([
      fapi.papiGetUmPositionRisk({}),
      fapi.papiGetCmPositionRisk({}),
    ])
    const all: RawPmPosition[] = [
      ...(umResult.status === 'fulfilled' ? umResult.value : []),
      ...(cmResult.status === 'fulfilled' ? cmResult.value : []),
    ]
    return this.mapRawPmPositions(all)
  }

  // Map raw PAPI position objects (UM or CM) to RawPosition.
  // PAPI field names differ from FAPI: positionAmt, unRealizedProfit, notionalValue, initialMargin.
  private mapRawPmPositions(raw: RawPmPosition[]): RawPosition[] {
    return raw
      .filter((p) => Math.abs(Number(p.positionAmt)) > 0)
      .map((p): RawPosition => {
        const posAmt   = Number(p.positionAmt)
        const side     = posAmt >= 0 ? 'long' : 'short'
        const size     = Math.abs(posAmt)
        const mPrice   = Number(p.markPrice ?? 0)
        // notionalValue can be "0" for cross-margin PM accounts; fall back to positionAmt × markPrice
        const notional = Math.abs(Number(p.notionalValue ?? 0)) || Math.abs(posAmt * mPrice)
        // initialMargin is NOT in /papi/v1/um/positionRisk — derive from leverage instead
        const leverage = Math.max(Number(p.leverage ?? 1), 1)
        const margin   = notional > 0 ? notional / leverage : 0
        // Derive symbol: BTCUSDT → BTC/USDT, BTCUSD_PERP → BTC/USD
        const rawSym = p.symbol
        let displaySymbol: string
        if (rawSym.includes('USDT')) {
          const base = rawSym.replace('USDT', '').replace(/_.*$/, '')
          displaySymbol = `${base}/USDT`
        } else {
          const base = rawSym.replace(/USD.*$/, '')
          displaySymbol = `${base}/USD`
        }
        return {
          symbol: displaySymbol,
          side,
          size,
          entryPrice: Number(p.entryPrice ?? 0),
          markPrice: Number(p.markPrice ?? 0),
          notional,
          unrealizedPnl: Number(p.unRealizedProfit ?? 0),
          leverage,
          margin,
          liquidationPrice: Number(p.liquidationPrice ?? 0),
          openTimestamp: 0,  // PAPI positionRisk has updateTime (last modified), not openTime
        }
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
    if (this.isPortfolioMargin) {
      return this.fetchPmBalance()
    }

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

  // Portfolio Margin: total equity per asset via PAPI /papi/v1/balance.
  // CCXT normalises raw.total from umWalletBalance only — this misses funds held in
  // crossMarginAsset (accounts trading cross-margin PM positions, e.g. Continum).
  // We parse raw.info directly:
  //   equity = totalWalletBalance + umUnrealizedPNL + cmUnrealizedPNL
  // Universal across all PM configurations (UM-only, cross-margin, mixed).
  private async fetchPmBalance(): Promise<BalanceResult> {
    const raw = await this.exchange.fetchBalance()
    type PapiEntry = {
      asset: string
      totalWalletBalance: string
      umUnrealizedPNL?: string
      cmUnrealizedPNL?: string
    }
    const info = (raw.info ?? []) as unknown as PapiEntry[]

    if (Array.isArray(info) && info.length > 0) {
      let usdt = 0
      const tokens: Record<string, number> = {}
      for (const entry of info) {
        const asset   = String(entry.asset ?? '')
        const wallet  = parseFloat(String(entry.totalWalletBalance ?? '0')) || 0
        const umPnl   = parseFloat(String(entry.umUnrealizedPNL    ?? '0')) || 0
        const cmPnl   = parseFloat(String(entry.cmUnrealizedPNL    ?? '0')) || 0
        const equity  = wallet + umPnl + cmPnl
        if (!Number.isFinite(equity) || equity <= 0) continue
        if (asset === 'USDT') {
          usdt = equity
        } else if (asset) {
          tokens[asset] = equity
        }
      }
      // Fetch total margin balance (all collateral in USDT) from PAPI /papi/v1/account
      let totalEquityUsdt: number | undefined
      try {
        const fapi = this.exchange as unknown as FapiEx
        const acct = await fapi.papiGetAccount({})
        // Binance PAPI returns actualEquity (total equity incl. unrealized PnL in USDT)
        const raw2 = parseFloat(String(acct?.actualEquity ?? acct?.accountEquity ?? ''))
        if (Number.isFinite(raw2) && raw2 > 0) totalEquityUsdt = raw2
      } catch (e) { console.error('[BinancePM] papiGetAccount failed:', e) }

      return { usdt, tokens, ...(totalEquityUsdt !== undefined ? { totalEquityUsdt } : {}) }
    }

    // Fallback: CCXT normalised total (UM-only accounts if raw.info unavailable)
    const total = (raw.total ?? {}) as unknown as Record<string, number>
    let usdt = total['USDT'] ?? 0
    if (!Number.isFinite(usdt)) usdt = 0
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

  // Quick Sync (48h) — income discovery + userTrades with proper endTime.
  // PM: uses PAPI income (um + cm) and PAPI userTrades.
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
      if (this.isPortfolioMargin) {
        const [umResult, cmResult] = await Promise.allSettled([
          fapi.papiGetUmIncome({ incomeType: 'REALIZED_PNL', startTime: effectiveSince, endTime: effectiveEnd, limit: 1000 }),
          fapi.papiGetCmIncome({ incomeType: 'REALIZED_PNL', startTime: effectiveSince, endTime: effectiveEnd, limit: 1000 }),
        ])
        const rows = [
          ...(umResult.status === 'fulfilled' ? umResult.value : []),
          ...(cmResult.status === 'fulfilled' ? cmResult.value : []),
        ]
        activeRawSymbols = [...new Set(rows.map((i) => i.symbol))]
      } else {
        const income = await fapi.fapiPrivateGetIncome({
          incomeType: 'REALIZED_PNL',
          startTime:  effectiveSince,
          endTime:    effectiveEnd,
          limit:      1000,
        })
        activeRawSymbols = [...new Set(income.map((i) => i.symbol))]
      }
    } catch {
      return trades
    }

    // Fetch fills per discovered symbol
    for (const rawSymbol of activeRawSymbols) {
      try {
        let rows: RawFapiTrade[]
        if (this.isPortfolioMargin) {
          const isCoinM = this.isCoinMSymbol(rawSymbol)
          rows = isCoinM
            ? await fapi.papiGetCmUserTrades({ symbol: rawSymbol, startTime: effectiveSince, endTime: effectiveEnd, limit: 1000 })
            : await fapi.papiGetUmUserTrades({ symbol: rawSymbol, startTime: effectiveSince, endTime: effectiveEnd, limit: 1000 })
        } else {
          rows = await fapi.fapiPrivateGetUserTrades({
            symbol:    rawSymbol,
            startTime: effectiveSince,
            endTime:   effectiveEnd,
            limit:     1000,
          })
        }
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
  // PM: fetches income from both UM and CM PAPI endpoints.
  async discoverTradedSymbols(): Promise<DiscoveredSymbol[]> {
    const DAY    = 24 * 60 * 60 * 1000
    const WINDOW = 7 * DAY
    const scanStart = Date.now() - 180 * DAY
    const fapi = this.exchange as unknown as FapiEx

    try {
      let rows: Array<{ symbol: string; time: number }>
      if (this.isPortfolioMargin) {
        // Daily windows (180 days × UM + CM) for complete symbol discovery.
        // Processed in batches of 10 days (20 parallel requests) to respect rate limits.
        // Weekly windows risk capping at limit=1000 on high-volume accounts.
        const BATCH_SIZE = 10
        const allRows: Array<{ symbol: string; time: number }> = []
        for (let batchStart = 0; batchStart < 180; batchStart += BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE, 180)
          const batchPromises: Promise<Array<{ symbol: string; time: number }>>[] = []
          for (let d = batchStart; d < batchEnd; d++) {
            const dayStart = scanStart + d * DAY
            const dayEnd   = Math.min(dayStart + DAY, Date.now())
            batchPromises.push(
              fapi.papiGetUmIncome({ startTime: dayStart, endTime: dayEnd, limit: 1000 }).catch(() => []),
              fapi.papiGetCmIncome({ startTime: dayStart, endTime: dayEnd, limit: 1000 }).catch(() => []),
            )
          }
          const batchResults = await Promise.all(batchPromises)
          allRows.push(...batchResults.flat())
        }
        rows = allRows
      } else {
        rows = await fapi.fapiPrivateGetIncome({
          incomeType: 'REALIZED_PNL',
          startTime:  scanStart,
          endTime:    Date.now(),
          limit:      1000,
        })
      }

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
  // PM: routes to PAPI UM or CM userTrades based on symbol format.
  async getFullTrades(rawSymbol: string, weekIndices: number[]): Promise<FullTradesResult> {
    const DAY    = 24 * 60 * 60 * 1000
    const WINDOW = 7 * DAY
    const scanStart = Date.now() - 180 * DAY
    const fapi = this.exchange as unknown as FapiEx
    const trades: Trade[] = []
    const failedSymbols: { symbol: string; error: string }[] = []
    const isCoinM = this.isCoinMSymbol(rawSymbol)

    const fetchWindowTrades = (params: Record<string, unknown>): Promise<RawFapiTrade[]> => {
      if (this.isPortfolioMargin) {
        return isCoinM
          ? fapi.papiGetCmUserTrades(params)
          : fapi.papiGetUmUserTrades(params)
      }
      return fapi.fapiPrivateGetUserTrades(params)
    }

    for (const weekIndex of weekIndices) {
      const windowStart = scanStart + weekIndex * WINDOW
      const windowEnd   = Math.min(windowStart + WINDOW, Date.now())
      try {
        const rows = await fetchWindowTrades({
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

  // Open time reconstruction via trade history.
  // Binance FAPI positionRisk only has updateTime (last modification), no openTime field.
  // Algorithm: walk trades ASC, find LAST moment position transitioned from flat/opposite → current side.
  // Handles both one-way mode (positionSide='BOTH') and hedge mode (positionSide='LONG'/'SHORT').
  // PM: routes to PAPI userTrades.
  async findPositionOpenTimes(
    symbols: Array<{ rawSymbol: string; side: 'long' | 'short' }>,
  ): Promise<Record<string, number>> {
    const fapi   = this.exchange as unknown as FapiEx
    const result: Record<string, number> = {}

    await Promise.allSettled(
      symbols.map(async ({ rawSymbol, side }) => {
        try {
          let trades: RawFapiTrade[]
          if (this.isPortfolioMargin) {
            const isCoinM = this.isCoinMSymbol(rawSymbol)
            trades = isCoinM
              ? await fapi.papiGetCmUserTrades({ symbol: rawSymbol, limit: 1000 })
              : await fapi.papiGetUmUserTrades({ symbol: rawSymbol, limit: 1000 })
          } else {
            trades = await fapi.fapiPrivateGetUserTrades({ symbol: rawSymbol, limit: 1000 })
          }
          if (!trades || trades.length === 0) return

          const sorted  = [...trades].sort((a, b) => a.time - b.time)
          const isHedge = sorted.some((t) => t.positionSide === 'LONG' || t.positionSide === 'SHORT')
          const relevantPSide = side === 'long' ? 'LONG' : 'SHORT'

          let netQty   = 0
          let openTime = sorted[0].time  // fallback: oldest trade in this 1000-trade window

          for (const t of sorted) {
            const prev = netQty
            const qty  = Number(t.qty)

            if (isHedge) {
              if (t.positionSide !== relevantPSide) continue
              const isOpening = (side === 'long' && t.side === 'BUY') || (side === 'short' && t.side === 'SELL')
              netQty = isOpening ? netQty + qty : netQty - qty
            } else {
              netQty = t.side === 'BUY' ? netQty + qty : netQty - qty
            }

            // Detect transition from flat/opposite → current side
            const wasNotOnSide = side === 'long' ? prev <= 0.0001 : prev >= -0.0001
            const isNowOnSide  = side === 'long' ? netQty > 0.0001 : netQty < -0.0001
            if (wasNotOnSide && isNowOnSide) {
              openTime = t.time  // track LAST such moment = current position run start
            }
          }

          result[rawSymbol] = openTime
        } catch {
          // Symbol not found or API error — omit from result, shows '—' in UI
        }
      }),
    )

    return result
  }

  // Coin-M (inverse) symbols end with USD followed by nothing or _PERP / _expiry.
  // USDT-M symbols always end with USDT.
  private isCoinMSymbol(rawSymbol: string): boolean {
    return rawSymbol.includes('USD') && !rawSymbol.endsWith('USDT')
  }

  private mapRawFapiTrade(r: RawFapiTrade, rawSymbol: string): Trade {
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

    // Symbol normalization: BTCUSDT → BTC/USDT:USDT, BTCUSD_PERP → BTC/USD:BTC
    let symbol: string
    if (rawSymbol.endsWith('USDT')) {
      const base = rawSymbol.slice(0, -4)
      symbol = `${base}/USDT:USDT`
    } else {
      const base = rawSymbol.replace(/USD.*$/, '')
      symbol = `${base}/USD:${base}`
    }

    return {
      id:           String(r.id),
      symbol,
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
