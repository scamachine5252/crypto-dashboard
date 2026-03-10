import {
  calculateMetrics,
  aggregateChartData,
  resolveDateRange,
  filterByDateRange,
  normalizeEquityCurve,
  filterTradesAdvanced,
  summarizeFilteredTrades,
  buildMetricTimeSeries,
  calculateFuturesMetrics,
} from '../calculations'
import type { DailyPnLEntry, Trade, HistoryFilterState } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDaily(days: number, pnl: number, subAccountId = 'sub-a', exchangeId: 'binance' = 'binance'): DailyPnLEntry[] {
  const entries: DailyPnLEntry[] = []
  let cum = 0
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)
    cum += pnl
    entries.push({ date, pnl, cumulativePnl: cum, exchangeId, subAccountId })
  }
  return entries
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
    subAccountId: 'sub-a',
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

// ---------------------------------------------------------------------------
// calculateMetrics
// ---------------------------------------------------------------------------
describe('calculateMetrics', () => {
  it('returns zero metrics for empty input', () => {
    const result = calculateMetrics([], [])
    expect(result.sharpeRatio).toBe(0)
    expect(result.totalPnl).toBe(0)
    expect(result.totalTrades).toBe(0)
    expect(result.winRate).toBe(0)
    expect(result.maxDrawdown).toBe(0)
    expect(result.profitFactor).toBe(0)
  })

  it('calculates positive Sharpe for consistently profitable days (above risk-free)', () => {
    // Need daily PnL > INITIAL_CAPITAL * (0.05/252) ≈ 1350 to beat risk-free
    const daily = makeDaily(252, 5000)
    const result = calculateMetrics(daily, [])
    expect(result.sharpeRatio).toBeGreaterThan(0)
    expect(result.totalPnl).toBe(1260000)
  })

  it('calculates negative-leaning metrics for losing days', () => {
    const daily = makeDaily(100, -500)
    const result = calculateMetrics(daily, [])
    expect(result.totalPnl).toBe(-50000)
    expect(result.maxDrawdown).toBeGreaterThan(0)
  })

  it('handles single-day data without division by zero', () => {
    const daily = makeDaily(1, 1000)
    const result = calculateMetrics(daily, [])
    expect(result.totalPnl).toBe(1000)
    expect(Number.isFinite(result.sharpeRatio)).toBe(true)
    expect(Number.isFinite(result.cagr)).toBe(true)
  })

  it('calculates win rate correctly', () => {
    const trades = [
      makeTrade({ id: 't1', pnl: 100 }),
      makeTrade({ id: 't2', pnl: -50 }),
      makeTrade({ id: 't3', pnl: 200 }),
      makeTrade({ id: 't4', pnl: -30 }),
    ]
    const result = calculateMetrics(makeDaily(10, 100), trades)
    expect(result.winRate).toBe(50)
    expect(result.totalTrades).toBe(4)
  })

  it('calculates profit factor correctly', () => {
    const trades = [
      makeTrade({ id: 't1', pnl: 300 }),
      makeTrade({ id: 't2', pnl: -100 }),
    ]
    const result = calculateMetrics(makeDaily(10, 100), trades)
    expect(result.profitFactor).toBe(3)
  })

  it('returns profitFactor 0 when no losing trades', () => {
    const trades = [makeTrade({ id: 't1', pnl: 500 })]
    const result = calculateMetrics(makeDaily(10, 100), trades)
    expect(result.profitFactor).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// aggregateChartData
// ---------------------------------------------------------------------------
describe('aggregateChartData', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateChartData([], 'daily')).toEqual([])
    expect(aggregateChartData([], 'weekly')).toEqual([])
    expect(aggregateChartData([], 'monthly')).toEqual([])
  })

  it('returns last 90 days for daily timeframe', () => {
    const daily = makeDaily(120, 100)
    const result = aggregateChartData(daily, 'daily')
    expect(result.length).toBe(90)
  })

  it('daily: cumulative reflects full history not just 90-day window', () => {
    const daily = makeDaily(120, 100)
    const result = aggregateChartData(daily, 'daily')
    // 120 days × 100 = 12000 total; last data point should show full cumulative
    expect(result[result.length - 1].cumulativePnl).toBe(12000)
  })

  it('aggregates weekly correctly', () => {
    // Jan 1-7 2025 spans exactly 2 ISO weeks (W1: Jan 1-4, W2: Jan 5-7)
    const daily = makeDaily(7, 100)
    const result = aggregateChartData(daily, 'weekly')
    expect(result.length).toBe(2)
    expect(result[result.length - 1].cumulativePnl).toBe(700)
  })

  it('aggregates monthly correctly', () => {
    const daily = makeDaily(31, 100)
    const result = aggregateChartData(daily, 'monthly')
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('handles single entry', () => {
    const daily = makeDaily(1, 500)
    const dailyResult = aggregateChartData(daily, 'daily')
    expect(dailyResult.length).toBe(1)
    expect(dailyResult[0].pnl).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// resolveDateRange
// ---------------------------------------------------------------------------
describe('resolveDateRange', () => {
  const TODAY = '2025-06-15'

  it('returns a 1-day range for 1D', () => {
    const { start, end } = resolveDateRange('1D', TODAY)
    expect(end).toBe(TODAY)
    expect(start).toBe(TODAY)
  })

  it('returns a 7-day range for 1W', () => {
    const { start, end } = resolveDateRange('1W', TODAY)
    expect(end).toBe(TODAY)
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000
    expect(days).toBe(6)
  })

  it('returns a ~30-day range for 1M', () => {
    const { start, end } = resolveDateRange('1M', TODAY)
    expect(end).toBe(TODAY)
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(28)
    expect(days).toBeLessThanOrEqual(31)
  })

  it('returns a ~365-day range for 1Y', () => {
    const { start, end } = resolveDateRange('1Y', TODAY)
    expect(end).toBe(TODAY)
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(364)
    expect(days).toBeLessThanOrEqual(366)
  })

  it('returns full date range for manual (all data)', () => {
    const { start, end } = resolveDateRange('manual', TODAY)
    expect(end).toBe(TODAY)
    expect(start).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// filterByDateRange
// ---------------------------------------------------------------------------
describe('filterByDateRange', () => {
  it('returns entries within range', () => {
    const daily = makeDaily(30, 100)
    const result = filterByDateRange(daily, { start: '2025-01-05', end: '2025-01-10' })
    expect(result.length).toBe(6)
    expect(result[0].date).toBe('2025-01-05')
    expect(result[result.length - 1].date).toBe('2025-01-10')
  })

  it('returns empty for out-of-range', () => {
    const daily = makeDaily(10, 100)
    const result = filterByDateRange(daily, { start: '2026-01-01', end: '2026-01-10' })
    expect(result.length).toBe(0)
  })

  it('returns all entries when range covers everything', () => {
    const daily = makeDaily(30, 100)
    const result = filterByDateRange(daily, { start: '2025-01-01', end: '2025-12-31' })
    expect(result.length).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// normalizeEquityCurve
// ---------------------------------------------------------------------------
describe('normalizeEquityCurve', () => {
  it('returns empty array for empty input', () => {
    expect(normalizeEquityCurve([], 'sub-a')).toEqual([])
  })

  it('first data point cumulativePnl is 0 (indexed to 0)', () => {
    const daily = makeDaily(10, 100, 'sub-a')
    const result = normalizeEquityCurve(daily, 'sub-a')
    expect(result[0].cumulativePnl).toBe(0)
  })

  it('last point reflects total relative gain', () => {
    const daily = makeDaily(5, 200, 'sub-a')
    const result = normalizeEquityCurve(daily, 'sub-a')
    // 5 days × 200/day = 1000 total, first day starts at 0
    expect(result[result.length - 1].cumulativePnl).toBe(800)
  })
})

// ---------------------------------------------------------------------------
// filterTradesAdvanced
// ---------------------------------------------------------------------------
describe('filterTradesAdvanced', () => {
  const baseTrades: Trade[] = [
    makeTrade({ id: 't1', symbol: 'BTC/USDT', side: 'long', tradeType: 'spot', exchangeId: 'binance', closedAt: '2025-03-01T00:00:00.000Z' }),
    makeTrade({ id: 't2', symbol: 'ETH/USDT', side: 'short', tradeType: 'futures', exchangeId: 'bybit', closedAt: '2025-04-01T00:00:00.000Z' }),
    makeTrade({ id: 't3', symbol: 'BTC/USDT', side: 'long', tradeType: 'options', exchangeId: 'okx', closedAt: '2025-05-01T00:00:00.000Z' }),
  ]

  const baseFilter: HistoryFilterState = {
    exchangeId: 'all',
    subAccountId: 'all',
    symbol: '',
    tradeType: 'all',
    side: 'all',
    dateRange: { start: '2025-01-01', end: '2025-12-31' },
    page: 1,
  }

  it('returns all trades when no filters applied', () => {
    expect(filterTradesAdvanced(baseTrades, baseFilter).length).toBe(3)
  })

  it('filters by exchange', () => {
    const result = filterTradesAdvanced(baseTrades, { ...baseFilter, exchangeId: 'binance' })
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('t1')
  })

  it('filters by symbol substring', () => {
    const result = filterTradesAdvanced(baseTrades, { ...baseFilter, symbol: 'BTC' })
    expect(result.length).toBe(2)
  })

  it('filters by trade type', () => {
    const result = filterTradesAdvanced(baseTrades, { ...baseFilter, tradeType: 'futures' })
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('t2')
  })

  it('filters by side', () => {
    const result = filterTradesAdvanced(baseTrades, { ...baseFilter, side: 'short' })
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('t2')
  })

  it('filters by date range', () => {
    const result = filterTradesAdvanced(baseTrades, {
      ...baseFilter,
      dateRange: { start: '2025-03-01', end: '2025-03-31' },
    })
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('t1')
  })

  it('returns empty for impossible filter combination', () => {
    const result = filterTradesAdvanced(baseTrades, {
      ...baseFilter,
      exchangeId: 'binance',
      side: 'short',
    })
    expect(result.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// summarizeFilteredTrades
// ---------------------------------------------------------------------------
describe('summarizeFilteredTrades', () => {
  it('returns zeros for empty array', () => {
    const result = summarizeFilteredTrades([])
    expect(result.totalPnl).toBe(0)
    expect(result.totalFees).toBe(0)
    expect(result.count).toBe(0)
  })

  it('sums pnl and fees correctly', () => {
    const trades = [
      makeTrade({ id: 't1', pnl: 300, fee: 10 }),
      makeTrade({ id: 't2', pnl: -100, fee: 5 }),
    ]
    const result = summarizeFilteredTrades(trades)
    expect(result.totalPnl).toBe(200)
    expect(result.totalFees).toBe(15)
    expect(result.count).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// buildMetricTimeSeries
// ---------------------------------------------------------------------------
describe('buildMetricTimeSeries', () => {
  const DR = { start: '2025-01-01', end: '2025-12-31' }

  it('returns empty array for empty daily input', () => {
    const result = buildMetricTimeSeries([], [], ['sub-a'], 'monthly', 'totalPnl', DR)
    expect(result).toEqual([])
  })

  it('returns one entry per monthly bucket', () => {
    // 3 full months: Jan + Feb + Mar
    const jan = makeDaily(31, 100, 'sub-a')
    const feb = makeDaily(28, 100, 'sub-a').map((e) => ({
      ...e,
      date: new Date(Date.UTC(2025, 1, parseInt(e.date.slice(8)) )).toISOString().slice(0, 10),
    }))
    const daily = [...jan, ...feb]
    const result = buildMetricTimeSeries(daily, [], ['sub-a'], 'monthly', 'totalPnl', { start: '2025-01-01', end: '2025-02-28' })
    expect(result.length).toBe(2)
  })

  it('each snapshot contains the sub-account key with a numeric value', () => {
    const daily = makeDaily(31, 200, 'sub-a')
    const result = buildMetricTimeSeries(daily, [], ['sub-a'], 'monthly', 'totalPnl', { start: '2025-01-01', end: '2025-01-31' })
    expect(result.length).toBe(1)
    expect(typeof result[0]['sub-a']).toBe('number')
  })

  it('totalPnl bucket value equals sum of period daily pnl', () => {
    const daily = makeDaily(31, 100, 'sub-a')  // Jan: 31 days × 100 = 3100
    const result = buildMetricTimeSeries(daily, [], ['sub-a'], 'monthly', 'totalPnl', { start: '2025-01-01', end: '2025-01-31' })
    expect(result[0]['sub-a']).toBe(3100)
  })

  it('handles multiple sub-accounts in the same snapshot', () => {
    const dailyA = makeDaily(31, 100, 'sub-a')
    const dailyB = makeDaily(31, 200, 'sub-b')
    const result = buildMetricTimeSeries([...dailyA, ...dailyB], [], ['sub-a', 'sub-b'], 'monthly', 'totalPnl', { start: '2025-01-01', end: '2025-01-31' })
    expect(result[0]['sub-a']).toBe(3100)
    expect(result[0]['sub-b']).toBe(6200)
  })

  it('respects dateRange (excludes data outside range)', () => {
    const daily = makeDaily(60, 100, 'sub-a')  // Jan + Feb
    const result = buildMetricTimeSeries(daily, [], ['sub-a'], 'monthly', 'totalPnl', { start: '2025-01-01', end: '2025-01-31' })
    expect(result.length).toBe(1)  // Only Jan bucket
  })

  it('weekly timeframe produces more buckets than monthly for same data', () => {
    const daily = makeDaily(60, 100, 'sub-a')
    const monthly = buildMetricTimeSeries(daily, [], ['sub-a'], 'monthly', 'totalPnl', { start: '2025-01-01', end: '2025-03-01' })
    const weekly  = buildMetricTimeSeries(daily, [], ['sub-a'], 'weekly',  'totalPnl', { start: '2025-01-01', end: '2025-03-01' })
    expect(weekly.length).toBeGreaterThan(monthly.length)
  })

  it('winRate is between 0 and 100 for period with trades', () => {
    const daily = makeDaily(31, 100, 'sub-a')
    const trades = [
      makeTrade({ id: 't1', subAccountId: 'sub-a', pnl: 200, closedAt: '2025-01-15T12:00:00.000Z' }),
      makeTrade({ id: 't2', subAccountId: 'sub-a', pnl: -50, closedAt: '2025-01-20T12:00:00.000Z' }),
    ]
    const result = buildMetricTimeSeries(daily, trades, ['sub-a'], 'monthly', 'winRate', { start: '2025-01-01', end: '2025-01-31' })
    const val = result[0]['sub-a'] as number
    expect(val).toBeGreaterThanOrEqual(0)
    expect(val).toBeLessThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------
// calculateFuturesMetrics
// ---------------------------------------------------------------------------
describe('calculateFuturesMetrics', () => {
  it('returns zeros for empty trade array', () => {
    const r = calculateFuturesMetrics([])
    expect(r.totalFundingCost).toBe(0)
    expect(r.averageLeverage).toBe(0)
    expect(r.longShortRatio).toBe(0)
    expect(r.liquidationDistancePct).toBe(0)
    expect(r.overnightExposureCount).toBe(0)
  })

  it('sums fundingCost across futures trades only', () => {
    const trades = [
      makeTrade({ id: 't1', tradeType: 'futures', fundingCost: 100, leverage: 10 }),
      makeTrade({ id: 't2', tradeType: 'futures', fundingCost: 200, leverage: 10 }),
      makeTrade({ id: 't3', tradeType: 'spot',    fundingCost: 999, leverage: 1  }),
    ]
    const r = calculateFuturesMetrics(trades)
    expect(r.totalFundingCost).toBe(300)
  })

  it('averageLeverage uses only futures trades', () => {
    const trades = [
      makeTrade({ id: 't1', tradeType: 'futures', leverage: 10, fundingCost: 0 }),
      makeTrade({ id: 't2', tradeType: 'futures', leverage: 20, fundingCost: 0 }),
      makeTrade({ id: 't3', tradeType: 'spot',    leverage: 1,  fundingCost: 0 }),
    ]
    const r = calculateFuturesMetrics(trades)
    expect(r.averageLeverage).toBe(15)
  })

  it('longShortRatio is 100 when all futures are long', () => {
    const trades = [
      makeTrade({ id: 't1', tradeType: 'futures', side: 'long',  leverage: 5, fundingCost: 0 }),
      makeTrade({ id: 't2', tradeType: 'futures', side: 'long',  leverage: 5, fundingCost: 0 }),
    ]
    expect(calculateFuturesMetrics(trades).longShortRatio).toBe(100)
  })

  it('longShortRatio is 0 when all futures are short', () => {
    const trades = [
      makeTrade({ id: 't1', tradeType: 'futures', side: 'short', leverage: 5, fundingCost: 0 }),
    ]
    expect(calculateFuturesMetrics(trades).longShortRatio).toBe(0)
  })

  it('longShortRatio is 50 for equal long/short split', () => {
    const trades = [
      makeTrade({ id: 't1', tradeType: 'futures', side: 'long',  leverage: 10, fundingCost: 0 }),
      makeTrade({ id: 't2', tradeType: 'futures', side: 'short', leverage: 10, fundingCost: 0 }),
    ]
    expect(calculateFuturesMetrics(trades).longShortRatio).toBe(50)
  })

  it('liquidationDistancePct = 100/leverage for single trade', () => {
    const trades = [
      makeTrade({ id: 't1', tradeType: 'futures', leverage: 10, fundingCost: 0 }),
    ]
    expect(calculateFuturesMetrics(trades).liquidationDistancePct).toBe(10)
  })

  it('overnightExposureCount counts all trade types with isOvernight=true', () => {
    const trades = [
      makeTrade({ id: 't1', tradeType: 'spot',    isOvernight: true  }),
      makeTrade({ id: 't2', tradeType: 'futures', isOvernight: true,  leverage: 5, fundingCost: 0 }),
      makeTrade({ id: 't3', tradeType: 'futures', isOvernight: false, leverage: 5, fundingCost: 0 }),
    ]
    expect(calculateFuturesMetrics(trades).overnightExposureCount).toBe(2)
  })

  it('returns 0 averageLeverage when no futures trades exist', () => {
    const trades = [makeTrade({ id: 't1', tradeType: 'spot' })]
    expect(calculateFuturesMetrics(trades).averageLeverage).toBe(0)
  })
})
