'use client'

import { useState, useMemo } from 'react'
import type { FilterState, DateRange } from '@/lib/types'
import { filterDailyPnL, filterTrades } from '@/lib/mock-data'
import { calculateMetrics, aggregateChartData, resolveDateRange, filterByDateRange } from '@/lib/calculations'
import Header from '@/components/layout/Header'
import FilterBar from '@/components/layout/FilterBar'
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

  // Resolve the active date range from period selection
  const dateRange = useMemo<DateRange>(() => {
    if (filter.period === 'manual' && customRange) return customRange
    return resolveDateRange(filter.period, '2025-12-31') // use end of mock data as "today"
  }, [filter.period, customRange])

  const allDaily = useMemo(
    () => filterDailyPnL(filter.exchangeId, filter.subAccountId),
    [filter.exchangeId, filter.subAccountId]
  )

  const daily = useMemo(
    () => filterByDateRange(allDaily, dateRange),
    [allDaily, dateRange]
  )

  const trades = useMemo(
    () => filterTrades(filter.exchangeId, filter.subAccountId),
    [filter.exchangeId, filter.subAccountId]
  )

  const metrics = useMemo(() => calculateMetrics(daily, trades), [daily, trades])

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
      <Header totalPnl={metrics.totalPnl} annualYield={metrics.annualYield} />

      <FilterBar
        filter={filter}
        onChange={setFilter}
        period={filter.period}
        customRange={customRange}
        onPeriodChange={handlePeriodChange}
      />

      {/* Balance cards */}
      <BalanceCards />

      <main className="flex-1 pt-2 pb-4">
        <MetricsGrid metrics={metrics} />
        <PnLChart
          data={chartData}
          timeframe={filter.timeframe}
          onTimeframeChange={(t) => setFilter((f) => ({ ...f, timeframe: t }))}
          totalPnl={metrics.totalPnl}
        />
      </main>
    </div>
  )
}
