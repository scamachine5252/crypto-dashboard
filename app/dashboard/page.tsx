'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import type { FilterState, DateRange, FundSummary, DashboardMetrics, DailyPnLEntry, ExchangeId, Position } from '@/lib/types'
import { aggregateChartData, resolveDateRange } from '@/lib/calculations'
import { formatMoney } from '@/lib/utils'
import Header from '@/components/layout/Header'
import FundCards from '@/components/metrics/FundCards'
import MetricsGrid from '@/components/metrics/MetricsGrid'
import PnLChart from '@/components/charts/PnLChart'
import { ChevronDown, Check } from 'lucide-react'

function formatHoldingTime(openTimestamp: number): string {
  if (!openTimestamp) return '—'
  const diffMs = Date.now() - openTimestamp
  const diffH  = Math.floor(diffMs / 3_600_000)
  const diffD  = Math.floor(diffH / 24)
  if (diffD > 0) return `${diffD}d ${diffH % 24}h`
  return `${diffH}h`
}

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit:   '#FF6B2C',
  okx:     '#4F8EF7',
}

interface AccountMeta {
  id: string
  accountName: string
  exchange: string
  fund: string
}

export default function DashboardPage() {
  const [filter, setFilter] = useState<FilterState>({
    exchangeId: 'all',
    subAccountId: 'all',
    timeframe: 'daily',
    period: 'inception',
  })
  const [customRange, setCustomRange] = useState<DateRange | undefined>()

  // Real data state
  const [funds, setFunds]             = useState<FundSummary[]>([])
  const [realMetrics, setRealMetrics] = useState<DashboardMetrics | null>(null)
  const [rawDailyPnl, setRawDailyPnl] = useState<Array<{ date: string; pnl: number }>>([])
  const [dataLoading, setDataLoading] = useState(true)

  // Open positions state
  const [positions, setPositions]   = useState<Position[]>([])
  const [posLoading, setPosLoading] = useState(true)
  const [inceptionDate, setInceptionDate] = useState<string | undefined>()

  // Fetch inception date once on mount
  useEffect(() => {
    fetch('/api/inception')
      .then((r) => r.json())
      .then((d: { date?: string }) => { if (d.date) setInceptionDate(d.date) })
      .catch(() => {})
  }, [])

  const dateRange = useMemo<DateRange>(() => {
    if (filter.period === 'manual' && customRange) return customRange
    return resolveDateRange(filter.period, new Date().toISOString().slice(0, 10), inceptionDate)
  }, [filter.period, customRange, inceptionDate])

  // Fetch dashboard data when period changes
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const resolved = resolveDateRange(filter.period, today, inceptionDate)
    const startStr = filter.period === 'manual' ? (customRange?.start ?? '') : (resolved.start ?? '')
    const endStr   = filter.period === 'manual' ? (customRange?.end   ?? today) : (resolved.end ?? today)
    const since = startStr ? new Date(startStr).getTime() : 0
    const until = new Date(endStr + 'T23:59:59Z').getTime()

    setDataLoading(true)
    fetch(`/api/dashboard?since=${since}&until=${until}`)
      .then((r) => r.json())
      .then((data: { funds: FundSummary[]; metrics: DashboardMetrics; rawDailyPnl?: Array<{ date: string; pnl: number }> }) => {
        setFunds(data.funds ?? [])
        setRealMetrics(data.metrics ?? null)
        setRawDailyPnl(data.rawDailyPnl ?? [])
      })
      .catch(() => { /* keep previous data */ })
      .finally(() => setDataLoading(false))
  }, [filter.period, customRange, inceptionDate])

  // Fetch positions on mount
  useEffect(() => {
    fetch('/api/positions')
      .then((r) => r.json())
      .then((data: { positions?: Position[] }) => {
        const ps = data.positions ?? []
        setPositions(ps)

        // Lazy-load real open times for Binance positions
        const binanceRefs = ps
          .filter((p) => p.exchange === 'binance')
          .map((p) => ({
            accountId: p.accountId,
            rawSymbol: p.symbol.replace('/', '').replace(':USDT', '').replace(':USDC', ''),
            side: p.side,
          }))
        if (binanceRefs.length > 0) {
          fetch('/api/positions/open-times', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positions: binanceRefs }),
          })
            .then((r) => r.json())
            .then((ot: { openTimes?: Record<string, number> }) => {
              const times = ot.openTimes ?? {}
              setPositions((prev) =>
                prev.map((p) => {
                  const key = `${p.accountId}:${p.symbol.replace('/', '').replace(':USDT', '').replace(':USDC', '')}`
                  return times[key] ? { ...p, openTimestamp: times[key] } : p
                }),
              )
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setPosLoading(false))
  }, [])

  const metrics = useMemo(() => ({
    sharpeRatio:   realMetrics?.sharpeRatio    ?? 0,
    sortinoRatio:  realMetrics?.sortinoRatio   ?? 0,
    maxDrawdown:   realMetrics?.maxDrawdown    ?? 0,
    maxDrawdownPct: realMetrics?.maxDrawdownPct ?? 0,
    winRate:       realMetrics?.winRate        ?? 0,
    profitFactor:  realMetrics?.profitFactor   ?? 0,
    // null = IC unknown — MetricsGrid will show "—"
    cagr:          realMetrics?.cagr          ?? null,
    annualYield:   realMetrics?.annualYield   ?? null,
    riskReward:    realMetrics?.riskRewardRatio ?? 0,
    averageWin:    realMetrics?.avgWin         ?? 0,
    averageLoss:   realMetrics?.avgLoss        ?? 0,
    totalFees:     realMetrics?.totalFees      ?? 0,
    totalPnl:      realMetrics?.totalPnl       ?? 0,
    totalTrades:   realMetrics?.totalTrades    ?? 0,
  }), [realMetrics])

  const chartData = useMemo(() => {
    const entries: DailyPnLEntry[] = rawDailyPnl.map(({ date, pnl }) => ({
      date,
      subAccountId: 'all',
      exchangeId: 'binance' as ExchangeId,
      pnl,
      cumulativePnl: 0,
    }))
    return aggregateChartData(entries, filter.timeframe)
  }, [rawDailyPnl, filter.timeframe])

  const handlePeriodChange = (period: FilterState['period'], range?: DateRange) => {
    setFilter((f) => ({ ...f, period }))
    setCustomRange(range)
  }

  const totalUnrealizedPnl  = positions.reduce((s, p) => s + p.unrealizedPnl, 0)
  const totalNotional       = positions.reduce((s, p) => s + p.notional, 0)
  const totalMargin         = positions.reduce((s, p) => s + p.margin, 0)
  const weightedAvgLeverage = totalNotional > 0
    ? positions.reduce((s, p) => s + p.notional * p.leverage, 0) / totalNotional
    : 0

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Fund cards */}
      <FundCards funds={funds} loading={dataLoading} />

      <main className="flex-1 pt-2 pb-6">
        {/* ── Performance metrics ── */}
        <div className="px-6 pt-3 pb-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Performance
          </p>
        </div>
        <MetricsGrid metrics={metrics} totalNotional={realMetrics?.totalVolume ?? 0} />
        <PnLChart
          data={chartData}
          timeframe={filter.timeframe}
          onTimeframeChange={(t) => setFilter((f) => ({ ...f, timeframe: t }))}
          totalPnl={metrics.totalPnl}
          period={filter.period}
          customRange={customRange}
          onPeriodChange={handlePeriodChange}
          inceptionDate={inceptionDate}
        />

        {/* ── Open Positions per account ── */}
        <div className="mx-6 mt-2 mb-4">
          {/* Header row */}
          <div
            className="flex items-center justify-between px-5 py-2.5"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Open Positions
            </p>
            {!posLoading && (
              <div className="flex items-center gap-4">
                <span className="text-xs flex items-center gap-1.5">
                  <span style={{ color: 'var(--text-muted)' }}>Total Unrealized PnL</span>
                  <span className="font-mono font-semibold tabular-nums" style={{ color: totalUnrealizedPnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)' }}>
                    {totalUnrealizedPnl >= 0 ? '+' : ''}{formatMoney(totalUnrealizedPnl)}
                  </span>
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {positions.length} position{positions.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          {/* Per-account table */}
          {posLoading ? (
            <div className="space-y-px" style={{ borderLeft: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
              {[1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse" style={{ background: 'var(--bg-secondary)' }} />)}
            </div>
          ) : positions.length === 0 ? (
            <div className="flex items-center justify-center py-8" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderTop: 'none' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No open positions</p>
            </div>
          ) : (() => {
            // Group by account
            const byAccount = new Map<string, { accountName: string; exchange: string; positions: typeof positions }>()
            for (const p of positions) {
              if (!byAccount.has(p.accountId)) {
                byAccount.set(p.accountId, { accountName: p.accountName, exchange: p.exchange, positions: [] })
              }
              byAccount.get(p.accountId)!.positions.push(p)
            }
            const rows = Array.from(byAccount.entries()).map(([id, { accountName, exchange, positions: ps }]) => {
              const unrealPnl   = ps.reduce((s, p) => s + p.unrealizedPnl, 0)
              const notional    = ps.reduce((s, p) => s + p.notional, 0)
              const margin      = ps.reduce((s, p) => s + p.margin, 0)
              const avgLev      = notional > 0 ? ps.reduce((s, p) => s + p.notional * p.leverage, 0) / notional : 0
              const longNotional  = ps.filter((p) => p.side === 'long').reduce((s, p) => s + p.notional, 0)
              const shortNotional = ps.filter((p) => p.side === 'short').reduce((s, p) => s + p.notional, 0)
              return { id, accountName, exchange, count: ps.length, unrealPnl, notional, margin, avgLev, longNotional, shortNotional }
            })

            return (
              <div className="overflow-x-auto" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderTop: 'none' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {['Account', 'Positions', 'Unrealized PnL', 'Notional', 'Long', 'Short', 'Margin', 'Avg Lev'].map((h) => (
                        <th key={h} className="px-4 py-2 text-left font-medium whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const exColor  = EXCHANGE_COLORS[r.exchange] ?? '#888'
                      const pnlColor = r.unrealPnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)'
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: exColor }} />
                              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{r.accountName}</span>
                              <span className="text-[10px] uppercase font-bold" style={{ color: exColor }}>{r.exchange}</span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{r.count}</td>
                          <td className="px-4 py-2.5 tabular-nums font-mono font-semibold whitespace-nowrap" style={{ color: pnlColor }}>
                            {r.unrealPnl >= 0 ? '+' : ''}{formatMoney(r.unrealPnl)}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatMoney(r.notional)}</td>
                          <td className="px-4 py-2.5 tabular-nums font-mono whitespace-nowrap" style={{ color: 'var(--accent-profit)' }}>
                            {r.longNotional > 0 ? formatMoney(r.longNotional) : '—'}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums font-mono whitespace-nowrap" style={{ color: 'var(--accent-loss)' }}>
                            {r.shortNotional > 0 ? formatMoney(r.shortNotional) : '—'}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatMoney(r.margin)}</td>
                          <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                            {r.avgLev > 0 ? `${r.avgLev.toFixed(1)}x` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      </main>
    </div>
  )
}
