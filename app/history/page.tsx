'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import type { HistoryFilterState, Trade } from '@/lib/types'
import { filterTradesAdvanced, summarizeFilteredTrades } from '@/lib/calculations'
import { formatMoney } from '@/lib/utils'
import Header from '@/components/layout/Header'
import TradeFilters, { type AccountInfo } from '@/components/orders/TradeFilters'
import OrdersTable from '@/components/orders/OrdersTable'
import ExportButton from '@/components/orders/ExportButton'

function getDefaultFilter(): HistoryFilterState {
  const end   = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return {
    exchangeId:   'all',
    subAccountId: 'all',
    symbol:       '',
    tradeType:    'all',
    side:         'all',
    dateRange:    { start, end },
    page:         1,
  }
}

export default function HistoryPage() {
  const [filter, setFilter]     = useState<HistoryFilterState>(getDefaultFilter)
  const [trades, setTrades]     = useState<Trade[]>([])
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [loading, setLoading]   = useState(true)

  const handleFilterChange = useCallback((patch: Partial<HistoryFilterState>) => {
    setFilter((prev) => ({ ...prev, ...patch }))
  }, [])

  // Fetch trades when date range changes
  useEffect(() => {
    const since = new Date(filter.dateRange.start).getTime()
    const until = new Date(filter.dateRange.end + 'T23:59:59Z').getTime()
    setLoading(true)
    fetch(`/api/trades?since=${since}&until=${until}`)
      .then((r) => r.json())
      .then((data: { trades?: Trade[]; accounts?: { id: string; account_name: string; exchange: string }[] }) => {
        setTrades(data.trades ?? [])
        setAccounts(
          (data.accounts ?? []).map((a) => ({
            id: a.id,
            accountName: a.account_name,
            exchange: a.exchange,
          }))
        )
      })
      .catch(() => { /* keep previous */ })
      .finally(() => setLoading(false))
  }, [filter.dateRange.start, filter.dateRange.end])

  const accountNameMap = useMemo<Record<string, string>>(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.accountName])),
    [accounts]
  )

  const filteredTrades = useMemo(
    () => filterTradesAdvanced(trades, filter),
    [trades, filter],
  )

  const summary = useMemo(
    () => summarizeFilteredTrades(filteredTrades),
    [filteredTrades],
  )

  const exportFilename = `trades-${filter.dateRange.start}-to-${filter.dateRange.end}`
  const pnlPositive = summary.totalPnl >= 0

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Sticky filter area */}
      <div className="sticky z-40" style={{ top: 56 }}>
        <div
          className="px-4 py-2 flex items-center justify-between"
          style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Order History
          </p>
          <ExportButton trades={filteredTrades} filename={exportFilename} />
        </div>
        <TradeFilters filter={filter} onChange={handleFilterChange} accounts={accounts} />
      </div>

      <main className="flex-1 pb-6">
        {loading ? (
          <div className="mx-6 mt-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 rounded animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
            ))}
          </div>
        ) : (
          <OrdersTable trades={filteredTrades} pageSize={50} accountNameMap={accountNameMap} />
        )}

        {/* Footer summary */}
        <div
          className="mx-6 px-5 py-3 flex flex-wrap items-center gap-6"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderTop: '1px solid var(--border-subtle)',
            marginTop: -1,
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
