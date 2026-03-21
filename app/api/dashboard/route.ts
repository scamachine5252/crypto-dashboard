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
  const { data: trades, error: tradeError } = await supabaseAdmin
    .from('trades')
    .select('account_id, pnl, fee, closed_at, side, trade_type')
    .in('account_id', accountIds)
    .gte('closed_at', sinceDate)
    .not('closed_at', 'is', null)

  if (tradeError) return NextResponse.json({ error: tradeError.message }, { status: 500 })

  type TradeRow = { account_id: string; pnl: number | null; fee: number | null; closed_at: string }
  const tradeRows = (trades ?? []) as TradeRow[]

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

  const metrics: DashboardMetrics = {
    totalPnl, totalFees, totalTrades: tradeRows.length, winRate, profitFactor, avgWin, avgLoss,
    sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, cagr: 0, annualYield: 0,
    riskRewardRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
  }

  return NextResponse.json({ funds, metrics, chartData })
}
