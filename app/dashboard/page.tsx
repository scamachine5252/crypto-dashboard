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
    period: '1M',
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

  const dateRange = useMemo<DateRange>(() => {
    if (filter.period === 'manual' && customRange) return customRange
    return resolveDateRange(filter.period, new Date().toISOString().slice(0, 10))
  }, [filter.period, customRange])

  // Fetch dashboard data when period changes
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const resolved = resolveDateRange(filter.period, today)
    const startStr = filter.period === 'manual' ? (customRange?.start ?? '') : (resolved.start ?? '')
    const since = startStr ? new Date(startStr).getTime() : 0

    setDataLoading(true)
    fetch(`/api/dashboard?since=${since}`)
      .then((r) => r.json())
      .then((data: { funds: FundSummary[]; metrics: DashboardMetrics; rawDailyPnl?: Array<{ date: string; pnl: number }> }) => {
        setFunds(data.funds ?? [])
        setRealMetrics(data.metrics ?? null)
        setRawDailyPnl(data.rawDailyPnl ?? [])
      })
      .catch(() => { /* keep previous data */ })
      .finally(() => setDataLoading(false))
  }, [filter.period, customRange])

  // Fetch positions on mount
  useEffect(() => {
    fetch('/api/positions')
      .then((r) => r.json())
      .then((data: { positions?: Position[] }) => setPositions(data.positions ?? []))
      .catch(() => {})
      .finally(() => setPosLoading(false))
  }, [])

  const metrics = useMemo(() => ({
    sharpeRatio:   realMetrics?.sharpeRatio   ?? 0,
    sortinoRatio:  realMetrics?.sortinoRatio  ?? 0,
    maxDrawdown:   realMetrics?.maxDrawdown   ?? 0,
    maxDrawdownPct: realMetrics?.maxDrawdownPct ?? 0,
    winRate:       realMetrics?.winRate       ?? 0,
    profitFactor:  realMetrics?.profitFactor  ?? 0,
    cagr:          realMetrics?.cagr          ?? 0,
    annualYield:   realMetrics?.annualYield   ?? 0,
    riskReward:    realMetrics?.riskRewardRatio ?? 0,
    averageWin:    realMetrics?.avgWin        ?? 0,
    averageLoss:   realMetrics?.avgLoss       ?? 0,
    totalFees:     realMetrics?.totalFees     ?? 0,
    totalPnl:      realMetrics?.totalPnl      ?? 0,
    totalTrades:   realMetrics?.totalTrades   ?? 0,
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
        <MetricsGrid metrics={metrics} totalNotional={realMetrics?.totalVolume ?? 0} />
        <PnLChart
          data={chartData}
          timeframe={filter.timeframe}
          onTimeframeChange={(t) => setFilter((f) => ({ ...f, timeframe: t }))}
          totalPnl={metrics.totalPnl}
          period={filter.period}
          customRange={customRange}
          onPeriodChange={handlePeriodChange}
        />

        {/* ── Open Positions summary ── */}
        <div className="mx-6 mt-4 mb-6">
          <div
            className="flex flex-wrap items-center gap-6 px-5 py-4"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                Open Positions
              </p>
              {posLoading ? (
                <div className="h-5 w-24 rounded animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
              ) : (
                <p className="text-lg font-semibold tabular-nums font-mono" style={{ color: totalUnrealizedPnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)' }}>
                  {totalUnrealizedPnl >= 0 ? '+' : ''}{formatMoney(totalUnrealizedPnl)}
                </p>
              )}
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Unrealized PnL</p>
            </div>

            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)' }} />

            {[
              { label: 'Notional',     value: posLoading ? null : formatMoney(totalNotional) },
              { label: 'Margin Used',  value: posLoading ? null : formatMoney(totalMargin) },
              { label: 'Avg Leverage', value: posLoading ? null : (weightedAvgLeverage > 0 ? `${weightedAvgLeverage.toFixed(1)}x` : '—') },
              { label: 'Positions',    value: posLoading ? null : String(positions.length) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
                {value === null
                  ? <div className="h-5 w-16 rounded animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
                  : <p className="text-sm font-semibold tabular-nums font-mono" style={{ color: 'var(--text-primary)' }}>{value}</p>
                }
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
