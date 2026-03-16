'use client'

import { useState, useMemo, useCallback } from 'react'
import type { HistoryFilterState } from '@/lib/types'
import { getAllTrades, getAllDailyPnL } from '@/lib/mock-data'
import {
  filterTradesAdvanced,
  summarizeFilteredTrades,
  filterByDateRange,
  calculateMetrics,
} from '@/lib/calculations'
import { formatMoney } from '@/lib/utils'
import Header from '@/components/layout/Header'
import TradeFilters from '@/components/orders/TradeFilters'
import OrdersTable from '@/components/orders/OrdersTable'
import ExportButton from '@/components/orders/ExportButton'

const DEFAULT_FILTER: HistoryFilterState = {
  exchangeId: 'all',
  subAccountId: 'all',
  symbol: '',
  tradeType: 'all',
  side: 'all',
  dateRange: { start: '2025-07-04', end: '2025-12-31' }, // last 180 days of mock data
  page: 1,
}

export default function HistoryPage() {
  const [filter, setFilter] = useState<HistoryFilterState>(DEFAULT_FILTER)

  const handleFilterChange = useCallback((patch: Partial<HistoryFilterState>) => {
    setFilter((prev) => ({ ...prev, ...patch }))
  }, [])

  const filteredTrades = useMemo(
    () => filterTradesAdvanced(getAllTrades(), filter),
    [filter],
  )

  const summary = useMemo(
    () => summarizeFilteredTrades(filteredTrades),
    [filteredTrades],
  )

  const headerMetrics = useMemo(
    () => calculateMetrics(
      filterByDateRange(getAllDailyPnL(), filter.dateRange),
      filteredTrades,
    ),
    [filteredTrades, filter.dateRange],
  )

  const exportFilename = `trades-${filter.dateRange.start}-to-${filter.dateRange.end}`

  const pnlPositive = summary.totalPnl >= 0

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header totalPnl={headerMetrics.totalPnl} annualYield={headerMetrics.annualYield} />

      {/* Sticky filter bar */}
      <div className="sticky z-40" style={{ top: 56 }}>
        <TradeFilters filter={filter} onChange={handleFilterChange} />
      </div>

      <main className="flex-1 pb-6">
        {/* Table header bar */}
        <div
          className="mx-6 mt-4 px-5 py-3 flex items-center justify-between"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderBottom: 'none',
          }}
        >
          <div>
            <p
              className="text-sm font-semibold font-heading"
              style={{ color: 'var(--text-primary)' }}
            >
              Order History
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {filteredTrades.length.toLocaleString()} trades
            </p>
          </div>
          <ExportButton trades={filteredTrades} filename={exportFilename} />
        </div>

        <OrdersTable trades={filteredTrades} pageSize={50} />

        {/* Footer summary */}
        <div
          className="mx-6 px-5 py-3 flex flex-wrap items-center gap-6"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderTop: '1px solid var(--border-subtle)',
            marginTop: -1, // overlap OrdersTable's bottom border
          }}
        >
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {summary.count.toLocaleString()} trades
          </span>
          <span className="text-xs flex items-center gap-1.5">
            <span style={{ color: 'var(--text-muted)' }}>Total PnL</span>
            <span
              className="font-mono font-semibold tabular"
              style={{ color: pnlPositive ? 'var(--accent-profit)' : 'var(--accent-loss)' }}
            >
              {pnlPositive ? '+' : ''}{formatMoney(summary.totalPnl)}
            </span>
          </span>
          <span className="text-xs flex items-center gap-1.5">
            <span style={{ color: 'var(--text-muted)' }}>Total Fees</span>
            <span
              className="font-mono font-semibold tabular"
              style={{ color: 'var(--accent-loss)' }}
            >
              -{formatMoney(summary.totalFees)}
            </span>
          </span>
        </div>
      </main>
    </div>
  )
}
