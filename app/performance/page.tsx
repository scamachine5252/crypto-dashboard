'use client'

import { useState, useMemo, useCallback } from 'react'
import type { Metrics, Period, DateRange } from '@/lib/types'
import { EXCHANGES, getAllDailyPnL, getAllTrades, ACCOUNT_COLORS } from '@/lib/mock-data'
import { useAccountToggles } from '@/hooks/useAccountToggles'
import {
  calculateMetrics,
  calculateFuturesMetrics,
  resolveDateRange,
  filterByDateRange,
  buildMetricTimeSeries,
} from '@/lib/calculations'
import Header from '@/components/layout/Header'
import PeriodSelector from '@/components/ui/PeriodSelector'
import MetricSelector from '@/components/metrics/MetricSelector'
import FuturesMetricsTiles from '@/components/metrics/FuturesMetricsTiles'
import MetricLineChart from '@/components/charts/MetricLineChart'

type ChartTimeframe = 'weekly' | 'monthly'

export default function PerformancePage() {
  const [selectedMetric, setSelectedMetric] = useState<keyof Metrics>('sharpeRatio')
  const [period, setPeriod] = useState<Period>('1Y')
  const [customRange, setCustomRange] = useState<DateRange | undefined>()
  const [chartTimeframe, setChartTimeframe] = useState<ChartTimeframe>('monthly')
  const { activeIds, toggleAccount, toggleExchange, selectAll, reset } = useAccountToggles()

  const dateRange = useMemo<DateRange>(() => {
    if (period === 'manual' && customRange) return customRange
    return resolveDateRange(period, '2025-12-31')
  }, [period, customRange])

  const handlePeriodChange = useCallback((p: Period, range?: DateRange) => {
    setPeriod(p)
    setCustomRange(range)
  }, [])

  // Aggregate metrics for the selector tiles (all active accounts, full period)
  const { aggregateMetrics, futuresMetrics } = useMemo(() => {
    const daily = filterByDateRange(
      getAllDailyPnL().filter((e) => activeIds.has(e.subAccountId)),
      dateRange,
    )
    const trades = getAllTrades().filter((t) => {
      if (!activeIds.has(t.subAccountId)) return false
      const d = t.closedAt.slice(0, 10)
      return d >= dateRange.start && d <= dateRange.end
    })
    return {
      aggregateMetrics: calculateMetrics(daily, trades),
      futuresMetrics: calculateFuturesMetrics(trades),
    }
  }, [activeIds, dateRange])

  // Chart time series
  const chartData = useMemo(
    () =>
      buildMetricTimeSeries(
        getAllDailyPnL(),
        getAllTrades(),
        [...activeIds],
        chartTimeframe,
        selectedMetric,
        dateRange,
      ),
    [activeIds, chartTimeframe, selectedMetric, dateRange],
  )

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header totalPnl={aggregateMetrics.totalPnl} annualYield={aggregateMetrics.annualYield} />

      {/* Controls bar */}
      <div style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Period + chart timeframe */}
        <div className="px-4 py-1.5 flex items-center gap-4 flex-wrap" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Period</span>
          <PeriodSelector value={period} customRange={customRange} onChange={handlePeriodChange} />

          <div className="ml-4 flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
            {(['weekly', 'monthly'] as ChartTimeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setChartTimeframe(tf)}
                className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors capitalize"
                style={{
                  background: chartTimeframe === tf ? 'var(--bg-elevated)' : 'transparent',
                  color: chartTimeframe === tf ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderRight: tf === 'weekly' ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Account toggles */}
        <div className="px-4 py-2 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Accounts</span>

          {EXCHANGES.map((ex) => {
            const exAccounts = ex.subAccounts
            const allOn = exAccounts.every((sa) => activeIds.has(sa.id))
            const someOn = exAccounts.some((sa) => activeIds.has(sa.id))

            return (
              <div key={ex.id} className="flex items-center gap-1">
                {/* Exchange group toggle */}
                <button
                  onClick={() => toggleExchange(ex.id)}
                  className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border transition-colors"
                  style={{
                    color: allOn ? ex.color : 'var(--text-muted)',
                    borderColor: allOn ? ex.color : 'var(--border-subtle)',
                    background: allOn ? `${ex.color}14` : 'transparent',
                    opacity: someOn && !allOn ? 0.7 : 1,
                  }}
                >
                  {ex.name}
                </button>

                {/* Per-account toggles */}
                {exAccounts.map((sa) => {
                  const on = activeIds.has(sa.id)
                  const color = ACCOUNT_COLORS[sa.id] ?? ex.color
                  return (
                    <button
                      key={sa.id}
                      onClick={() => toggleAccount(sa.id)}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 border transition-colors"
                      style={{
                        color: on ? color : 'var(--text-muted)',
                        borderColor: on ? color : 'var(--border-subtle)',
                        background: on ? `${color}14` : 'transparent',
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: on ? color : 'var(--border-medium)' }}
                      />
                      {sa.name}
                    </button>
                  )
                })}
              </div>
            )
          })}

          {/* Select all / none */}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="text-[10px] uppercase tracking-widest transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onClick={selectAll}
            >
              All
            </button>
            <span style={{ color: 'var(--border-medium)' }}>·</span>
            <button
              className="text-[10px] uppercase tracking-widest transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onClick={reset}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Spot metric selector tiles */}
      <MetricSelector
        metrics={aggregateMetrics}
        selected={selectedMetric}
        onSelect={setSelectedMetric}
      />

      {/* Futures metrics section */}
      <FuturesMetricsTiles metrics={futuresMetrics} />

      {/* Multi-line chart */}
      <MetricLineChart
        data={chartData}
        metric={selectedMetric}
        activeIds={[...activeIds]}
      />
    </div>
  )
}
