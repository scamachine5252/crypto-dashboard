'use client'

import { useState, useMemo, useCallback } from 'react'
import type { Period, DateRange } from '@/lib/types'
import { EXCHANGES, getAllDailyPnL, getAllTrades, ACCOUNT_COLORS } from '@/lib/mock-data'
import {
  resolveDateRange,
  filterByDateRange,
  calculateMetrics,
  buildOverlayData,
  buildComparisonRows,
} from '@/lib/calculations'
import { useAccountToggles } from '@/hooks/useAccountToggles'
import Header from '@/components/layout/Header'
import PeriodSelector from '@/components/ui/PeriodSelector'
import OverlayLineChart from '@/components/charts/OverlayLineChart'
import ComparisonTable from '@/components/orders/ComparisonTable'

export default function ResultsPage() {
  const [period, setPeriod] = useState<Period>('1Y')
  const [customRange, setCustomRange] = useState<DateRange | undefined>()
  const [symbolFilter, setSymbolFilter] = useState('')
  const { activeIds, toggleAccount, toggleExchange, selectAll, reset } = useAccountToggles()

  const handlePeriodChange = useCallback((p: Period, range?: DateRange) => {
    setPeriod(p)
    setCustomRange(range)
  }, [])

  const handleSymbol = useCallback((raw: string) => {
    setSymbolFilter(raw.toUpperCase().trim())
  }, [])

  const dateRange = useMemo<DateRange>(() => {
    if (period === 'manual' && customRange) return customRange
    return resolveDateRange(period, '2025-12-31')
  }, [period, customRange])

  const filteredTrades = useMemo(() => {
    const sym = symbolFilter
    return getAllTrades().filter((t) => {
      if (!activeIds.has(t.subAccountId)) return false
      const d = t.closedAt.slice(0, 10)
      if (d < dateRange.start || d > dateRange.end) return false
      if (sym) return t.symbol.toUpperCase().includes(sym)
      return true
    })
  }, [activeIds, dateRange, symbolFilter])

  // Overlay chart uses total daily PnL regardless of symbol filter
  // (DailyPnLEntry has no symbol dimension — filtering would require
  //  reconstructing daily series from trades, adding complexity for minimal gain)
  const overlayData = useMemo(
    () => buildOverlayData(getAllDailyPnL(), [...activeIds], dateRange),
    [activeIds, dateRange],
  )

  // Comparison table: trade-derived metrics reflect symbol filter
  const comparisonRows = useMemo(
    () => buildComparisonRows(getAllDailyPnL(), filteredTrades, [...activeIds], dateRange),
    [filteredTrades, activeIds, dateRange],
  )

  const headerMetrics = useMemo(() => {
    const daily = filterByDateRange(
      getAllDailyPnL().filter((e) => activeIds.has(e.subAccountId)),
      dateRange,
    )
    return calculateMetrics(daily, filteredTrades)
  }, [activeIds, dateRange, filteredTrades])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header totalPnl={headerMetrics.totalPnl} annualYield={headerMetrics.annualYield} />

      {/* Controls bar */}
      <div style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>

        {/* Row 1: Period selector + symbol search */}
        <div
          className="px-4 py-1.5 flex items-center gap-4 flex-wrap"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Period</span>
          <PeriodSelector value={period} customRange={customRange} onChange={handlePeriodChange} />

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Pair</span>
            <input
              type="text"
              value={symbolFilter}
              onChange={(e) => handleSymbol(e.target.value)}
              placeholder="BTC/USDT"
              className="text-xs px-2.5 py-1 outline-none w-36"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                borderRadius: 2,
              }}
            />
          </div>
        </div>

        {/* Row 2: Account toggles */}
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

          {/* Select all / reset */}
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

      <main className="flex-1 pb-6">
        {/* Overlay equity curves — 60% visual weight */}
        <OverlayLineChart
          data={overlayData}
          activeIds={[...activeIds]}
          height={360}
        />

        {/* Comparison table — 40% visual weight */}
        <ComparisonTable rows={comparisonRows} />
      </main>
    </div>
  )
}
