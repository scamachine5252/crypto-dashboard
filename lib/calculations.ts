import type { DailyPnLEntry, Metrics, Trade, ChartDataPoint, Timeframe, Period, DateRange, HistoryFilterState, MetricTimeSeries } from './types'

const INITIAL_CAPITAL = 6_800_000
const RISK_FREE_DAILY = 0.05 / 252

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
export function calculateMetrics(daily: DailyPnLEntry[], trades: Trade[]): Metrics {
  if (daily.length === 0) {
    return {
      sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, maxDrawdownPct: 0,
      winRate: 0, profitFactor: 0, cagr: 0, annualYield: 0,
      riskReward: 0, averageWin: 0, averageLoss: 0,
      totalFees: 0, totalPnl: 0, totalTrades: 0,
    }
  }

  // Aggregate by date
  const byDate = new Map<string, number>()
  for (const e of daily) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.pnl)
  }
  const sortedDates = [...byDate.keys()].sort()
  const dailyPnls = sortedDates.map((d) => byDate.get(d)!)

  // Daily returns (% of initial capital)
  const returns = dailyPnls.map((p) => p / INITIAL_CAPITAL)
  const n = returns.length
  const mean = returns.reduce((a, b) => a + b, 0) / n
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)

  // Sharpe
  const sharpeRatio = std > 0 ? ((mean - RISK_FREE_DAILY) / std) * Math.sqrt(252) : 0

  // Sortino
  const downReturns = returns.filter((r) => r < RISK_FREE_DAILY)
  const downsideVar =
    downReturns.length > 0
      ? downReturns.reduce((s, r) => s + (r - RISK_FREE_DAILY) ** 2, 0) / n
      : 0
  const downsideStd = Math.sqrt(downsideVar)
  const sortinoRatio = downsideStd > 0 ? ((mean - RISK_FREE_DAILY) / downsideStd) * Math.sqrt(252) : 0

  // Max drawdown
  let peak = INITIAL_CAPITAL
  let equity = INITIAL_CAPITAL
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  for (const d of sortedDates) {
    equity += byDate.get(d)!
    if (equity > peak) peak = equity
    const dd = peak - equity
    const ddPct = (dd / peak) * 100
    if (dd > maxDrawdown) { maxDrawdown = dd; maxDrawdownPct = ddPct }
  }

  // Total PnL & CAGR
  const totalPnl = dailyPnls.reduce((a, b) => a + b, 0)
  const years = sortedDates.length / 365
  const cagr = years > 0 ? (Math.pow((INITIAL_CAPITAL + totalPnl) / INITIAL_CAPITAL, 1 / years) - 1) * 100 : 0
  const annualYield = years > 0 ? (totalPnl / INITIAL_CAPITAL / years) * 100 : 0

  // Trade metrics
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0
  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0
  const riskReward = averageLoss > 0 ? averageWin / averageLoss : 0
  const totalFees = trades.reduce((s, t) => s + t.fee, 0)

  const r2 = (v: number) => Math.round(v * 100) / 100

  return {
    sharpeRatio: r2(sharpeRatio),
    sortinoRatio: r2(sortinoRatio),
    maxDrawdown: Math.round(maxDrawdown),
    maxDrawdownPct: r2(maxDrawdownPct),
    winRate: r2(winRate),
    profitFactor: r2(profitFactor),
    cagr: r2(cagr),
    annualYield: r2(annualYield),
    riskReward: r2(riskReward),
    averageWin: Math.round(averageWin),
    averageLoss: Math.round(averageLoss),
    totalFees: Math.round(totalFees),
    totalPnl: Math.round(totalPnl),
    totalTrades: trades.length,
  }
}

// ---------------------------------------------------------------------------
// Chart aggregation
// ---------------------------------------------------------------------------
export function aggregateChartData(daily: DailyPnLEntry[], timeframe: Timeframe): ChartDataPoint[] {
  const byDate = new Map<string, number>()
  for (const e of daily) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.pnl)
  }
  const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  if (timeframe === 'daily') {
    const last90 = sorted.slice(-90)
    const startCum = sorted.slice(0, sorted.length - 90).reduce((s, [, p]) => s + p, 0)
    let cum = startCum
    return last90.map(([date, pnl]) => {
      cum += pnl
      const d = new Date(date + 'T00:00:00Z')
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return { period: label, pnl, cumulativePnl: cum }
    })
  }

  if (timeframe === 'weekly') {
    const weekMap = new Map<string, number>()
    for (const [date, pnl] of sorted) {
      const d = new Date(date + 'T00:00:00Z')
      const week = getWeekNumber(d)
      const key = `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
      weekMap.set(key, (weekMap.get(key) ?? 0) + pnl)
    }
    const weeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    let cum = 0
    return weeks.map(([label, pnl]) => {
      cum += pnl
      return { period: label, pnl, cumulativePnl: cum }
    })
  }

  // Monthly
  const monthMap = new Map<string, number>()
  for (const [date, pnl] of sorted) {
    const key = date.slice(0, 7)
    monthMap.set(key, (monthMap.get(key) ?? 0) + pnl)
  }
  const months = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  let cum = 0
  return months.map(([key, pnl]) => {
    cum += pnl
    const [yr, mo] = key.split('-')
    const label = new Date(parseInt(yr), parseInt(mo) - 1, 1).toLocaleDateString('en-US', {
      month: 'short',
      year: '2-digit',
    })
    return { period: label, pnl, cumulativePnl: cum }
  })
}

function getWeekNumber(d: Date): number {
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - jan1.getTime()) / 86_400_000) + jan1.getUTCDay() + 1) / 7)
}

// ---------------------------------------------------------------------------
// Period → DateRange
// ---------------------------------------------------------------------------
export function resolveDateRange(period: Period, today?: string): DateRange {
  const end = today ?? new Date().toISOString().slice(0, 10)
  const endDate = new Date(end + 'T00:00:00Z')

  if (period === '1D') {
    return { start: end, end }
  }
  if (period === '1W') {
    const start = new Date(endDate)
    start.setUTCDate(start.getUTCDate() - 6)
    return { start: start.toISOString().slice(0, 10), end }
  }
  if (period === '1M') {
    const start = new Date(endDate)
    start.setUTCMonth(start.getUTCMonth() - 1)
    return { start: start.toISOString().slice(0, 10), end }
  }
  if (period === '1Y') {
    const start = new Date(endDate)
    start.setUTCFullYear(start.getUTCFullYear() - 1)
    return { start: start.toISOString().slice(0, 10), end }
  }
  // manual: return a wide default range covering 2025 mock data
  return { start: '2025-01-01', end }
}

// ---------------------------------------------------------------------------
// Date range filter for DailyPnLEntry
// ---------------------------------------------------------------------------
export function filterByDateRange(entries: DailyPnLEntry[], dateRange: DateRange): DailyPnLEntry[] {
  return entries.filter((e) => e.date >= dateRange.start && e.date <= dateRange.end)
}

// ---------------------------------------------------------------------------
// Normalize equity curve to index 0 at period start (for overlay comparisons)
// ---------------------------------------------------------------------------
export function normalizeEquityCurve(daily: DailyPnLEntry[], subAccountId: string): ChartDataPoint[] {
  const entries = daily
    .filter((e) => e.subAccountId === subAccountId)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (entries.length === 0) return []

  let cum = 0
  return entries.map((e, i) => {
    if (i === 0) {
      // First point starts at 0; pnl already happened
      cum = 0
      const d = new Date(e.date + 'T00:00:00Z')
      return {
        period: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        pnl: e.pnl,
        cumulativePnl: 0,
      }
    }
    cum += entries[i - 1].pnl
    const d = new Date(e.date + 'T00:00:00Z')
    return {
      period: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      pnl: e.pnl,
      cumulativePnl: cum,
    }
  })
}

// ---------------------------------------------------------------------------
// Advanced trade filtering (for Trading History page)
// ---------------------------------------------------------------------------
export function filterTradesAdvanced(trades: Trade[], filter: HistoryFilterState): Trade[] {
  return trades.filter((t) => {
    if (filter.exchangeId !== 'all' && t.exchangeId !== filter.exchangeId) return false
    if (filter.subAccountId !== 'all' && t.subAccountId !== filter.subAccountId) return false
    if (filter.symbol && !t.symbol.toUpperCase().includes(filter.symbol.toUpperCase())) return false
    if (filter.tradeType !== 'all' && t.tradeType !== filter.tradeType) return false
    if (filter.side !== 'all' && t.side !== filter.side) return false
    const closed = t.closedAt.slice(0, 10)
    if (closed < filter.dateRange.start || closed > filter.dateRange.end) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Summarize filtered trades (for History page footer)
// ---------------------------------------------------------------------------
export function summarizeFilteredTrades(trades: Trade[]): { totalPnl: number; totalFees: number; count: number } {
  return {
    totalPnl: trades.reduce((s, t) => s + t.pnl, 0),
    totalFees: trades.reduce((s, t) => s + t.fee, 0),
    count: trades.length,
  }
}

// ---------------------------------------------------------------------------
// Metric time series — one snapshot per time bucket per sub-account
// Used by the Performance Indicators page chart
// ---------------------------------------------------------------------------
export function buildMetricTimeSeries(
  allDaily: DailyPnLEntry[],
  allTrades: Trade[],
  subAccountIds: string[],
  timeframe: 'weekly' | 'monthly',
  metric: keyof Metrics,
  dateRange: DateRange,
): MetricTimeSeries[] {
  const daily = filterByDateRange(allDaily, dateRange)
  const trades = allTrades.filter((t) => {
    const d = t.closedAt.slice(0, 10)
    return d >= dateRange.start && d <= dateRange.end
  })

  const getBucketKey = (date: string): string => {
    if (timeframe === 'weekly') {
      const d = new Date(date + 'T00:00:00Z')
      const week = getWeekNumber(d)
      return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
    }
    return date.slice(0, 7) // YYYY-MM
  }

  const getBucketLabel = (key: string): string => {
    if (timeframe === 'weekly') return key
    const [yr, mo] = key.split('-')
    return new Date(parseInt(yr), parseInt(mo) - 1, 1).toLocaleDateString('en-US', {
      month: 'short',
      year: '2-digit',
    })
  }

  // Ordered unique bucket keys from filtered data
  const bucketSet = new Set<string>()
  for (const e of daily) bucketSet.add(getBucketKey(e.date))
  const buckets = [...bucketSet].sort()

  if (buckets.length === 0) return []

  return buckets.map((bucket) => {
    const snapshot: MetricTimeSeries = { date: getBucketLabel(bucket) }

    for (const saId of subAccountIds) {
      const saDaily = daily.filter(
        (e) => e.subAccountId === saId && getBucketKey(e.date) === bucket,
      )
      const saTrades = trades.filter(
        (t) => t.subAccountId === saId && getBucketKey(t.closedAt.slice(0, 10)) === bucket,
      )
      const m = calculateMetrics(saDaily, saTrades)
      snapshot[saId] = m[metric] as number
    }

    return snapshot
  })
}
