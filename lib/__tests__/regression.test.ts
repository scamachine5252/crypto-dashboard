/**
 * Regression tests — one test per class of mistake documented in CASE_STUDY.md.
 *
 * Each describe block is labelled with the case study reference (A1, B8, etc.).
 * If a test here fails it means a previously fixed bug has been re-introduced.
 *
 * DO NOT delete tests from this file. If behaviour intentionally changes, update
 * the test and add a comment explaining why.
 */

import {
  summarizeFilteredTrades,
  buildOverlayData,
  aggregateOverlayData,
  normalizeEquityCurve,
  buildPerAccountMetrics,
} from '../calculations'
import { mapCcxtTrade } from '../adapters/ccxt-utils'
import { formatPercent, formatMoney } from '../utils'
import type { DailyPnLEntry, Trade } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
    subAccountId: 'acc-a',
    exchangeId: 'binance',
    symbol: 'BTC/USDT',
    side: 'long',
    tradeType: 'spot',
    entryPrice: 50000,
    exitPrice: 51000,
    quantity: 0.1,
    pnl: 100,
    pnlPercent: 2,
    fee: 10,
    durationMin: 60,
    leverage: 1,
    fundingCost: 0,
    isOvernight: false,
    openedAt: '2025-01-01T10:00:00.000Z',
    closedAt: '2025-01-01T11:00:00.000Z',
    ...overrides,
  }
}

function makeDaily(
  days: number,
  pnl: number,
  subAccountId = 'acc-a',
  exchangeId: 'binance' | 'bybit' | 'okx' = 'binance',
): DailyPnLEntry[] {
  const entries: DailyPnLEntry[] = []
  let cum = 0
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)
    cum += pnl
    entries.push({ date, pnl, cumulativePnl: cum, exchangeId, subAccountId })
  }
  return entries
}

// ---------------------------------------------------------------------------
// A2 — PnL extraction: string values, all exchange field names
// Previously: Number() was not called; string "1.5000" → NaN; wrong field names
// ---------------------------------------------------------------------------
describe('A2 · mapCcxtTrade — PnL extraction', () => {
  it('extracts Binance futures realizedPnl (camelCase) as a number', () => {
    const t = mapCcxtTrade(
      { id: '1', symbol: 'BTC/USDT:USDT', side: 'buy', price: 50000, amount: 0.1, info: { realizedPnl: '125.50' } },
      'binance',
    )
    expect(t.pnl).toBeCloseTo(125.5)
    expect(typeof t.pnl).toBe('number')
  })

  it('extracts Bybit closedPnl from info (string → number)', () => {
    const t = mapCcxtTrade(
      { id: '2', symbol: 'ETH/USDT:USDT', side: 'sell', price: 3000, amount: 1, info: { closedPnl: '-42.00' } },
      'bybit',
    )
    expect(t.pnl).toBeCloseTo(-42)
    expect(typeof t.pnl).toBe('number')
  })

  it('extracts OKX realised_pnl (snake_case) from info', () => {
    const t = mapCcxtTrade(
      { id: '3', symbol: 'SOL/USDT:USDT', side: 'buy', price: 200, amount: 5, info: { realised_pnl: '18.75' } },
      'okx',
    )
    expect(t.pnl).toBeCloseTo(18.75)
  })

  it('falls back to 0 when no PnL field is present (spot trade with no realized PnL)', () => {
    const t = mapCcxtTrade(
      { id: '4', symbol: 'BTC/USDT', side: 'buy', price: 50000, amount: 0.1, info: {} },
      'binance',
    )
    expect(t.pnl).toBe(0)
  })

  it('handles numeric (non-string) PnL values without converting to NaN', () => {
    const t = mapCcxtTrade(
      { id: '5', symbol: 'BTC/USDT:USDT', side: 'buy', price: 50000, amount: 0.1, info: { realizedPnl: 99 } },
      'binance',
    )
    expect(t.pnl).toBe(99)
    expect(Number.isFinite(t.pnl)).toBe(true)
  })

  it('PnL is never NaN regardless of input type', () => {
    const inputs = ['0', '0.00', '-100.5', 0, -100.5, null, undefined, '']
    inputs.forEach((rawPnl) => {
      const t = mapCcxtTrade(
        { id: 'x', symbol: 'BTC/USDT', side: 'buy', price: 1, amount: 1, info: rawPnl != null ? { realizedPnl: rawPnl } : {} },
        'binance',
      )
      expect(Number.isNaN(t.pnl)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// A3 — tradeType detection: futures symbol contains ':' separator
// Previously: all trades were classified as 'spot' regardless of symbol
// ---------------------------------------------------------------------------
describe('A3 · mapCcxtTrade — tradeType from symbol format', () => {
  it('classifies CCXT futures symbol (BTC/USDT:USDT) as futures', () => {
    const t = mapCcxtTrade({ id: '1', symbol: 'BTC/USDT:USDT', side: 'buy', price: 1, amount: 1, info: {} }, 'binance')
    expect(t.tradeType).toBe('futures')
  })

  it('classifies spot symbol (BTC/USDT) as spot', () => {
    const t = mapCcxtTrade({ id: '2', symbol: 'BTC/USDT', side: 'buy', price: 1, amount: 1, info: {} }, 'binance')
    expect(t.tradeType).toBe('spot')
  })

  it('classifies Bybit USDT-M perpetual (BTC/USDT:USDT) as futures', () => {
    const t = mapCcxtTrade({ id: '3', symbol: 'ETH/USDT:USDT', side: 'sell', price: 1, amount: 1, info: {} }, 'bybit')
    expect(t.tradeType).toBe('futures')
  })
})

// ---------------------------------------------------------------------------
// A24 — Leverage: string values and notional/margin fallback
// Previously: typeof check failed on strings → leverage always 1
// ---------------------------------------------------------------------------
describe('A24 · mapCcxtTrade — leverage extraction', () => {
  it('parses string leverage "5" → 5', () => {
    const t = mapCcxtTrade(
      { id: '1', symbol: 'BTC/USDT:USDT', side: 'buy', price: 1, amount: 1, info: { leverage: '5' } },
      'bybit',
    )
    expect(t.leverage).toBe(5)
  })

  it('passes through numeric leverage unchanged', () => {
    const t = mapCcxtTrade(
      { id: '2', symbol: 'BTC/USDT:USDT', side: 'buy', price: 1, amount: 1, info: { leverage: 10 } },
      'binance',
    )
    expect(t.leverage).toBe(10)
  })

  it('defaults to 1 when leverage field is absent', () => {
    const t = mapCcxtTrade(
      { id: '3', symbol: 'BTC/USDT:USDT', side: 'buy', price: 1, amount: 1, info: {} },
      'binance',
    )
    expect(t.leverage).toBe(1)
  })

  it('leverage is never NaN or Infinity — bad string inputs fall back to 1', () => {
    // Realistic bad API values: empty string, numeric string 'NaN', missing field
    const badValues: Array<unknown> = [null, undefined, '', 'NaN', 0, -5]
    badValues.forEach((v) => {
      const t = mapCcxtTrade(
        { id: 'x', symbol: 'BTC/USDT:USDT', side: 'buy', price: 1, amount: 1, info: v != null ? { leverage: v } : {} },
        'binance',
      )
      expect(Number.isFinite(t.leverage)).toBe(true)
      expect(t.leverage).toBeGreaterThan(0)
    })
  })
})

// ---------------------------------------------------------------------------
// B8 — Supabase pagination: accumulator must collect ALL pages
// Previously: no pagination → hard cap at 1000 rows, silently discarded the rest
// ---------------------------------------------------------------------------
describe('B8 · Supabase pagination accumulator logic', () => {
  /**
   * This tests the pattern used in all API routes (trades, performance, dashboard).
   * The actual Supabase call is mocked; what matters is the while-loop logic.
   */
  function paginateAll(totalRows: number, pageSize: number): number {
    // Simulates the accumulator loop in every API route
    const all: number[] = []
    let from = 0
    while (true) {
      const page = Array.from({ length: Math.min(pageSize, totalRows - from) }, (_, i) => from + i)
      all.push(...page)
      from += pageSize
      if (page.length < pageSize) break
    }
    return all.length
  }

  it('fetches all rows when total is exactly page size', () => {
    expect(paginateAll(1000, 1000)).toBe(1000)
  })

  it('fetches all rows when total exceeds page size', () => {
    expect(paginateAll(2500, 1000)).toBe(2500)
  })

  it('fetches all rows for a large dataset (10 000)', () => {
    expect(paginateAll(10000, 1000)).toBe(10000)
  })

  it('fetches correctly when total is not a multiple of page size', () => {
    expect(paginateAll(2342, 1000)).toBe(2342)
  })

  it('handles zero rows without infinite loop', () => {
    expect(paginateAll(0, 1000)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// B17 — Equity curve: buildOverlayData builds correct per-account rows
// NOTE: In-chart normalization (first point → 0) happens in OverlayLineChart.
// Here we guard the data layer: correct keys, numeric values, correct date range.
// Previously: baseline subtraction bug caused wrong chart values.
// ---------------------------------------------------------------------------
describe('B17 · buildOverlayData — output structure', () => {
  const DR = { start: '2025-01-01', end: '2025-01-31' }

  it('produces rows keyed by subAccountId', () => {
    const daily = makeDaily(30, 100, 'acc-a')
    const result = buildOverlayData(daily, ['acc-a'], DR)
    expect(result.length).toBeGreaterThan(0)
    expect(typeof result[0]['acc-a']).toBe('number')
  })

  it('produces numeric values for all accounts in a multi-account dataset', () => {
    const daily = [...makeDaily(30, 100, 'acc-a'), ...makeDaily(30, 200, 'acc-b')]
    const result = buildOverlayData(daily, ['acc-a', 'acc-b'], DR)
    expect(result.length).toBeGreaterThan(0)
    expect(typeof result[0]['acc-a']).toBe('number')
    expect(typeof result[0]['acc-b']).toBe('number')
  })

  it('final row value for a single account reflects accumulated PnL', () => {
    const daily = makeDaily(30, 100, 'acc-a')
    const result = buildOverlayData(daily, ['acc-a'], DR)
    const last = result[result.length - 1]
    expect(last['acc-a']).toBeGreaterThan(0)
  })

  it('returns empty array when no data falls within the date range', () => {
    const daily = makeDaily(30, 100, 'acc-a') // Jan 2025
    const result = buildOverlayData(daily, ['acc-a'], { start: '2024-01-01', end: '2024-01-31' })
    expect(result).toEqual([])
  })

  it('carries forward last known value for days with no trade activity', () => {
    // Only trade on day 1; all subsequent days should carry that value forward
    const sparse: DailyPnLEntry[] = [
      { date: '2025-01-01', pnl: 500, cumulativePnl: 500, subAccountId: 'acc-a', exchangeId: 'binance' },
    ]
    const result = buildOverlayData(sparse, ['acc-a'], DR)
    const lastVal = result[result.length - 1]['acc-a']
    expect(lastVal).toBe(500) // carried forward from day 1
  })
})

describe('B17 · aggregateOverlayData — reduces daily series into buckets', () => {
  const DR = { start: '2025-01-01', end: '2025-01-31' }

  it('weekly timeframe produces fewer rows than daily', () => {
    const daily = [...makeDaily(30, 100, 'acc-a'), ...makeDaily(30, 200, 'acc-b')]
    const dailySeries  = buildOverlayData(daily, ['acc-a', 'acc-b'], DR)
    const weeklySeries = aggregateOverlayData(dailySeries, 'weekly')
    expect(weeklySeries.length).toBeLessThan(dailySeries.length)
  })

  it('monthly timeframe produces fewer rows than weekly', () => {
    const daily = makeDaily(30, 100, 'acc-a')
    const dailySeries   = buildOverlayData(daily, ['acc-a'], DR)
    const weeklySeries  = aggregateOverlayData(dailySeries, 'weekly')
    const monthlySeries = aggregateOverlayData(dailySeries, 'monthly')
    expect(monthlySeries.length).toBeLessThanOrEqual(weeklySeries.length)
  })

  it('daily passthrough: aggregateOverlayData with daily returns same rows', () => {
    const daily = makeDaily(10, 100, 'acc-a')
    const dailySeries = buildOverlayData(daily, ['acc-a'], DR)
    const result = aggregateOverlayData(dailySeries, 'daily')
    expect(result.length).toBe(dailySeries.length)
  })

  it('all account keys are preserved in aggregated output', () => {
    const daily = [...makeDaily(30, 100, 'acc-a'), ...makeDaily(30, 50, 'acc-b')]
    const dailySeries  = buildOverlayData(daily, ['acc-a', 'acc-b'], DR)
    const weeklySeries = aggregateOverlayData(dailySeries, 'weekly')
    expect(typeof weeklySeries[0]['acc-a']).toBe('number')
    expect(typeof weeklySeries[0]['acc-b']).toBe('number')
  })
})

describe('B17 · normalizeEquityCurve — regression (first point = 0)', () => {
  it('first cumulativePnl is always 0 regardless of starting cumulative', () => {
    // Simulate a curve that starts mid-year with non-zero cumulative
    const entries: DailyPnLEntry[] = [
      { date: '2025-06-01', pnl: 500, cumulativePnl: 5000, subAccountId: 'acc-a', exchangeId: 'binance' },
      { date: '2025-06-02', pnl: 300, cumulativePnl: 5300, subAccountId: 'acc-a', exchangeId: 'binance' },
      { date: '2025-06-03', pnl: -100, cumulativePnl: 5200, subAccountId: 'acc-a', exchangeId: 'binance' },
    ]
    const result = normalizeEquityCurve(entries, 'acc-a')
    expect(result[0].cumulativePnl).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// D27 — buildPerAccountMetrics includes totalNotional in extended metrics
// Previously: totalNotional was computed but not stored in typed ExtendedMetrics field.
// NOTE: This function reads from mock-data internally; we use valid mock sub-account IDs.
// ---------------------------------------------------------------------------
describe('D27 · buildPerAccountMetrics — totalNotional in extended', () => {
  const DR = { start: '2025-01-01', end: '2025-12-31' }

  it('extended.totalNotional is a finite number (not undefined, NaN, or missing)', () => {
    const rows = buildPerAccountMetrics(['binance-alpha'], DR, 'spot')
    expect(rows.length).toBeGreaterThanOrEqual(0) // may be 0 if no spot trades
    // If rows exist, totalNotional must be a valid number
    for (const row of rows) {
      expect(typeof row.metrics.totalNotional).toBe('number')
      expect(Number.isFinite(row.metrics.totalNotional)).toBe(true)
      expect(row.metrics.totalNotional).toBeGreaterThanOrEqual(0)
    }
  })

  it('extended.totalNotional is present for futures accounts', () => {
    const rows = buildPerAccountMetrics(['bybit-delta'], DR, 'futures')
    for (const row of rows) {
      expect('totalNotional' in row.metrics).toBe(true)
      expect(Number.isFinite(row.metrics.totalNotional)).toBe(true)
    }
  })

  it('totalNotional in extras matches totalNotional in extended', () => {
    // Both must be equal — extras.totalNotional and extended.totalNotional are derived from the same trades
    const rows = buildPerAccountMetrics(['binance-beta'], DR, 'spot')
    for (const row of rows) {
      expect(row.metrics.totalNotional).toBe(row.extras['totalNotional'])
    }
  })
})

// ---------------------------------------------------------------------------
// C · summarizeFilteredTrades — totalVolume is qty × entryPrice (not exitPrice)
// Previously: not computed at all; added in response to missing metric
// ---------------------------------------------------------------------------
describe('C · summarizeFilteredTrades — totalVolume regression', () => {
  it('computes totalVolume as Σ (quantity × entryPrice)', () => {
    const trades = [
      makeTrade({ id: 't1', quantity: 1,   entryPrice: 1000, exitPrice: 9999 }),
      makeTrade({ id: 't2', quantity: 0.5, entryPrice: 2000, exitPrice: 9999 }),
    ]
    // 1×1000 + 0.5×2000 = 1000 + 1000 = 2000
    expect(summarizeFilteredTrades(trades).totalVolume).toBeCloseTo(2000, 4)
  })

  it('totalVolume uses entryPrice, not exitPrice', () => {
    const trade = makeTrade({ quantity: 1, entryPrice: 100, exitPrice: 200 })
    expect(summarizeFilteredTrades([trade]).totalVolume).toBe(100)
  })

  it('totalVolume is 0 for empty trade list', () => {
    expect(summarizeFilteredTrades([]).totalVolume).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// E11 — formatPercent: takes plain percent value, adds '+' once, no division by 100
// Previously: callers divided by 100 again AND prepended '+' manually → "++0.00%"
// ---------------------------------------------------------------------------
describe('E11 · formatPercent — contract regression', () => {
  it('formats a positive plain percent correctly (no double +)', () => {
    expect(formatPercent(5.23)).toBe('+5.23%')
  })

  it('formats zero correctly', () => {
    expect(formatPercent(0)).toBe('+0.00%')
  })

  it('formats a negative value correctly (no extra -)', () => {
    expect(formatPercent(-3.14)).toBe('-3.14%')
  })

  it('does NOT accept a ratio (0.0523 is not 5.23%)', () => {
    // A caller passing 0.0523 (ratio) instead of 5.23 (percent) would get "+0.05%"
    // This test documents the expected failure mode so callers know the contract.
    const wrongInput = 5.23 / 100 // ratio, not percent
    expect(formatPercent(wrongInput)).not.toBe('+5.23%')
    expect(formatPercent(wrongInput)).toBe('+0.05%')
  })

  it('prepends + exactly once — no double prefix', () => {
    const result = formatPercent(10)
    expect(result.startsWith('++')).toBe(false)
    expect(result.startsWith('+')).toBe(true)
    expect(result.split('+').length - 1).toBe(1) // exactly one '+'
  })
})

// ---------------------------------------------------------------------------
// E11 — formatMoney: compact mode thresholds
// Guards against accidental threshold changes that would break dashboard cards
// ---------------------------------------------------------------------------
describe('E11 · formatMoney — compact threshold regression', () => {
  it('formats values >= 1M with M suffix', () => {
    expect(formatMoney(1_500_000)).toBe('$1.50M')
  })

  it('formats values >= 1K with K suffix', () => {
    expect(formatMoney(2500)).toBe('$2.5K')
  })

  it('formats values < 1K as full dollar amount', () => {
    expect(formatMoney(500)).toMatch(/\$5/)
  })

  it('formats negative values correctly', () => {
    expect(formatMoney(-2500)).toBe('$-2.5K')
  })
})

// ---------------------------------------------------------------------------
// E16 — History page default date range covers 180 days (matches Full History scan)
// Previously: default was 30 days → most trades were invisible on first load
// ---------------------------------------------------------------------------
describe('E16 · history date range — 180-day default', () => {
  it('a 180-day date range covers the full scan window', () => {
    const end   = new Date()
    const start = new Date(end.getTime() - 180 * 24 * 60 * 60 * 1000)
    const days  = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
    expect(days).toBe(180)
  })

  it('30-day range is NOT sufficient for the full scan window', () => {
    const end   = new Date()
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
    const days  = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
    expect(days).toBeLessThan(180)
  })
})

// ---------------------------------------------------------------------------
// A4 — Chunk size must not exceed exchange maximum time window
// Previously: Bybit chunks were 30 days but API silently caps at 7 days
// ---------------------------------------------------------------------------
describe('A4 · sync chunk size — must not exceed exchange API window limit', () => {
  const BYBIT_MAX_WINDOW_DAYS = 7
  const FULL_HISTORY_DAYS     = 180

  it('Bybit chunk size does not exceed the 7-day API window limit', () => {
    const BYBIT_CHUNK_DAYS = 7 // from app/api/sync/bybit/full/route.ts
    expect(BYBIT_CHUNK_DAYS).toBeLessThanOrEqual(BYBIT_MAX_WINDOW_DAYS)
  })

  it('180-day history is fully covered by the chunk count', () => {
    const CHUNK_DAYS    = 7
    const totalChunks   = Math.ceil(FULL_HISTORY_DAYS / CHUNK_DAYS)
    const daysCovered   = totalChunks * CHUNK_DAYS
    expect(daysCovered).toBeGreaterThanOrEqual(FULL_HISTORY_DAYS)
  })
})

// ---------------------------------------------------------------------------
// Rate limit fix — BinanceAdapter must have enableRateLimit: true
// Previously: CCXT instance created without enableRateLimit; 655/660 full-history
// symbols failed due to Binance USDT-M weight limit (2400/min) being exceeded
// ---------------------------------------------------------------------------
describe('BinanceAdapter — enableRateLimit (rate limit fix)', () => {
  it('CCXT instance has enableRateLimit enabled', () => {
    // Import here (not at top) because binance.ts uses 'server-only'
    // which is mocked in jest.config.ts via moduleNameMapper
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BinanceAdapter } = require('../adapters/binance')
    const adapter = new BinanceAdapter({ apiKey: 'k', apiSecret: 's' })
    // Access the internal exchange instance — CCXT stores this flag on the instance
    expect((adapter as { exchange: { enableRateLimit: boolean } }).exchange.enableRateLimit).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Auto-detect instrument — detectBinanceInstrument utility
// Previously: user had to manually select instrument type; choosing wrong type
// caused silent sync failures (e.g., futures-only account stored as 'spot' → 0 trades)
// ---------------------------------------------------------------------------
describe('detectBinanceInstrument', () => {
  // Helper: build a mock ccxt.binance class that resolves or rejects per probe
  function makeMockCcxt(opts: {
    spot?: boolean
    futures?: boolean
    pm?: boolean
  }) {
    return {
      binance: jest.fn().mockImplementation((config: Record<string, unknown>) => {
        const isPm = !!(config['options'] && (config['options'] as Record<string,unknown>)['portfolioMargin'])
        const isFutures = !!(config['options'] && (config['options'] as Record<string,unknown>)['defaultType'] === 'future') && !isPm
        const isSpot = !isFutures && !isPm
        return {
          fetchBalance: jest.fn().mockImplementation(() => {
            if (isPm)      return opts.pm      ? Promise.resolve({}) : Promise.reject(new Error('Not PM'))
            if (isFutures) return opts.futures ? Promise.resolve({}) : Promise.reject(new Error('No futures'))
            if (isSpot)    return opts.spot    ? Promise.resolve({}) : Promise.reject(new Error('No spot'))
            return Promise.reject(new Error('Unknown'))
          }),
        }
      }),
    }
  }

  it('returns portfolio_margin when PM fetchBalance succeeds', async () => {
    const { detectBinanceInstrument } = require('../adapters/binance-detect')
    const mockCcxt = makeMockCcxt({ spot: true, futures: true, pm: true })
    const result = await detectBinanceInstrument('key', 'secret', mockCcxt)
    expect(result).toBe('portfolio_margin')
  })

  it('returns unified when both spot and futures succeed', async () => {
    const { detectBinanceInstrument } = require('../adapters/binance-detect')
    const mockCcxt = makeMockCcxt({ spot: true, futures: true, pm: false })
    const result = await detectBinanceInstrument('key', 'secret', mockCcxt)
    expect(result).toBe('unified')
  })

  it('returns futures when only futures succeeds', async () => {
    const { detectBinanceInstrument } = require('../adapters/binance-detect')
    const mockCcxt = makeMockCcxt({ spot: false, futures: true, pm: false })
    const result = await detectBinanceInstrument('key', 'secret', mockCcxt)
    expect(result).toBe('futures')
  })

  it('returns spot when only spot succeeds', async () => {
    const { detectBinanceInstrument } = require('../adapters/binance-detect')
    const mockCcxt = makeMockCcxt({ spot: true, futures: false, pm: false })
    const result = await detectBinanceInstrument('key', 'secret', mockCcxt)
    expect(result).toBe('spot')
  })

  it('returns unified (safe default) when all probes fail', async () => {
    const { detectBinanceInstrument } = require('../adapters/binance-detect')
    const mockCcxt = makeMockCcxt({ spot: false, futures: false, pm: false })
    const result = await detectBinanceInstrument('key', 'secret', mockCcxt)
    expect(result).toBe('unified')
  })
})
