/**
 * Tests for BinanceAdapter.discoverTradedSymbols() pagination logic.
 *
 * These tests exist because three production bugs were found in this function:
 * 1. `time + 1` string concatenation — Binance PAPI returns `time` as a string,
 *    so without Number() wrapper cursor became "17422560000001" and the loop
 *    exited after 1 page, discovering only 8 symbols instead of 49.
 * 2. `.catch(() => [])` on each page — a mid-pagination API error silently
 *    returned partial results (less symbols) instead of failing the sync job.
 * 3. Worker compiled separately — unrelated to test coverage.
 *
 * Mocking strategy: mock ccxt at module level so new ccxt.binance() returns
 * a plain object with jest.fn() methods. BinanceAdapter casts it to FapiEx
 * (an internal interface with PAPI methods) via `as unknown as FapiEx`.
 */

// ---------------------------------------------------------------------------
// Module mocks — must come before imports
// ---------------------------------------------------------------------------

const mockPapiGetUmIncome    = jest.fn()
const mockPapiGetCmIncome    = jest.fn()
const mockFapiPrivateGetIncome = jest.fn()
const mockPapiGetUmUserTrades  = jest.fn()
const mockFapiPrivateGetUserTrades = jest.fn()

jest.mock('ccxt', () => ({
  binance: jest.fn().mockImplementation(() => ({
    papiGetUmIncome:           mockPapiGetUmIncome,
    papiGetCmIncome:           mockPapiGetCmIncome,
    fapiPrivateGetIncome:      mockFapiPrivateGetIncome,
    papiGetUmUserTrades:       mockPapiGetUmUserTrades,
    fapiPrivateGetUserTrades:  mockFapiPrivateGetUserTrades,
  })),
}))

jest.mock('server-only', () => ({}))

import { BinanceAdapter } from '../adapters/binance'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIncomeRow(symbol: string, timeMs: number | string) {
  return { symbol, incomeType: 'REALIZED_PNL', income: '10', time: timeMs }
}

/** Returns a page of `count` income rows, all with `time` as the given type. */
function makeIncomePage(
  count: number,
  baseTime: number,
  symbol = 'BTCUSDT',
  timeAsString = false,
): Array<{ symbol: string; time: number | string }> {
  return Array.from({ length: count }, (_, i) => ({
    symbol,
    time: timeAsString ? String(baseTime + i) : baseTime + i,
  }))
}

const NOW = 1_748_000_000_000  // fixed "now" so scanStart is deterministic
const DAY = 24 * 60 * 60 * 1000
const SCAN_START = NOW - 180 * DAY

function makePM() {
  return new BinanceAdapter({ apiKey: 'k', apiSecret: 's', portfolioMargin: true })
}

function makeRegular() {
  return new BinanceAdapter({ apiKey: 'k', apiSecret: 's', portfolioMargin: false })
}

beforeEach(() => {
  jest.clearAllMocks()
  // advanceTimers:true auto-advances the fake clock when async code awaits setTimeout,
  // which is needed because paginateByTime uses setTimeout for delayMs between pages.
  jest.useFakeTimers({ advanceTimers: true })
  jest.setSystemTime(NOW)
})

afterEach(() => {
  jest.useRealTimers()
})

// ---------------------------------------------------------------------------
// PM account — discoverTradedSymbols() pagination
// ---------------------------------------------------------------------------

describe('BinanceAdapter.discoverTradedSymbols() — PM account', () => {
  it('fetches all pages when first page is full (1000 rows)', async () => {
    // Page 1 is full → should fetch page 2
    mockPapiGetUmIncome
      .mockResolvedValueOnce(makeIncomePage(1000, SCAN_START + 1000))
      .mockResolvedValueOnce(makeIncomePage(5,    SCAN_START + 2000, 'ETHUSDT'))
    mockPapiGetCmIncome.mockResolvedValue([])

    const adapter = makePM()
    const symbols = await adapter.discoverTradedSymbols()

    expect(mockPapiGetUmIncome).toHaveBeenCalledTimes(2)
    expect(symbols.map(s => s.rawSymbol)).toContain('BTCUSDT')
    expect(symbols.map(s => s.rawSymbol)).toContain('ETHUSDT')
  })

  it('regression bug #1: time returned as string does not break pagination', async () => {
    // Binance PAPI returns time as a string (e.g. "1742256000000"), not a number.
    // Without Number() wrapper: cursor = "1742256000000" + 1 = "17422560000001" (10× too large)
    // → while (cursor <= endTime) becomes false → only 1 page fetched → symbols lost.
    const page1Time = SCAN_START + 1_000_000
    const page2Time = SCAN_START + 2_000_000

    mockPapiGetUmIncome
      .mockResolvedValueOnce(makeIncomePage(1000, page1Time, 'BTCUSDT', /* timeAsString */ true))
      .mockResolvedValueOnce(makeIncomePage(3,    page2Time, 'GALAUSDT', true))
    mockPapiGetCmIncome.mockResolvedValue([])

    const adapter = makePM()
    const symbols = await adapter.discoverTradedSymbols()

    // Must fetch both pages — GALAUSDT only appears on page 2
    expect(mockPapiGetUmIncome).toHaveBeenCalledTimes(2)
    const names = symbols.map(s => s.rawSymbol)
    expect(names).toContain('GALAUSDT')
  })

  it('regression bug #2: API error on page 2 propagates instead of returning partial results', async () => {
    // Without fix: .catch(() => []) would swallow the error, break out of the loop,
    // and return only the symbols found in page 1 — no error, silently incomplete.
    mockPapiGetUmIncome
      .mockResolvedValueOnce(makeIncomePage(1000, SCAN_START + 1000))
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
    mockPapiGetCmIncome.mockResolvedValue([])

    const adapter = makePM()
    await expect(adapter.discoverTradedSymbols()).rejects.toThrow('discoverTradedSymbols failed')
  })

  it('collects symbols from both UM and CM endpoints in parallel', async () => {
    mockPapiGetUmIncome.mockResolvedValue([makeIncomeRow('BTCUSDT', SCAN_START + 1000)])
    mockPapiGetCmIncome.mockResolvedValue([makeIncomeRow('BTCUSD_PERP', SCAN_START + 2000)])

    const adapter = makePM()
    const symbols = await adapter.discoverTradedSymbols()

    const names = symbols.map(s => s.rawSymbol)
    expect(names).toContain('BTCUSDT')
    expect(names).toContain('BTCUSD_PERP')
  })

  it('stops after single page when page has fewer than 1000 rows', async () => {
    mockPapiGetUmIncome.mockResolvedValue(makeIncomePage(42, SCAN_START + 1000))
    mockPapiGetCmIncome.mockResolvedValue([])

    const adapter = makePM()
    await adapter.discoverTradedSymbols()

    expect(mockPapiGetUmIncome).toHaveBeenCalledTimes(1)
  })

  it('returns empty array when no income events exist', async () => {
    mockPapiGetUmIncome.mockResolvedValue([])
    mockPapiGetCmIncome.mockResolvedValue([])

    const adapter = makePM()
    const symbols = await adapter.discoverTradedSymbols()

    expect(symbols).toEqual([])
  })

  it('maps income events to correct week indices', async () => {
    const WEEK = 7 * DAY
    // Put one event in week 0 and one in week 5
    const week0Time = SCAN_START + 1000
    const week5Time = SCAN_START + 5 * WEEK + 1000

    mockPapiGetUmIncome.mockResolvedValue([
      makeIncomeRow('BTCUSDT', week0Time),
      makeIncomeRow('BTCUSDT', week5Time),
    ])
    mockPapiGetCmIncome.mockResolvedValue([])

    const adapter = makePM()
    const [sym] = await adapter.discoverTradedSymbols()

    // weekIndices = [0, 1, 2, 3, 4, 5] — all weeks up to and including max(5)
    expect(sym.rawSymbol).toBe('BTCUSDT')
    expect(sym.weekIndices).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('deduplicates symbols across UM and CM results', async () => {
    // A symbol could theoretically appear in both UM and CM income streams
    mockPapiGetUmIncome.mockResolvedValue([makeIncomeRow('BTCUSDT', SCAN_START + 1000)])
    mockPapiGetCmIncome.mockResolvedValue([makeIncomeRow('BTCUSDT', SCAN_START + 2000)])

    const adapter = makePM()
    const symbols = await adapter.discoverTradedSymbols()

    // Should appear once, not twice
    const btcSymbols = symbols.filter(s => s.rawSymbol === 'BTCUSDT')
    expect(btcSymbols).toHaveLength(1)
  })

  it('handles 3 pages of pagination correctly', async () => {
    const t1 = SCAN_START + 1_000_000
    const t2 = SCAN_START + 2_000_000
    const t3 = SCAN_START + 3_000_000

    mockPapiGetUmIncome
      .mockResolvedValueOnce(makeIncomePage(1000, t1, 'BTCUSDT'))
      .mockResolvedValueOnce(makeIncomePage(1000, t2, 'ETHUSDT'))
      .mockResolvedValueOnce(makeIncomePage(7,    t3, 'SOLUSDT'))
    mockPapiGetCmIncome.mockResolvedValue([])

    const adapter = makePM()
    const symbols = await adapter.discoverTradedSymbols()

    expect(mockPapiGetUmIncome).toHaveBeenCalledTimes(3)
    const names = symbols.map(s => s.rawSymbol)
    expect(names).toContain('SOLUSDT')  // only on page 3
  })

  it('cursor advances correctly between pages (startTime of next call = last time + 1)', async () => {
    const lastTimeOnPage1 = SCAN_START + 999_999
    const page1 = makeIncomePage(1000, SCAN_START + 1000, 'BTCUSDT')
    page1[999] = { symbol: 'BTCUSDT', time: lastTimeOnPage1 }

    mockPapiGetUmIncome
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce([])
    mockPapiGetCmIncome.mockResolvedValue([])

    const adapter = makePM()
    await adapter.discoverTradedSymbols()

    const secondCallArgs = mockPapiGetUmIncome.mock.calls[1][0]
    expect(secondCallArgs.startTime).toBe(lastTimeOnPage1 + 1)
  })
})

// ---------------------------------------------------------------------------
// Regular account — discoverTradedSymbols() uses 6×30-day windows
// ---------------------------------------------------------------------------

describe('BinanceAdapter.discoverTradedSymbols() — regular account', () => {
  it('fetches exactly 6 windows of 30 days each', async () => {
    mockFapiPrivateGetIncome.mockResolvedValue([])

    const adapter = makeRegular()
    await adapter.discoverTradedSymbols()

    expect(mockFapiPrivateGetIncome).toHaveBeenCalledTimes(6)
  })

  it('each window call uses incomeType REALIZED_PNL with correct limit', async () => {
    mockFapiPrivateGetIncome.mockResolvedValue([])

    const adapter = makeRegular()
    await adapter.discoverTradedSymbols()

    for (const call of mockFapiPrivateGetIncome.mock.calls) {
      expect(call[0].incomeType).toBe('REALIZED_PNL')
      expect(call[0].limit).toBe(1000)
    }
  })

  it('regression bug #2: error in any window propagates instead of silently returning empty', async () => {
    mockFapiPrivateGetIncome
      .mockResolvedValueOnce([makeIncomeRow('BTCUSDT', SCAN_START + 1000)])
      .mockRejectedValueOnce(new Error('API error'))

    const adapter = makeRegular()
    await expect(adapter.discoverTradedSymbols()).rejects.toThrow('discoverTradedSymbols failed')
  })

  it('collects symbols across all 6 windows', async () => {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'BNBUSDT', 'XRPUSDT']
    const WINDOW_30 = 30 * DAY
    mockFapiPrivateGetIncome.mockImplementation(async ({ startTime }) => {
      const idx = Math.floor((startTime - SCAN_START) / WINDOW_30)
      const sym = symbols[idx]
      return sym ? [makeIncomeRow(sym, startTime + 1000)] : []
    })

    const adapter = makeRegular()
    const discovered = await adapter.discoverTradedSymbols()

    const names = discovered.map(s => s.rawSymbol)
    for (const sym of symbols) {
      expect(names).toContain(sym)
    }
  })

  // ── regression bug #4 ──────────────────────────────────────────────────────
  // High-volume regular accounts (e.g. Korean Binance: ~90 closing fills/day)
  // generate >1000 REALIZED_PNL income events in a single 30-day window.
  // Without within-window pagination, the first 1000 events fill the request,
  // symbols active only AFTER those 1000 events are silently dropped, and the
  // sync job completes successfully with 0 failed_items — invisible data loss.
  //
  // Root cause confirmed in production: Korean account had 161 traded symbols
  // in May 2026 CSV; discoverTradedSymbols() found only 23 (86% miss rate).
  it('regression bug #4: window returning exactly 1000 rows triggers within-window pagination', async () => {
    const WINDOW_30 = 30 * DAY
    // Window 0: page 1 returns 1000 rows for BTCUSDT (full page → must fetch page 2)
    //           page 2 returns 1 row for ETHUSDT (appeared late in the window)
    // Windows 1–5: return empty
    const page1 = makeIncomePage(1000, SCAN_START + 1_000, 'BTCUSDT')
    const lastTimeW0 = page1[page1.length - 1].time as number
    const page2 = [makeIncomeRow('ETHUSDT', lastTimeW0 + 1_000)]

    mockFapiPrivateGetIncome.mockImplementation(async ({ startTime, endTime }) => {
      const inW0 = startTime >= SCAN_START && startTime < SCAN_START + WINDOW_30
      if (!inW0) return []
      // First call: startTime == SCAN_START → full page
      if (startTime === SCAN_START) return page1
      // Second call: startTime == lastTime+1 → tail of window
      return page2
    })

    const adapter = makeRegular()
    const discovered = await adapter.discoverTradedSymbols()

    const names = discovered.map(s => s.rawSymbol)
    // ETHUSDT appeared on page 2 of window 0 — must be discovered
    expect(names).toContain('ETHUSDT')
    // At least 7 calls: 1 extra for the paginated window + 5 empty windows
    expect(mockFapiPrivateGetIncome.mock.calls.length).toBeGreaterThanOrEqual(7)
  })

  it('regression bug #4b: within-window pagination cursor advances by time, not count', async () => {
    // Verifies that the startTime of the second page call equals lastRow.time + 1,
    // not a fixed offset — prevents duplicate rows at window boundaries.
    const page1 = makeIncomePage(1000, SCAN_START + 500_000, 'XRPUSDT')
    const lastTime = page1[page1.length - 1].time as number

    mockFapiPrivateGetIncome
      .mockResolvedValueOnce(page1) // window 0 page 1 (full)
      .mockResolvedValue([])        // page 2 + remaining windows

    const adapter = makeRegular()
    await adapter.discoverTradedSymbols()

    const calls = mockFapiPrivateGetIncome.mock.calls
    // Second call for window 0 must use startTime = lastTime + 1
    const page2Call = calls.find(c => c[0].startTime === lastTime + 1)
    expect(page2Call).toBeDefined()
  })
})
