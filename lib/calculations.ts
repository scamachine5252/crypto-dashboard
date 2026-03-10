import type { DailyPnLEntry, Metrics, Trade, ChartDataPoint, Timeframe } from './types'

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
