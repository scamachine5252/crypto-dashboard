'use client'

import React, { useState, useMemo } from 'react'
import type { Period, DateRange, Timeframe } from '@/lib/types'
import { EXCHANGES, getAllDailyPnL, ACCOUNT_PRIMARY_TOKEN } from '@/lib/mock-data'
import {
  resolveDateRange,
  filterByDateRange,
  calculateMetrics,
  aggregateChartData,
  buildAccountSnapshots,
  buildUsdtBalanceTimeSeries,
  buildTokenBalanceTimeSeries,
} from '@/lib/calculations'
import Header from '@/components/layout/Header'
import PeriodSelector from '@/components/ui/PeriodSelector'
import BalanceLineChart from '@/components/charts/BalanceLineChart'
import PnlHistogramChart from '@/components/charts/PnlHistogramChart'
import { formatMoney } from '@/lib/utils'

// All 7 sub-account IDs
const ALL_IDS = EXCHANGES.flatMap((ex) => ex.subAccounts.map((sa) => sa.id))

// Unique trading pairs derived from ACCOUNT_PRIMARY_TOKEN values
const ALL_PAIRS = [...new Set(Object.values(ACCOUNT_PRIMARY_TOKEN).map((t) => `${t}/USDT`))].sort()

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit:   '#FF6B2C',
  okx:     '#4F8EF7',
}

function ExchangeLogo({ id }: { id: string }) {
  if (id === 'binance') return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M16 4l3.09 3.09L12.18 14l-3.09-3.09L16 4z" fill="#F0B90B" />
      <path d="M20.91 8.91L24 12l-7.09 7.09L9.82 12l3.09-3.09 4 4 4-4z" fill="#F0B90B" />
      <path d="M4 16l3.09-3.09L10.18 16l-3.09 3.09L4 16z" fill="#F0B90B" />
      <path d="M21.82 16l3.09-3.09L28 16l-3.09 3.09L21.82 16z" fill="#F0B90B" />
      <path d="M16 28l-3.09-3.09L19.82 18l3.09 3.09L16 28z" fill="#F0B90B" />
      <path d="M16 12.91L19.09 16 16 19.09 12.91 16 16 12.91z" fill="#F0B90B" />
    </svg>
  )
  if (id === 'bybit') return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="4" fill="#FF6B2C" fillOpacity="0.15" />
      <text x="7" y="23" fontSize="18" fontWeight="800" fontFamily="Arial,sans-serif" fill="#FF6B2C">B</text>
    </svg>
  )
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="2" fill="#4F8EF7" />
      <rect x="18" y="2" width="12" height="12" rx="2" fill="#4F8EF7" />
      <rect x="10" y="10" width="12" height="12" rx="2" fill="#4F8EF7" fillOpacity="0.6" />
      <rect x="2" y="18" width="12" height="12" rx="2" fill="#4F8EF7" />
      <rect x="18" y="18" width="12" height="12" rx="2" fill="#4F8EF7" />
    </svg>
  )
}

function Delta({ value, isToken = false }: { value: number; isToken?: boolean }) {
  const isPos = value >= 0
  const color = isPos ? 'var(--accent-profit)' : 'var(--accent-loss)'
  const sign  = isPos ? '+' : ''
  const formatted = isToken ? `${sign}${value.toFixed(4)}` : `${sign}${formatMoney(value)}`
  return <span className="font-mono text-xs tabular font-semibold" style={{ color }}>{formatted}</span>
}

const TIMEFRAME_OPTIONS: { label: string; value: Timeframe }[] = [
  { label: 'Day',   value: 'daily' },
  { label: 'Week',  value: 'weekly' },
  { label: 'Month', value: 'monthly' },
]

export default function ResultsPage() {
  const [period, setPeriod]             = useState<Period>('1Y')
  const [customRange, setCustomRange]   = useState<DateRange | undefined>()
  const [pairFilter, setPairFilter]     = useState<string>('all')
  const [checkedIds, setCheckedIds]     = useState<Set<string>>(new Set(ALL_IDS))
  const [pnlTimeframe, setPnlTimeframe] = useState<Timeframe>('monthly')

  const handlePeriodChange = (p: Period, range?: DateRange) => {
    setPeriod(p)
    setCustomRange(range)
  }

  const toggleId = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size === 1) return prev // keep at least one checked
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allChecked   = checkedIds.size === ALL_IDS.length
  const toggleAll    = () => setCheckedIds(allChecked ? new Set([ALL_IDS[0]]) : new Set(ALL_IDS))

  const dateRange = useMemo<DateRange>(() => {
    if (period === 'manual' && customRange) return customRange
    return resolveDateRange(period, '2025-12-31')
  }, [period, customRange])

  const snapshots = useMemo(() => {
    const all = buildAccountSnapshots(dateRange)
    return pairFilter === 'all'
      ? all
      : all.filter((s) => `${s.token}/USDT` === pairFilter)
  }, [dateRange, pairFilter])

  // Visible snapshots = filtered by pair AND checked
  const visibleSnapshots = useMemo(
    () => snapshots.filter((s) => checkedIds.has(s.subAccountId)),
    [snapshots, checkedIds],
  )

  // USDT balance series — only checked accounts
  const usdtSeries = useMemo(
    () => [...checkedIds].map((id) => ({
      subAccountId: id,
      data: buildUsdtBalanceTimeSeries(id, dateRange),
    })),
    [checkedIds, dateRange],
  )

  // Token balance series — only checked accounts
  const tokenSeries = useMemo(
    () => [...checkedIds].map((id) => ({
      subAccountId: id,
      data: buildTokenBalanceTimeSeries(id, dateRange),
    })),
    [checkedIds, dateRange],
  )

  // PnL histogram — only checked accounts, selected timeframe
  const histogramData = useMemo(() => {
    const daily = filterByDateRange(
      getAllDailyPnL().filter((d) => checkedIds.has(d.subAccountId)),
      dateRange,
    )
    return aggregateChartData(daily, pnlTimeframe).map((d) => ({ month: d.period, pnl: d.pnl }))
  }, [checkedIds, dateRange, pnlTimeframe])

  // Header metrics — all daily PnL in range
  const headerMetrics = useMemo(() => {
    const daily = filterByDateRange(getAllDailyPnL(), dateRange)
    return calculateMetrics(daily, [])
  }, [dateRange])

  // Totals
  const totals = useMemo(() => ({
    deltaUsdt: visibleSnapshots.reduce((s, r) => s + r.deltaUsdt, 0),
    fees:      visibleSnapshots.reduce((s, r) => s + r.fees, 0),
    pnl:       visibleSnapshots.reduce((s, r) => s + r.pnl, 0),
  }), [visibleSnapshots])

  const cellBorder = { borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }
  const noBtm      = { borderRight: '1px solid var(--border-subtle)', borderBottom: 'none' }
  const numCell    = 'px-3 py-1.5 text-center font-mono tabular text-xs'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header totalPnl={headerMetrics.totalPnl} annualYield={headerMetrics.annualYield} />

      {/* Controls bar */}
      <div
        className="px-4 py-2 flex items-center gap-4 flex-wrap"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Period</span>
        <PeriodSelector value={period} customRange={customRange} onChange={handlePeriodChange} />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Pair</span>
          <select
            value={pairFilter}
            onChange={(e) => setPairFilter(e.target.value)}
            className="text-xs px-2.5 py-1 outline-none cursor-pointer"
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              borderRadius: 2,
            }}
          >
            <option value="all">All Pairs</option>
            {ALL_PAIRS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <main className="flex-1 pb-6">
        {/* Charts row */}
        {/* Balance charts — side by side */}
        <div className="px-4 pt-3 pb-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* USDT Balance */}
          <div style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="px-4 py-2 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-semibold tracking-wide font-heading" style={{ color: 'var(--text-primary)' }}>USDT BALANCE</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Balance over period per account</p>
            </div>
            <div className="px-3 py-3" style={{ background: 'var(--bg-secondary)' }}>
              <BalanceLineChart series={usdtSeries} height={220} />
            </div>
          </div>

          {/* Token Balance */}
          <div style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="px-4 py-2 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-semibold tracking-wide font-heading" style={{ color: 'var(--text-primary)' }}>TOKEN BALANCE</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Token holdings over period per account</p>
            </div>
            <div className="px-3 py-3" style={{ background: 'var(--bg-secondary)' }}>
              <BalanceLineChart series={tokenSeries} height={220} />
            </div>
          </div>
        </div>

        {/* PnL histogram — full width */}
        <div className="px-4 pb-2">
          <div style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="px-4 py-2 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-semibold tracking-wide font-heading" style={{ color: 'var(--text-primary)' }}>P&L</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>All checked accounts combined</p>
              {/* Timeframe tabs */}
              <div className="ml-auto flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
                {TIMEFRAME_OPTIONS.map((tf) => {
                  const active = pnlTimeframe === tf.value
                  return (
                    <button
                      key={tf.value}
                      onClick={() => setPnlTimeframe(tf.value)}
                      className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors"
                      style={{
                        background: active ? 'var(--bg-elevated)' : 'transparent',
                        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                        borderRight: tf.value !== 'monthly' ? '1px solid var(--border-subtle)' : 'none',
                      }}
                    >
                      {tf.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="px-3 py-3" style={{ background: 'var(--bg-secondary)' }}>
              <PnlHistogramChart data={histogramData} height={220} />
            </div>
          </div>
        </div>

        {/* Balance table */}
        <div className="px-4">
          <div style={{ border: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
            <table className="w-full text-xs border-collapse" style={{ minWidth: 760 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                  {/* Checkbox header */}
                  <th className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)', width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      className="cursor-pointer"
                      style={{ accentColor: 'var(--accent-blue)' }}
                    />
                  </th>
                  {['Exchange', 'Account', 'Token', 'Opening', 'Closing', 'Difference', 'Fees', 'Avg Price', 'PnL'].map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-center text-[10px] uppercase tracking-widest font-semibold"
                      style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snapshots.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      No accounts match the selected pair filter
                    </td>
                  </tr>
                ) : (
                  snapshots.map((snap) => {
                    const exColor  = EXCHANGE_COLORS[snap.exchangeId] ?? 'var(--text-muted)'
                    const ex       = EXCHANGES.find((e) => e.id === snap.exchangeId)
                    const checked  = checkedIds.has(snap.subAccountId)
                    const rowAlpha = checked ? 1 : 0.4

                    return (
                      <React.Fragment key={snap.subAccountId}>
                        {/* USDT row */}
                        <tr
                          key={`${snap.subAccountId}-usdt`}
                          style={{ background: 'var(--bg-secondary)', opacity: rowAlpha }}
                        >
                          {/* Checkbox — spans 2 rows */}
                          <td
                            className="px-3 py-1.5 text-center"
                            rowSpan={2}
                            style={{ borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleId(snap.subAccountId)}
                              className="cursor-pointer"
                              style={{ accentColor: 'var(--accent-blue)' }}
                            />
                          </td>
                          <td className="px-3 py-1.5" style={noBtm}>
                            <div className="flex items-center gap-1.5">
                              <ExchangeLogo id={snap.exchangeId} />
                              <span className="font-bold text-[10px] uppercase tracking-widest" style={{ color: exColor }}>
                                {ex?.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5" style={{ ...noBtm, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                            {snap.accountName}
                          </td>
                          <td className="px-3 py-1.5 text-center" style={noBtm}>
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                              USDT
                            </span>
                          </td>
                          <td className={numCell} style={{ ...noBtm, color: 'var(--text-secondary)' }}>{formatMoney(snap.usdtOpen)}</td>
                          <td className={numCell} style={{ ...noBtm, color: 'var(--text-primary)' }}>{formatMoney(snap.usdtClose)}</td>
                          <td className={numCell} style={noBtm}><Delta value={snap.deltaUsdt} /></td>
                          <td className={numCell} style={{ ...noBtm, color: 'var(--accent-loss)' }}>{formatMoney(snap.fees)}</td>
                          <td className={numCell} style={{ ...noBtm, color: 'var(--text-muted)' }}>—</td>
                          <td className={numCell} style={noBtm}><Delta value={snap.pnl} /></td>
                        </tr>

                        {/* Token row */}
                        <tr
                          key={`${snap.subAccountId}-token`}
                          style={{ background: 'var(--bg-primary)', opacity: rowAlpha }}
                        >
                          <td className="px-3 py-1.5" style={cellBorder} />
                          <td className="px-3 py-1.5" style={cellBorder} />
                          <td className="px-3 py-1.5 text-center" style={cellBorder}>
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5" style={{ background: 'var(--bg-tertiary)', color: exColor, border: `1px solid ${exColor}44` }}>
                              {snap.token}
                            </span>
                          </td>
                          <td className={numCell} style={{ ...cellBorder, color: 'var(--text-secondary)' }}>{snap.tokenOpen.toFixed(4)}</td>
                          <td className={numCell} style={{ ...cellBorder, color: 'var(--text-primary)' }}>{snap.tokenClose.toFixed(4)}</td>
                          <td className={numCell} style={cellBorder}><Delta value={snap.deltaToken} isToken /></td>
                          <td className={numCell} style={{ ...cellBorder, color: 'var(--text-muted)' }}>—</td>
                          <td className={numCell} style={{ ...cellBorder, color: 'var(--text-secondary)' }}>{formatMoney(snap.avgPrice)}</td>
                          <td className={numCell} style={cellBorder}><span style={{ color: 'var(--text-muted)' }}>—</span></td>
                        </tr>
                      </React.Fragment>
                    )
                  })
                )}

                {/* Totals row */}
                {snapshots.length > 0 && (
                  <tr style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-medium)' }}>
                    <td style={{ borderRight: '1px solid var(--border-subtle)' }} />
                    <td
                      colSpan={5}
                      className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold"
                      style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--border-subtle)' }}
                    >
                      Total — {visibleSnapshots.length} account{visibleSnapshots.length !== 1 ? 's' : ''} selected
                    </td>
                    <td className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                      <Delta value={totals.deltaUsdt} />
                    </td>
                    <td className="px-3 py-2 text-center font-mono tabular text-xs" style={{ color: 'var(--accent-loss)', borderRight: '1px solid var(--border-subtle)' }}>
                      {formatMoney(totals.fees)}
                    </td>
                    <td style={{ borderRight: '1px solid var(--border-subtle)' }} />
                    <td className="px-3 py-2 text-center">
                      <Delta value={totals.pnl} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
