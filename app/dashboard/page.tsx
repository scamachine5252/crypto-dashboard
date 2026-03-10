'use client'

import { useState, useMemo } from 'react'
import type { FilterState } from '@/lib/types'
import { filterDailyPnL, filterTrades } from '@/lib/mock-data'
import { calculateMetrics, aggregateChartData } from '@/lib/calculations'
import Header from '@/components/dashboard/Header'
import FilterBar from '@/components/dashboard/FilterBar'
import MetricsGrid from '@/components/dashboard/MetricsGrid'
import PnLChart from '@/components/dashboard/PnLChart'
import OrdersTable from '@/components/dashboard/OrdersTable'

export default function DashboardPage() {
  const [filter, setFilter] = useState<FilterState>({
    exchangeId: 'all',
    subAccountId: 'all',
    timeframe: 'daily',
  })

  const daily = useMemo(
    () => filterDailyPnL(filter.exchangeId, filter.subAccountId),
    [filter.exchangeId, filter.subAccountId]
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

  return (
    <div className="min-h-screen bg-[#050b14] flex flex-col">
      <Header totalPnl={metrics.totalPnl} annualYield={metrics.annualYield} />

      <FilterBar filter={filter} onChange={setFilter} />

      <main className="flex-1 py-2">
        <MetricsGrid metrics={metrics} />
        <PnLChart
          data={chartData}
          timeframe={filter.timeframe}
          onTimeframeChange={(t) => setFilter((f) => ({ ...f, timeframe: t }))}
          totalPnl={metrics.totalPnl}
        />
        <OrdersTable trades={trades} />
      </main>
    </div>
  )
}
