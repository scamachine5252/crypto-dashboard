'use client'

import React, { useState, useMemo, useEffect } from 'react'
import type { Period, DateRange, Timeframe, DailyPnLEntry, ExchangeId } from '@/lib/types'
import { resolveDateRange, aggregateChartData } from '@/lib/calculations'
import Header from '@/components/layout/Header'
import PeriodSelector from '@/components/ui/PeriodSelector'
import BalanceLineChart from '@/components/charts/BalanceLineChart'
import PnlHistogramChart from '@/components/charts/PnlHistogramChart'
import { formatMoney } from '@/lib/utils'

const ACCOUNT_PALETTE = [
  '#F0B90B', '#FF6B2C', '#4F8EF7', '#00FF88',
  '#a855f7', '#06b6d4', '#f97316', '#e11d48',
]

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

function Delta({ value }: { value: number }) {
  const isPos = value >= 0
  const color = isPos ? 'var(--accent-profit)' : 'var(--accent-loss)'
  return (
    <span className="font-mono text-xs tabular font-semibold" style={{ color }}>
      {isPos ? '+' : ''}{formatMoney(value)}
    </span>
  )
}

const TIMEFRAME_OPTIONS: { label: string; value: Timeframe }[] = [
  { label: 'Day',   value: 'daily' },
  { label: 'Week',  value: 'weekly' },
  { label: 'Month', value: 'monthly' },
]

type AccountSummary = {
  accountId:   string
  accountName: string
  exchange:    string
  fund:        string
  startUsdt:   number
  endUsdt:     number
  deltaUsdt:   number
  totalFees:   number
  totalPnl:    number
}

type AccountInfo = { id: string; account_name: string; exchange: string; fund: string }

export default function ResultsPage() {
  const [period, setPeriod]           = useState<Period>('1M')
  const [customRange, setCustomRange] = useState<DateRange | undefined>()
  const [pnlTimeframe, setPnlTimeframe] = useState<Timeframe>('daily')

  const [accountSummaries, setAccountSummaries] = useState<AccountSummary[]>([])
  const [balanceHistory, setBalanceHistory]     = useState<{ accountId: string; date: string; usdt: number }[]>([])
  const [dailyPnl, setDailyPnl]                = useState<{ accountId: string; date: string; pnl: number }[]>([])
  const [accounts, setAccounts]                 = useState<AccountInfo[]>([])
  const [checkedIds, setCheckedIds]             = useState<Set<string>>(new Set())
  const [loading, setLoading]                   = useState(true)

  const handlePeriodChange = (p: Period, range?: DateRange) => {
    setPeriod(p)
    setCustomRange(range)
  }

  const toggleId = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size === 1) return prev
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allChecked = checkedIds.size === accounts.length && accounts.length > 0
  const toggleAll  = () => setCheckedIds(
    allChecked ? new Set(accounts.slice(0, 1).map((a) => a.id)) : new Set(accounts.map((a) => a.id))
  )

  // Fetch real data when period changes
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const range = period === 'manual' && customRange ? customRange : resolveDateRange(period, today)
    const since = new Date(range.start).getTime()
    const until = new Date(range.end + 'T23:59:59Z').getTime()

    setLoading(true)
    fetch(`/api/results?since=${since}&until=${until}`)
      .then((r) => r.json())
      .then((data: {
        accounts?: AccountInfo[]
        balanceHistory?: { accountId: string; date: string; usdt: number }[]
        dailyPnl?: { accountId: string; date: string; pnl: number }[]
        accountSummaries?: AccountSummary[]
      }) => {
        setAccounts(data.accounts ?? [])
        setBalanceHistory(data.balanceHistory ?? [])
        setDailyPnl(data.dailyPnl ?? [])
        setAccountSummaries(data.accountSummaries ?? [])
        setCheckedIds(new Set((data.accounts ?? []).map((a) => a.id)))
      })
      .catch(() => { /* keep previous */ })
      .finally(() => setLoading(false))
  }, [period, customRange])

  const colorMap = useMemo(
    () => Object.fromEntries(accounts.map((a, i) => [a.id, ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length]])),
    [accounts],
  )

  const nameMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.account_name])),
    [accounts],
  )

  // USDT balance chart series — checked accounts only
  const usdtSeries = useMemo(
    () => [...checkedIds].map((id) => ({
      subAccountId: id,
      data: balanceHistory
        .filter((b) => b.accountId === id)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((b) => ({ date: b.date, value: b.usdt })),
    })),
    [checkedIds, balanceHistory]
  )

  // PnL histogram — checked accounts combined, selected timeframe
  const histogramData = useMemo(() => {
    const entries: DailyPnLEntry[] = dailyPnl
      .filter((d) => checkedIds.has(d.accountId))
      .map((d) => ({ date: d.date, subAccountId: d.accountId, exchangeId: 'binance' as ExchangeId, pnl: d.pnl, cumulativePnl: 0 }))
    return aggregateChartData(entries, pnlTimeframe).map((d) => ({ month: d.period, pnl: d.pnl }))
  }, [dailyPnl, checkedIds, pnlTimeframe])

  // Visible summaries for totals
  const visibleSummaries = useMemo(
    () => accountSummaries.filter((s) => checkedIds.has(s.accountId)),
    [accountSummaries, checkedIds]
  )

  const totals = useMemo(() => ({
    deltaUsdt: visibleSummaries.reduce((s, r) => s + r.deltaUsdt, 0),
    fees:      visibleSummaries.reduce((s, r) => s + r.totalFees, 0),
    pnl:       visibleSummaries.reduce((s, r) => s + r.totalPnl, 0),
  }), [visibleSummaries])

  const cellBorder = { borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }
  const numCell    = 'px-3 py-2 text-center font-mono tabular text-xs'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Controls bar */}
      <div
        className="px-4 py-2 flex items-center gap-4 flex-wrap"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Period</span>
        <PeriodSelector value={period} customRange={customRange} onChange={handlePeriodChange} />
      </div>

      <main className="flex-1 pb-6">
        {/* Charts row */}
        <div className="px-4 pt-3 pb-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* USDT Balance chart */}
          <BalanceLineChart series={usdtSeries} height={220} colorMap={colorMap} nameMap={nameMap} />

          {/* PnL histogram */}
          <div style={{ border: '1px solid var(--border-subtle)' }}>
            <div className="px-4 py-2 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-semibold tracking-wide font-heading" style={{ color: 'var(--text-primary)' }}>P&L</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>All checked accounts combined</p>
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

        {/* Account table */}
        <div className="px-4">
          <div style={{ border: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
            <table className="w-full text-xs border-collapse" style={{ minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                  <th className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)', width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      className="cursor-pointer"
                      style={{ accentColor: 'var(--accent-blue)' }}
                    />
                  </th>
                  {['Exchange', 'Account', 'Fund', 'Opening', 'Closing', 'Difference', 'Fees', 'PnL'].map((col) => (
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
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      Loading…
                    </td>
                  </tr>
                ) : accountSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      No data for selected period. Run a sync first.
                    </td>
                  </tr>
                ) : (
                  accountSummaries.map((summary) => {
                    const exColor = colorMap[summary.accountId] ?? 'var(--text-muted)'
                    const checked = checkedIds.has(summary.accountId)

                    return (
                      <tr
                        key={summary.accountId}
                        style={{ background: 'var(--bg-secondary)', opacity: checked ? 1 : 0.4, borderBottom: '1px solid var(--border-subtle)' }}
                      >
                        <td className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleId(summary.accountId)}
                            className="cursor-pointer"
                            style={{ accentColor: 'var(--accent-blue)' }}
                          />
                        </td>
                        <td className="px-3 py-2" style={cellBorder}>
                          <div className="flex items-center gap-1.5">
                            <ExchangeLogo id={summary.exchange} />
                            <span className="font-bold text-[10px] uppercase tracking-widest" style={{ color: exColor }}>
                              {summary.exchange}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ ...cellBorder, color: 'var(--text-primary)' }}>
                          {summary.accountName}
                        </td>
                        <td className="px-3 py-2 text-center" style={{ ...cellBorder, color: 'var(--text-muted)', fontSize: 10 }}>
                          {summary.fund || '—'}
                        </td>
                        <td className={numCell} style={{ ...cellBorder, color: 'var(--text-secondary)' }}>
                          {formatMoney(summary.startUsdt)}
                        </td>
                        <td className={numCell} style={{ ...cellBorder, color: 'var(--text-primary)' }}>
                          {formatMoney(summary.endUsdt)}
                        </td>
                        <td className={numCell} style={cellBorder}><Delta value={summary.deltaUsdt} /></td>
                        <td className={numCell} style={{ ...cellBorder, color: 'var(--accent-loss)' }}>
                          {formatMoney(summary.totalFees)}
                        </td>
                        <td className={numCell} style={cellBorder}><Delta value={summary.totalPnl} /></td>
                      </tr>
                    )
                  })
                )}

                {/* Totals row */}
                {accountSummaries.length > 0 && (
                  <tr style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-medium)' }}>
                    <td style={{ borderRight: '1px solid var(--border-subtle)' }} />
                    <td
                      colSpan={5}
                      className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold"
                      style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--border-subtle)' }}
                    >
                      Total — {visibleSummaries.length} account{visibleSummaries.length !== 1 ? 's' : ''} selected
                    </td>
                    <td className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                      <Delta value={totals.deltaUsdt} />
                    </td>
                    <td className="px-3 py-2 text-center font-mono tabular text-xs" style={{ color: 'var(--accent-loss)', borderRight: '1px solid var(--border-subtle)' }}>
                      {formatMoney(totals.fees)}
                    </td>
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
