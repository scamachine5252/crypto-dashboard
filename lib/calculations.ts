import type { DailyPnLEntry, Metrics, Trade, ChartDataPoint, Timeframe, Period, DateRange, HistoryFilterState, MetricTimeSeries, FuturesMetrics, ComparisonRow, AccountSnapshot, ExtendedMetrics, AccountMetricsRow } from './types'
import { EXCHANGES, INITIAL_USDT_BALANCE, INITIAL_TOKEN_BALANCE, ACCOUNT_PRIMARY_TOKEN, getAllDailyPnL, getAllTrades, getAllTransactions } from './mock-data'

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

// ---------------------------------------------------------------------------
// Futures-specific metrics
// ---------------------------------------------------------------------------
export function calculateFuturesMetrics(trades: Trade[]): FuturesMetrics {
  const futures = trades.filter((t) => t.tradeType === 'futures')

  if (futures.length === 0) {
    return {
      totalFundingCost: 0,
      averageLeverage: 0,
      longShortRatio: 0,
      liquidationDistancePct: 0,
      overnightExposureCount: trades.filter((t) => t.isOvernight).length,
    }
  }

  const totalFundingCost = futures.reduce((s, t) => s + t.fundingCost, 0)
  const averageLeverage = futures.reduce((s, t) => s + t.leverage, 0) / futures.length
  const longs = futures.filter((t) => t.side === 'long').length
  const longShortRatio = (longs / futures.length) * 100
  const liquidationDistancePct = futures.reduce((s, t) => s + 100 / t.leverage, 0) / futures.length
  const overnightExposureCount = trades.filter((t) => t.isOvernight).length

  const r1 = (v: number) => Math.round(v * 10) / 10

  return {
    totalFundingCost: Math.round(totalFundingCost),
    averageLeverage: r1(averageLeverage),
    longShortRatio: r1(longShortRatio),
    liquidationDistancePct: r1(liquidationDistancePct),
    overnightExposureCount,
  }
}

// ---------------------------------------------------------------------------
// buildOverlayData
// Normalizes multiple equity curves to a common baseline (0 at period start)
// so accounts of different absolute sizes can be compared on the same axis.
// ---------------------------------------------------------------------------
export function buildOverlayData(
  dailyPnL: DailyPnLEntry[],
  subAccountIds: string[],
  dateRange: DateRange,
): MetricTimeSeries[] {
  if (subAccountIds.length === 0 || dailyPnL.length === 0) return []

  // Filter to date range and sort ascending
  const inRange = dailyPnL
    .filter((e) => e.date >= dateRange.start && e.date <= dateRange.end)
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  if (inRange.length === 0) return []

  // Build unified date axis — every calendar day in the range
  const dates: string[] = []
  const cursor = new Date(dateRange.start + 'T00:00:00Z')
  const endMs = new Date(dateRange.end + 'T00:00:00Z').getTime()
  while (cursor.getTime() <= endMs) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  // For each account: build date → cumulativePnl lookup, find baseline
  type AccountData = { lookup: Map<string, number>; baseline: number }
  const accountMap = new Map<string, AccountData>()

  for (const id of subAccountIds) {
    const entries = inRange.filter((e) => e.subAccountId === id)
    if (entries.length === 0) continue  // omit accounts with no data in range

    const lookup = new Map<string, number>()
    entries.forEach((e) => lookup.set(e.date, e.cumulativePnl))

    // Baseline = cumulativePnl on the first date that has data for this account
    const firstDate = dates.find((d) => lookup.has(d))!
    const baseline = lookup.get(firstDate)!

    accountMap.set(id, { lookup, baseline })
  }

  if (accountMap.size === 0) return []

  // Assemble output — one row per date, carry forward last known value per account
  const result: MetricTimeSeries[] = []
  const lastKnown = new Map<string, number>()  // tracks last normalized value per account

  for (const date of dates) {
    const row: MetricTimeSeries = { date }

    for (const [id, { lookup, baseline }] of accountMap) {
      if (lookup.has(date)) {
        const normalized = lookup.get(date)! - baseline
        lastKnown.set(id, normalized)
        row[id] = normalized
      } else {
        // Carry forward; default to 0 if no prior value exists
        row[id] = lastKnown.get(id) ?? 0
      }
    }

    result.push(row)
  }

  return result
}

// ---------------------------------------------------------------------------
// buildComparisonRows
// Produces one ComparisonRow per active account, with metrics and deltas vs
// the first account (baseline). Order matches activeIds exactly.
// ---------------------------------------------------------------------------
export function buildComparisonRows(
  dailyPnL: DailyPnLEntry[],
  trades: Trade[],
  activeIds: string[],
  dateRange: DateRange,
): ComparisonRow[] {
  if (activeIds.length === 0) return []

  // Build id → name and id → exchangeId lookups from EXCHANGES config
  const nameMap = new Map<string, string>()
  const exchangeMap = new Map<string, string>()
  EXCHANGES.forEach((ex) => {
    ex.subAccounts.forEach((sa) => {
      nameMap.set(sa.id, sa.name)
      exchangeMap.set(sa.id, ex.id)
    })
  })

  // Compute metrics per account
  const metricsMap = new Map<string, Metrics>()
  for (const id of activeIds) {
    const accountDaily = filterByDateRange(
      dailyPnL.filter((e) => e.subAccountId === id),
      dateRange,
    )
    const accountTrades = trades.filter((t) => {
      if (t.subAccountId !== id) return false
      const d = t.closedAt.slice(0, 10)
      return d >= dateRange.start && d <= dateRange.end
    })
    metricsMap.set(id, calculateMetrics(accountDaily, accountTrades))
  }

  const baselineId = activeIds[0]
  const baseline = metricsMap.get(baselineId)!

  // Helper to compute delta or null for baseline
  function delta(id: string, key: keyof Metrics): number | null {
    if (id === baselineId) return null
    const m = metricsMap.get(id)!
    return m[key] - baseline[key]
  }

  return activeIds.map((id) => {
    const m = metricsMap.get(id)!
    return {
      subAccountId: id,
      exchangeId: (exchangeMap.get(id) ?? 'binance') as ComparisonRow['exchangeId'],
      name: nameMap.get(id) ?? id,
      sharpeRatio:    m.sharpeRatio,
      sortinoRatio:   m.sortinoRatio,
      maxDrawdown:    m.maxDrawdown,
      maxDrawdownPct: m.maxDrawdownPct,
      winRate:        m.winRate,
      profitFactor:   m.profitFactor,
      cagr:           m.cagr,
      annualYield:    m.annualYield,
      riskReward:     m.riskReward,
      averageWin:     m.averageWin,
      averageLoss:    m.averageLoss,
      totalFees:      m.totalFees,
      totalPnl:       m.totalPnl,
      totalTrades:    m.totalTrades,
      delta: {
        sharpeRatio:    delta(id, 'sharpeRatio'),
        sortinoRatio:   delta(id, 'sortinoRatio'),
        maxDrawdown:    delta(id, 'maxDrawdown'),
        maxDrawdownPct: delta(id, 'maxDrawdownPct'),
        winRate:        delta(id, 'winRate'),
        profitFactor:   delta(id, 'profitFactor'),
        cagr:           delta(id, 'cagr'),
        annualYield:    delta(id, 'annualYield'),
        riskReward:     delta(id, 'riskReward'),
        averageWin:     delta(id, 'averageWin'),
        averageLoss:    delta(id, 'averageLoss'),
        totalFees:      delta(id, 'totalFees'),
        totalPnl:       delta(id, 'totalPnl'),
        totalTrades:    delta(id, 'totalTrades'),
      },
      isBaseline: id === baselineId,
    }
  })
}

// ---------------------------------------------------------------------------
// buildAccountSnapshots
// Returns one AccountSnapshot per sub-account summarising the given period.
// ---------------------------------------------------------------------------
export function buildAccountSnapshots(dateRange: DateRange): AccountSnapshot[] {
  const daily = getAllDailyPnL()
  const trades = getAllTrades()

  // Price range midpoints for fallback avgPrice
  const PRICE_MID: Record<string, number> = {
    BTC: (38_000 + 72_000) / 2,
    ETH: (1_800 + 4_200) / 2,
    SOL: (60 + 220) / 2,
    BNB: (220 + 620) / 2,
    XRP: (0.45 + 1.50) / 2,
    AVAX: (18 + 65) / 2,
    DOGE: (0.07 + 0.28) / 2,
    MATIC: (0.50 + 2.10) / 2,
  }

  const snapshots: AccountSnapshot[] = []

  for (const ex of EXCHANGES) {
    for (const sa of ex.subAccounts) {
      const id = sa.id
      const token = ACCOUNT_PRIMARY_TOKEN[id]

      // PnL: sum daily entries in range
      const pnl = daily
        .filter((d) => d.subAccountId === id && d.date >= dateRange.start && d.date <= dateRange.end)
        .reduce((s, d) => s + d.pnl, 0)

      // Trades in range for this account
      const accountTrades = trades.filter(
        (t) => t.subAccountId === id
          && t.closedAt.slice(0, 10) >= dateRange.start
          && t.closedAt.slice(0, 10) <= dateRange.end,
      )

      // Fees: sum of all trade fees in period
      const fees = accountTrades.reduce((s, t) => s + t.fee, 0)

      const usdtOpen  = INITIAL_USDT_BALANCE[id]
      const usdtClose = usdtOpen + pnl
      const deltaUsdt = usdtClose - usdtOpen

      const tokenOpen  = INITIAL_TOKEN_BALANCE[id]
      const tokenClose = tokenOpen
      const deltaToken = 0

      // avgPrice: mean mid-price from trades for the primary token in the period
      const tokenTrades = accountTrades.filter((t) => t.symbol.startsWith(token + '/'))
      const avgPrice = tokenTrades.length > 0
        ? tokenTrades.reduce((s, t) => s + (t.entryPrice + t.exitPrice) / 2, 0) / tokenTrades.length
        : PRICE_MID[token] ?? 0

      snapshots.push({
        subAccountId: id,
        exchangeId: ex.id,
        accountName: sa.name,
        token,
        usdtOpen,
        usdtClose,
        deltaUsdt,
        tokenOpen,
        tokenClose,
        deltaToken,
        fees,
        avgPrice,
        pnl,
      })
    }
  }

  return snapshots
}

// ---------------------------------------------------------------------------
// buildUsdtBalanceTimeSeries
// Returns daily USDT balance for one sub-account: starts at initial balance,
// updated each day by daily PnL and any USDT transactions on that date.
// ---------------------------------------------------------------------------
export function buildUsdtBalanceTimeSeries(
  subAccountId: string,
  dateRange: DateRange,
): { date: string; value: number }[] {
  const daily = getAllDailyPnL()
  const transactions = getAllTransactions()

  // Build lookup: date → daily pnl
  const pnlByDate = new Map<string, number>()
  for (const d of daily) {
    if (d.subAccountId === subAccountId) pnlByDate.set(d.date, d.pnl)
  }

  // Build lookup: date → net USDT change from transactions
  const txByDate = new Map<string, number>()
  for (const t of transactions) {
    if (t.subAccountId !== subAccountId) continue
    const delta = t.type === 'deposit' ? t.usdtAmount : -t.usdtAmount
    txByDate.set(t.date, (txByDate.get(t.date) ?? 0) + delta)
  }

  const result: { date: string; value: number }[] = []
  let balance = INITIAL_USDT_BALANCE[subAccountId] ?? 0

  const cursor = new Date(dateRange.start + 'T00:00:00Z')
  const endMs  = new Date(dateRange.end   + 'T00:00:00Z').getTime()
  while (cursor.getTime() <= endMs) {
    const date = cursor.toISOString().slice(0, 10)
    balance += pnlByDate.get(date) ?? 0
    balance += txByDate.get(date) ?? 0
    result.push({ date, value: Math.round(balance) })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return result
}

// ---------------------------------------------------------------------------
// buildTokenBalanceTimeSeries
// Returns daily token balance for one sub-account: starts at initial token
// balance, updated only on transaction dates (trading PnL is in USD, not
// token units).
// ---------------------------------------------------------------------------
export function buildTokenBalanceTimeSeries(
  subAccountId: string,
  dateRange: DateRange,
): { date: string; value: number }[] {
  const transactions = getAllTransactions()

  // Build lookup: date → net token change
  const txByDate = new Map<string, number>()
  for (const t of transactions) {
    if (t.subAccountId !== subAccountId) continue
    const delta = t.type === 'deposit' ? t.tokenAmount : -t.tokenAmount
    txByDate.set(t.date, (txByDate.get(t.date) ?? 0) + delta)
  }

  const result: { date: string; value: number }[] = []
  let balance = INITIAL_TOKEN_BALANCE[subAccountId] ?? 0

  const cursor = new Date(dateRange.start + 'T00:00:00Z')
  const endMs  = new Date(dateRange.end   + 'T00:00:00Z').getTime()
  while (cursor.getTime() <= endMs) {
    const date = cursor.toISOString().slice(0, 10)
    balance += txByDate.get(date) ?? 0
    result.push({ date, value: Math.round(balance * 1_000_000) / 1_000_000 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return result
}

// ---------------------------------------------------------------------------
// calculateRecoveryFactor
// ---------------------------------------------------------------------------
export function calculateRecoveryFactor(totalPnl: number, maxDrawdown: number): number {
  if (maxDrawdown === 0) return 0
  return totalPnl / Math.abs(maxDrawdown)
}

// ---------------------------------------------------------------------------
// calculateAvgFeePerTrade
// ---------------------------------------------------------------------------
export function calculateAvgFeePerTrade(totalFees: number, totalTrades: number): number {
  if (totalTrades === 0) return 0
  return totalFees / totalTrades
}

// ---------------------------------------------------------------------------
// calculateFeesAsPctOfPnl
// ---------------------------------------------------------------------------
export function calculateFeesAsPctOfPnl(totalFees: number, totalPnl: number): number {
  if (totalPnl === 0) return 0
  return (totalFees / totalPnl) * 100
}

// ---------------------------------------------------------------------------
// buildPerAccountMetrics
// Returns one AccountMetricsRow per sub-account in activeIds, filtered by
// tradeType ('spot' | 'futures') and dateRange.
// ---------------------------------------------------------------------------
export function buildPerAccountMetrics(
  activeIds: string[],
  dateRange: DateRange,
  tradeType: 'spot' | 'futures',
): AccountMetricsRow[] {
  if (activeIds.length === 0) return []

  const allDaily  = getAllDailyPnL()
  const allTrades = getAllTrades()

  const rows: AccountMetricsRow[] = []

  for (const ex of EXCHANGES) {
    for (const sa of ex.subAccounts) {
      if (!activeIds.includes(sa.id)) continue

      const daily = allDaily.filter(
        (d) => d.subAccountId === sa.id && d.date >= dateRange.start && d.date <= dateRange.end,
      )

      const trades = allTrades.filter(
        (t) =>
          t.subAccountId === sa.id &&
          t.tradeType === tradeType &&
          t.closedAt.slice(0, 10) >= dateRange.start &&
          t.closedAt.slice(0, 10) <= dateRange.end,
      )

      const base = calculateMetrics(daily, trades)
      const fut  = calculateFuturesMetrics(trades)

      const extended: ExtendedMetrics = {
        ...base,
        recoveryFactor: calculateRecoveryFactor(base.totalPnl, base.maxDrawdown),
        avgFeePerTrade: calculateAvgFeePerTrade(base.totalFees, base.totalTrades),
        feesAsPctOfPnl: calculateFeesAsPctOfPnl(base.totalFees, base.totalPnl),
      }

      // Extras: additional derived values for futures execution / cost tabs
      const avgFundingPerTrade = base.totalTrades > 0
        ? fut.totalFundingCost / base.totalTrades
        : 0
      const avgHoldingMin = trades.length > 0
        ? trades.reduce((s, t) => s + t.durationMin, 0) / trades.length
        : 0
      const totalNotional = trades.reduce((s, t) => s + t.quantity * t.entryPrice, 0)

      rows.push({
        subAccountId: sa.id,
        exchangeId:   ex.id,
        accountName:  sa.name,
        metrics:      extended,
        futuresMetrics: fut,
        extras: {
          avgFundingPerTrade,
          avgHoldingMin,
          totalNotional,
          liquidationsCount: 0, // no liquidation data in mock
        },
      })
    }
  }

  return rows
}

// ---------------------------------------------------------------------------
// aggregateOverlayData
// Merges daily MetricTimeSeries points into weekly or monthly buckets by
// taking the LAST value in each bucket (end-of-period equity snapshot).
// ---------------------------------------------------------------------------
export function aggregateOverlayData(
  data: MetricTimeSeries[],
  timeframe: 'daily' | 'weekly' | 'monthly',
): MetricTimeSeries[] {
  if (data.length === 0) return []
  if (timeframe === 'daily') return data

  // For weekly: bucket relative to the first date (0, 7, 14, …) so 7 consecutive
  // days always form exactly one bucket regardless of ISO calendar week boundaries.
  const sorted = [...data].sort((a, b) => (a.date < b.date ? -1 : 1))
  const epochMs = new Date(sorted[0].date + 'T00:00:00Z').getTime()

  function bucketKey(date: string): string {
    if (timeframe === 'monthly') return date.slice(0, 7) // "YYYY-MM"
    // weekly: relative week index from first point
    const ms = new Date(date + 'T00:00:00Z').getTime()
    const weekIdx = Math.floor((ms - epochMs) / (7 * 24 * 60 * 60 * 1000))
    return String(weekIdx)
  }

  // Group points by bucket, keeping last point per bucket
  const buckets = new Map<string, MetricTimeSeries>()
  for (const point of sorted) {
    const key = bucketKey(point.date)
    buckets.set(key, point) // overwrite → last point wins
  }

  // Return in chronological order (sort by numeric week index or YYYY-MM string)
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      const na = Number(a), nb = Number(b)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a < b ? -1 : 1
    })
    .map(([, point]) => point)
}
