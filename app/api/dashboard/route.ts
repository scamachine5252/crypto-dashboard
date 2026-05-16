import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { FundSummary, DashboardMetrics, ChartDataPoint } from '@/lib/types'

function emptyMetrics(): DashboardMetrics {
  return { totalPnl: 0, totalFees: 0, totalTrades: 0, winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, maxDrawdownPct: 0, cagr: 0, annualYield: 0, riskRewardRatio: 0, totalVolume: 0 }
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0')
  const until = Number(req.nextUrl.searchParams.get('until') ?? Date.now())

  // Fetch accounts; initial_aum column added in migration 014.
  // If the column is absent (pre-migration) we retry without it and treat IC as unknown.
  // eslint-disable-next-line prefer-const
  let { data: accounts, error: accError } = await supabaseAdmin
    .from('accounts')
    .select('id, fund, exchange, account_name, initial_aum, instrument')

  if (accError?.message.includes('initial_aum')) {
    const retry = await supabaseAdmin
      .from('accounts')
      .select('id, fund, exchange, account_name')
    accError = retry.error
    accounts = retry.data as typeof accounts
    if (accounts) {
      (accounts as Array<Record<string, unknown>>).forEach((a) => { a.initial_aum = null })
    }
  }

  if (accError) return NextResponse.json({ error: accError.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ funds: [], metrics: emptyMetrics(), chartData: [] })
  }

  const accountIds = (accounts as Array<{ id: string }>).map((a) => a.id)
  const pmAccountIds = new Set(
    (accounts as Array<{ id: string; instrument?: string }>)
      .filter((a) => a.instrument === 'portfolio_margin').map((a) => a.id)
  )

  const { data: balances, error: balError } = await supabaseAdmin
    .from('balances')
    .select('account_id, usdt_balance, total_equity_usdt, recorded_at')
    .in('account_id', accountIds)
    .is('token_symbol', null)
    .order('recorded_at', { ascending: true })
    .order('account_id', { ascending: true })

  if (balError) return NextResponse.json({ error: balError.message }, { status: 500 })

  type BalRow = { account_id: string; usdt_balance: number; total_equity_usdt: number | null; recorded_at: string }
  const bals = (balances ?? []) as BalRow[]

  // Latest balance per account (last entry since sorted ascending)
  // PM accounts: usdt_balance only — BTC collateral tracked separately via token rows
  const latestBalance: Record<string, number> = {}
  for (const row of bals) {
    latestBalance[row.account_id] = pmAccountIds.has(row.account_id)
      ? Number(row.usdt_balance)
      : Number(row.total_equity_usdt ?? row.usdt_balance)
  }

  const sinceDate = new Date(since).toISOString()
  const untilDate = new Date(until).toISOString()

  // Single aggregate query instead of 38+ paginated SELECT loops
  // Returns at most (accounts × days) rows — e.g. 10 × 180 = 1800 vs 37K raw trades
  type StatRow = {
    account_id: string; day: string
    daily_pnl: number; daily_fee: number; daily_volume: number
    win_count: number; loss_count: number; gross_profit: number; gross_loss: number
  }
  const { data: statsData, error: statsErr } = await supabaseAdmin
    .rpc('trade_stats_by_account_day', {
      p_account_ids: accountIds,
      p_since:       sinceDate,
      p_until:       untilDate,
    })
  if (statsErr) return NextResponse.json({ error: statsErr.message }, { status: 500 })
  const statsRows = (statsData ?? []) as StatRow[]

  // Aggregate per-account and per-day from compact RPC result
  const pnlByAccount:        Record<string, number> = {}
  const tradeCountByAccount: Record<string, number> = {}
  const dailyMap:            Record<string, number> = {}
  let totalPnl = 0, totalFees = 0, totalVolume = 0
  let totalWins = 0, totalLosses = 0, totalGrossProfit = 0, totalGrossLoss = 0

  for (const row of statsRows) {
    const day = String(row.day).slice(0, 10)
    pnlByAccount[row.account_id]        = (pnlByAccount[row.account_id]        ?? 0) + row.daily_pnl
    tradeCountByAccount[row.account_id] = (tradeCountByAccount[row.account_id] ?? 0) + Number(row.win_count) + Number(row.loss_count)
    dailyMap[day]                        = (dailyMap[day]                        ?? 0) + row.daily_pnl
    totalPnl          += row.daily_pnl
    totalFees         += row.daily_fee
    totalVolume       += row.daily_volume
    totalWins         += Number(row.win_count)
    totalLosses       += Number(row.loss_count)
    totalGrossProfit  += row.gross_profit
    totalGrossLoss    += row.gross_loss
  }

  const closedCount   = totalWins + totalLosses
  const winRate       = closedCount > 0 ? (totalWins / closedCount) * 100 : 0
  const avgWin        = totalWins   > 0 ? totalGrossProfit / totalWins   : 0
  const avgLoss       = totalLosses > 0 ? totalGrossLoss   / totalLosses : 0
  const profitFactor  = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : totalGrossProfit > 0 ? 999 : 0

  // Fund summaries
  const fundAccounts: Record<string, string[]> = {}
  for (const acc of (accounts as Array<{ id: string; fund: string }>)) {
    const fund = acc.fund || 'Unknown'
    if (!fundAccounts[fund]) fundAccounts[fund] = []
    fundAccounts[fund].push(acc.id)
  }

  const funds: FundSummary[] = Object.entries(fundAccounts).map(([fund, ids]) => {
    const aum = ids.reduce((s, id) => s + (latestBalance[id] ?? 0), 0)
    const totalFundPnl = ids.reduce((s, id) => s + (pnlByAccount[id] ?? 0), 0)
    const pnlPct = aum > 0 ? (totalFundPnl / aum) * 100 : 0
    const tradeCount = ids.reduce((s, id) => s + (tradeCountByAccount[id] ?? 0), 0)
    return { fund, aum, totalPnl: totalFundPnl, pnlPct, tradeCount }
  })

  // Chart data
  const sortedDays = Object.keys(dailyMap).sort()
  let cumulative = 0
  const chartData: ChartDataPoint[] = sortedDays.map((day) => {
    cumulative += dailyMap[day]
    return { period: formatDay(day), pnl: dailyMap[day], cumulativePnl: cumulative }
  })

  // Time-series metrics derived from daily PnL
  const dailyValues = sortedDays.map((d) => dailyMap[d])
  const N = dailyValues.length

  const meanD = N > 0 ? dailyValues.reduce((s, v) => s + v, 0) / N : 0
  const stdD = N > 1
    ? Math.sqrt(dailyValues.reduce((s, v) => s + Math.pow(v - meanD, 2), 0) / (N - 1))
    : 0
  const sharpeRatio = stdD > 0 ? (meanD / stdD) * Math.sqrt(252) : 0

  // Sortino: downside deviation uses N (total periods) as denominator, not just
  // the count of negative days — standard CFA/MAR definition.
  const negVals = dailyValues.filter((v) => v < 0)
  const downsideDev = N > 0
    ? Math.sqrt(negVals.reduce((s, v) => s + v * v, 0) / N)
    : 0
  const sortinoRatio = downsideDev > 0 ? (meanD / downsideDev) * Math.sqrt(252) : 0

  const totalCurrentBalance = Object.values(latestBalance).reduce((s, v) => s + v, 0)

  // ---------------------------------------------------------------------------
  // Initial capital per account — same 3-priority logic as /api/performance
  // Priority 1: last balance snapshot at or before period start
  // Priority 2: first balance snapshot within period
  // Priority 3: manually entered initial_aum
  // Falls back to null (IC unknown → IC-dependent metrics show "—")
  // ---------------------------------------------------------------------------
  const icMap: Record<string, number | null> = {}
  for (const acc of (accounts as Array<{ id: string; initial_aum?: number | null }>)) {
    const accBals = bals.filter((b) => b.account_id === acc.id)

    const isPm = pmAccountIds.has(acc.id)
    const balVal = (r: BalRow) => isPm ? Number(r.usdt_balance) : Number(r.total_equity_usdt ?? r.usdt_balance)

    const beforePeriod = accBals.filter((b) => b.recorded_at <= sinceDate)
    if (beforePeriod.length > 0) {
      icMap[acc.id] = balVal(beforePeriod[beforePeriod.length - 1])
      continue
    }
    const inPeriod = accBals.filter((b) => b.recorded_at > sinceDate)
    if (inPeriod.length > 0) {
      icMap[acc.id] = balVal(inPeriod[0])
      continue
    }
    const aum = Number(acc.initial_aum ?? 0)
    icMap[acc.id] = aum > 0 ? aum : null
  }

  const icValues = Object.values(icMap).filter((v) => v !== null) as number[]
  const totalInitialCapital: number | null = icValues.length > 0 ? icValues.reduce((a, b) => a + b, 0) : null
  const initialCapital = totalInitialCapital ?? 0

  // Max drawdown: start equity at 0 (relative to period start).
  // maxDrawdownPct divides by IC + peak when IC is known; falls back to
  // totalCurrentBalance → period peak (absolute last resort).
  let peak = 0, cum = 0, maxDrawdown = 0, maxDrawdownPct = 0
  for (const v of dailyValues) {
    cum += v
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDrawdown) {
      maxDrawdown = dd
      const equityBase = totalInitialCapital !== null
        ? totalInitialCapital + peak
        : totalCurrentBalance > 0
          ? totalCurrentBalance
          : peak
      maxDrawdownPct = equityBase > 0 ? (dd / equityBase) * 100 : 0
    }
  }

  // years: use calendar span (first → last trade date) not count of trading days.
  // This avoids overstating CAGR/annualYield when trading is intermittent.
  const firstDay = sortedDays[0]
  const lastDay  = sortedDays[sortedDays.length - 1]
  const years = sortedDays.length >= 2
    ? (new Date(lastDay + 'T00:00:00Z').getTime() - new Date(firstDay + 'T00:00:00Z').getTime()) / (365 * 24 * 3600 * 1000)
    : N / 252  // single-day fallback

  // CAGR and Annual Yield require a known initial capital.
  // Return null when IC is 0 (unknown) so the UI can show "—" instead of 0.
  const cagr: number | null = (initialCapital > 0 && years > 0)
    ? (Math.pow(Math.max((initialCapital + totalPnl) / initialCapital, 0.0001), 1 / years) - 1) * 100
    : null
  const annualYield: number | null = (initialCapital > 0 && years > 0)
    ? (totalPnl / initialCapital / years) * 100
    : null

  const metrics: DashboardMetrics = {
    totalPnl, totalFees, totalTrades: closedCount, winRate, profitFactor, avgWin, avgLoss,
    sharpeRatio, sortinoRatio, maxDrawdown, maxDrawdownPct, cagr, annualYield,
    riskRewardRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
    totalVolume,
  }

  const rawDailyPnl = sortedDays.map((day) => ({ date: day, pnl: dailyMap[day] }))

  return NextResponse.json({ funds, metrics, chartData, rawDailyPnl })
}
