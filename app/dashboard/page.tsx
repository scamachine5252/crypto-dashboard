'use client'

import { useState, useMemo } from 'react'
import type { FilterState, DateRange } from '@/lib/types'
import { getAllDailyPnL, getAllTrades } from '@/lib/mock-data'
import { calculateMetrics, aggregateChartData, resolveDateRange, filterByDateRange } from '@/lib/calculations'
import Header from '@/components/layout/Header'
import BalanceCards from '@/components/metrics/BalanceCards'
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

  const dateRange = useMemo<DateRange>(() => {
    if (filter.period === 'manual' && customRange) return customRange
    return resolveDateRange(filter.period, '2025-12-31')
  }, [filter.period, customRange])

  const allDaily = useMemo(() => getAllDailyPnL(), [])
  const allTrades = useMemo(() => getAllTrades(), [])

  const daily = useMemo(
    () => filterByDateRange(allDaily, dateRange),
    [allDaily, dateRange]
  )

  const metrics = useMemo(() => calculateMetrics(daily, allTrades), [daily, allTrades])

  const chartData = useMemo(
    () => aggregateChartData(daily, filter.timeframe),
    [daily, filter.timeframe]
  )

  const handlePeriodChange = (period: FilterState['period'], range?: DateRange) => {
    setFilter((f) => ({ ...f, period }))
    setCustomRange(range)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Balance cards */}
      <BalanceCards />

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
