'use client'

import { useState, useMemo, useEffect } from 'react'
import type { FilterState, DateRange, FundSummary, DashboardMetrics } from '@/lib/types'
import { getAllDailyPnL, getAllTrades } from '@/lib/mock-data'
import { calculateMetrics, aggregateChartData, resolveDateRange, filterByDateRange } from '@/lib/calculations'
import Header from '@/components/layout/Header'
import FundCards from '@/components/metrics/FundCards'
import MetricsGrid from '@/components/metrics/MetricsGrid'
import PnLChart from '@/components/charts/PnLChart'

export default function DashboardPage() {
  const [filter, setFilter] = useState<FilterState>({
    exchangeId: 'all',
    subAccountId: 'all',
    timeframe: 'monthly',
    period: '1Y',
  })
  const [customRange, setCustomRange] = useState<DateRange | undefined>()

  // Real data state
  const [funds, setFunds] = useState<FundSummary[]>([])
  const [realMetrics, setRealMetrics] = useState<DashboardMetrics | null>(null)
  const [realChartData, setRealChartData] = useState<import('@/lib/types').ChartDataPoint[]>([])
  const [dataLoading, setDataLoading] = useState(true)

  const dateRange = useMemo<DateRange>(() => {
    if (filter.period === 'manual' && customRange) return customRange
    return resolveDateRange(filter.period, '2025-12-31')
  }, [filter.period, customRange])

  // Fetch real data when period changes
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const resolved = resolveDateRange(filter.period, today)
    const startStr = filter.period === 'manual' ? (customRange?.start ?? '') : (resolved.start ?? '')
    const since = startStr ? new Date(startStr).getTime() : 0

    setDataLoading(true)
    fetch(`/api/dashboard?since=${since}`)
      .then((r) => r.json())
      .then((data: { funds: FundSummary[]; metrics: DashboardMetrics; chartData: import('@/lib/types').ChartDataPoint[] }) => {
        setFunds(data.funds ?? [])
        setRealMetrics(data.metrics ?? null)
        setRealChartData(data.chartData ?? [])
      })
      .catch(() => { /* keep previous data */ })
      .finally(() => setDataLoading(false))
  }, [filter.period, customRange])

  const allDaily = useMemo(() => getAllDailyPnL(), [])
  const allTrades = useMemo(() => getAllTrades(), [])

  const daily = useMemo(
    () => filterByDateRange(allDaily, dateRange),
    [allDaily, dateRange]
  )

  const metrics = useMemo(() => {
    if (realMetrics) {
      return {
        sharpeRatio: realMetrics.sharpeRatio,
        sortinoRatio: realMetrics.sortinoRatio,
        maxDrawdown: realMetrics.maxDrawdown,
        maxDrawdownPct: 0,
        winRate: realMetrics.winRate,
        profitFactor: realMetrics.profitFactor,
        cagr: realMetrics.cagr,
        annualYield: realMetrics.annualYield,
        riskReward: realMetrics.riskRewardRatio,
        averageWin: realMetrics.avgWin,
        averageLoss: realMetrics.avgLoss,
        totalFees: realMetrics.totalFees,
        totalPnl: realMetrics.totalPnl,
        totalTrades: realMetrics.totalTrades,
      }
    }
    return calculateMetrics(daily, allTrades)
  }, [realMetrics, daily, allTrades])

  const chartData = useMemo(
    () =>
      realChartData.length > 0
        ? realChartData
        : aggregateChartData(daily, filter.timeframe),
    [realChartData, daily, filter.timeframe]
  )

  const handlePeriodChange = (period: FilterState['period'], range?: DateRange) => {
    setFilter((f) => ({ ...f, period }))
    setCustomRange(range)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Fund cards */}
      <FundCards funds={funds} loading={dataLoading} />

      <main className="flex-1 pt-2 pb-4">
        <MetricsGrid metrics={metrics} />
        <PnLChart
          data={chartData}
          timeframe={filter.timeframe}
          onTimeframeChange={(t) => setFilter((f) => ({ ...f, timeframe: t }))}
          totalPnl={metrics.totalPnl}
          period={filter.period}
          customRange={customRange}
          onPeriodChange={handlePeriodChange}
        />
      </main>
    </div>
  )
}
