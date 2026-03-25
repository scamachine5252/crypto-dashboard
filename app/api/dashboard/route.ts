import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { FundSummary, DashboardMetrics, ChartDataPoint } from '@/lib/types'

function emptyMetrics(): DashboardMetrics {
  return { totalPnl: 0, totalFees: 0, totalTrades: 0, winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, cagr: 0, annualYield: 0, riskRewardRatio: 0 }
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0')

  const { data: accounts, error: accError } = await supabaseAdmin
    .from('accounts')
    .select('id, fund, exchange, account_name')

  if (accError) return NextResponse.json({ error: accError.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ funds: [], metrics: emptyMetrics(), chartData: [] })
  }

  const accountIds = (accounts as Array<{ id: string }>).map((a) => a.id)

  const { data: balances, error: balError } = await supabaseAdmin
    .from('balances')
    .select('account_id, usdt_balance, recorded_at')
    .in('account_id', accountIds)
    .is('token_symbol', null)
    .order('recorded_at', { ascending: false })

  if (balError) return NextResponse.json({ error: balError.message }, { status: 500 })

  // Latest balance per account
  const latestBalance: Record<string, number> = {}
  for (const row of ((balances ?? []) as Array<{ account_id: string; usdt_balance: number; recorded_at: string }>)) {
    if (!(row.account_id in latestBalance)) {
      latestBalance[row.account_id] = Number(row.usdt_balance)
    }
  }

  const sinceDate = new Date(since).toISOString()

  type TradeRow = { account_id: string; pnl: number | null; fee: number | null; closed_at: string }
  const PAGE = 1000
  const tradeRows: TradeRow[] = []
  let from = 0
  while (true) {
    const { data, error: pageErr } = await supabaseAdmin
      .from('trades')
      .select('account_id, pnl, fee, closed_at, side, trade_type')
      .in('account_id', accountIds)
      .gte('closed_at', sinceDate)
      .not('closed_at', 'is', null)
      .range(from, from + PAGE - 1)
    if (pageErr) return NextResponse.json({ error: pageErr.message }, { status: 500 })
    if (!data || data.length === 0) break
    tradeRows.push(...(data as TradeRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  // Fund summaries
  const fundAccounts: Record<string, string[]> = {}
  for (const acc of (accounts as Array<{ id: string; fund: string }>)) {
    const fund = acc.fund || 'Unknown'
    if (!fundAccounts[fund]) fundAccounts[fund] = []
    fundAccounts[fund].push(acc.id)
  }

  const pnlByAccount: Record<string, number> = {}
  for (const t of tradeRows) {
    pnlByAccount[t.account_id] = (pnlByAccount[t.account_id] ?? 0) + Number(t.pnl ?? 0)
  }

  const funds: FundSummary[] = Object.entries(fundAccounts).map(([fund, ids]) => {
    const aum = ids.reduce((s, id) => s + (latestBalance[id] ?? 0), 0)
    const totalPnl = ids.reduce((s, id) => s + (pnlByAccount[id] ?? 0), 0)
    const pnlPct = aum > 0 ? (totalPnl / aum) * 100 : 0
    return { fund, aum, totalPnl, pnlPct }
  })

  // Chart data
  const dailyMap: Record<string, number> = {}
  for (const t of tradeRows) {
    const day = t.closed_at.slice(0, 10)
    dailyMap[day] = (dailyMap[day] ?? 0) + Number(t.pnl ?? 0)
  }
  const sortedDays = Object.keys(dailyMap).sort()
  let cumulative = 0
  const chartData: ChartDataPoint[] = sortedDays.map((day) => {
    cumulative += dailyMap[day]
    return { period: formatDay(day), pnl: dailyMap[day], cumulativePnl: cumulative }
  })

  // Metrics
  const wins = tradeRows.filter((t) => Number(t.pnl ?? 0) > 0)
  const losses = tradeRows.filter((t) => Number(t.pnl ?? 0) < 0)
  const totalPnl = tradeRows.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
  const totalFees = tradeRows.reduce((s, t) => s + Number(t.fee ?? 0), 0)
  const winRate = tradeRows.length > 0 ? wins.length / tradeRows.length : 0
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + Number(t.pnl), 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + Number(t.pnl), 0) / losses.length) : 0
  const grossProfit = wins.reduce((s, t) => s + Number(t.pnl), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.pnl), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0

  // Time-series metrics derived from daily PnL
  const dailyValues = sortedDays.map((d) => dailyMap[d])
  const N = dailyValues.length

  const meanD = N > 0 ? dailyValues.reduce((s, v) => s + v, 0) / N : 0
  const stdD = N > 1
    ? Math.sqrt(dailyValues.reduce((s, v) => s + Math.pow(v - meanD, 2), 0) / (N - 1))
    : 0
  const sharpeRatio = stdD > 0 ? (meanD / stdD) * Math.sqrt(252) : 0

  const negVals = dailyValues.filter((v) => v < 0)
  const downsideDev = negVals.length > 0
    ? Math.sqrt(negVals.reduce((s, v) => s + v * v, 0) / negVals.length)
    : 0
  const sortinoRatio = downsideDev > 0 ? (meanD / downsideDev) * Math.sqrt(252) : 0

  let peak = 0, cum = 0, maxDrawdown = 0
  for (const v of dailyValues) {
    cum += v
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const totalCurrentBalance = Object.values(latestBalance).reduce((s, v) => s + v, 0)
  const initialCapital = Math.max(totalCurrentBalance - totalPnl, 1)
  const years = N / 252
  const cagr = years > 0 ? Math.pow(Math.max((initialCapital + totalPnl) / initialCapital, 0.0001), 1 / years) - 1 : 0
  const annualYield = years > 0 ? (totalPnl / initialCapital) / years : 0

  const metrics: DashboardMetrics = {
    totalPnl, totalFees, totalTrades: tradeRows.length, winRate, profitFactor, avgWin, avgLoss,
    sharpeRatio, sortinoRatio, maxDrawdown, cagr, annualYield,
    riskRewardRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
  }

  const rawDailyPnl = sortedDays.map((day) => ({ date: day, pnl: dailyMap[day] }))

  return NextResponse.json({ funds, metrics, chartData, rawDailyPnl })
}
