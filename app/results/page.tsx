'use client'

import React, { useState, useMemo, useEffect } from 'react'
import type { Period, DateRange } from '@/lib/types'
import { resolveDateRange } from '@/lib/calculations'
import Header from '@/components/layout/Header'
import PeriodSelector from '@/components/ui/PeriodSelector'
import BalanceLineChart, { type TransactionMarker } from '@/components/charts/BalanceLineChart'
import { formatMoney } from '@/lib/utils'
import { Download } from 'lucide-react'

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

type AccountSummary = {
  accountId:     string
  accountName:   string
  exchange:      string
  fund:          string
  startUsdt:     number
  endUsdt:       number
  deltaUsdt:     number
  netDeposits:   number
  tradingResult: number
  totalFees:     number
  totalPnl:      number
}

type AccountInfo = { id: string; account_name: string; exchange: string; fund: string }

export default function ResultsPage() {
  const [period, setPeriod]           = useState<Period>('inception')
  const [customRange, setCustomRange] = useState<DateRange | undefined>()

  const [accountSummaries, setAccountSummaries] = useState<AccountSummary[]>([])
  const [balanceHistory, setBalanceHistory]     = useState<{ accountId: string; date: string; usdt: number }[]>([])
  const [navHistory, setNavHistory]             = useState<{ accountId: string; date: string; nav: number }[]>([])
  const [accounts, setAccounts]                 = useState<AccountInfo[]>([])
  const [checkedIds, setCheckedIds]             = useState<Set<string>>(new Set())
  const [loading, setLoading]                   = useState(true)
  const [transactions, setTransactions]         = useState<Array<{
    id: string; account_id: string; exchange: string; type: 'deposit'|'withdrawal'
    asset: string; amount: number; fee: number|null; status: string|null
    tx_id: string|null; recorded_at: string
  }>>([])
  const [inceptionDate, setInceptionDate] = useState<string | undefined>()

  // Fetch inception date once on mount
  useEffect(() => {
    fetch('/api/inception')
      .then((r) => r.json())
      .then((d: { date?: string }) => { if (d.date) setInceptionDate(d.date) })
      .catch(() => {})
  }, [])

  const handlePeriodChange = (p: Period, range?: DateRange) => {
    setPeriod(p)
    setCustomRange(range)
  }

  const dateRange = useMemo<DateRange>(() => {
    if (period === 'manual' && customRange) return customRange
    const today = new Date().toISOString().slice(0, 10)
    return resolveDateRange(period, today, inceptionDate)
  }, [period, customRange, inceptionDate])

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
    const range = period === 'manual' && customRange ? customRange : resolveDateRange(period, today, inceptionDate)
    const since = new Date(range.start).getTime()
    const until = new Date(range.end + 'T23:59:59Z').getTime()

    setLoading(true)
    fetch(`/api/results?since=${since}&until=${until}`)
      .then((r) => r.json())
      .then((data: {
        accounts?: AccountInfo[]
        balanceHistory?: { accountId: string; date: string; usdt: number }[]
        navHistory?: { accountId: string; date: string; nav: number }[]
        accountSummaries?: AccountSummary[]
      }) => {
        const accs = data.accounts ?? []
        setAccounts(accs)
        setBalanceHistory(data.balanceHistory ?? [])
        setNavHistory(data.navHistory ?? [])
        setAccountSummaries(data.accountSummaries ?? [])
        setCheckedIds(new Set(accs.map((a) => a.id)))

        // Fetch transactions for this period
        if (accs.length > 0) {
          const ids = accs.map((a) => a.id).join(',')
          fetch(`/api/transactions?account_ids=${ids}&since=${new Date(range.start).toISOString()}&until=${new Date(range.end + 'T23:59:59Z').toISOString()}`)
            .then(r => r.json())
            .then((d: { transactions?: typeof transactions }) => setTransactions(d.transactions ?? []))
            .catch(() => {})
        }
      })
      .catch(() => { /* keep previous */ })
      .finally(() => setLoading(false))
  }, [period, customRange, inceptionDate])

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

  // NAV chart series — checked accounts only
  const navSeries = useMemo(
    () => [...checkedIds].map((id) => ({
      subAccountId: id,
      data: navHistory
        .filter((n) => n.accountId === id)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((n) => ({ date: n.date, value: n.nav })),
    })),
    [checkedIds, navHistory]
  )

  // Visible summaries for totals
  const visibleSummaries = useMemo(
    () => accountSummaries.filter((s) => checkedIds.has(s.accountId)),
    [accountSummaries, checkedIds]
  )

  const totals = useMemo(() => ({
    deltaUsdt:     visibleSummaries.reduce((s, r) => s + r.deltaUsdt, 0),
    netDeposits:   visibleSummaries.reduce((s, r) => s + r.netDeposits, 0),
    tradingResult: visibleSummaries.reduce((s, r) => s + r.tradingResult, 0),
    fees:          visibleSummaries.reduce((s, r) => s + r.totalFees, 0),
    pnl:           visibleSummaries.reduce((s, r) => s + r.totalPnl, 0),
    netPnl:        visibleSummaries.reduce((s, r) => s + r.totalPnl + r.totalFees, 0),
  }), [visibleSummaries])

  // Transaction markers (for potential future use on balance chart)
  const txMarkers = useMemo<TransactionMarker[]>(
    () => transactions
      .filter(t => checkedIds.has(t.account_id))
      .map(t => ({
        date:   t.recorded_at.slice(0, 10),
        type:   t.type,
        amount: t.amount,
        asset:  t.asset,
      })),
    [transactions, checkedIds]
  )

  // Visible transactions for the table
  const visibleTx = useMemo(
    () => transactions.filter(t => checkedIds.has(t.account_id)),
    [transactions, checkedIds]
  )

  const cellBorder = { borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }
  const numCell    = 'px-3 py-2 text-center font-mono tabular text-xs'

  function exportNavCsv() {
    const rows: string[] = ['Date,Account,NAV']
    const sorted = [...navSeries].sort((a, b) => a.subAccountId.localeCompare(b.subAccountId))
    for (const s of sorted) {
      const name = nameMap[s.subAccountId] ?? s.subAccountId
      for (const { date, value } of s.data) {
        rows.push(`${date},${name},${value.toFixed(6)}`)
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nav_${dateRange.start}_${dateRange.end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Controls bar */}
      <div
        className="px-4 py-2 flex items-center gap-4 flex-wrap"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Period</span>
        <PeriodSelector value={period} customRange={customRange} defaultRange={dateRange} inceptionDate={inceptionDate} onChange={handlePeriodChange} />
      </div>

      <main className="flex-1 pb-6">
        {/* USDT Balance chart — full width */}
        <div className="px-4 pt-3 pb-2">
          <BalanceLineChart series={usdtSeries} height={240} colorMap={colorMap} nameMap={nameMap} transactions={txMarkers} />
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
                  {['Exchange', 'Account', 'Fund', 'Opening', 'Closing', 'Difference', 'Net Deposits', 'Trading Result', 'Fees', 'Gross PnL', 'Net PnL'].map((col) => (
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
                    <td colSpan={12} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      Loading…
                    </td>
                  </tr>
                ) : accountSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
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
                        <td className={numCell} style={cellBorder}><Delta value={summary.netDeposits} /></td>
                        <td className={numCell} style={cellBorder}><Delta value={summary.tradingResult} /></td>
                        <td className={numCell} style={{ ...cellBorder, color: 'var(--accent-loss)' }}>
                          {formatMoney(summary.totalFees)}
                        </td>
                        <td className={numCell} style={cellBorder}><Delta value={summary.totalPnl} /></td>
                        <td className={numCell} style={{ ...cellBorder, fontWeight: 600 }}><Delta value={summary.totalPnl + summary.totalFees} /></td>
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
                    <td className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                      <Delta value={totals.netDeposits} />
                    </td>
                    <td className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                      <Delta value={totals.tradingResult} />
                    </td>
                    <td className="px-3 py-2 text-center font-mono tabular text-xs" style={{ color: 'var(--accent-loss)', borderRight: '1px solid var(--border-subtle)' }}>
                      {formatMoney(totals.fees)}
                    </td>
                    <td className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                      <Delta value={totals.pnl} />
                    </td>
                    <td className="px-3 py-2 text-center" style={{ fontWeight: 600 }}>
                      <Delta value={totals.netPnl} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* NAV chart — below table, replaces P&L histogram */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-end mb-1">
            <button
              onClick={exportNavCsv}
              disabled={navSeries.length === 0}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-semibold px-2.5 py-1 disabled:opacity-30"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border-medium)', background: 'var(--bg-elevated)' }}
            >
              <Download className="w-3 h-3" />
              Export NAV CSV
            </button>
          </div>
          <BalanceLineChart series={navSeries} height={220} colorMap={colorMap} nameMap={nameMap} mode="nav" />
        </div>

        {visibleTx.length > 0 && (
          <div className="px-4 pt-4">
            <div style={{ border: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
              <div
                className="px-4 py-2 text-xs font-semibold tracking-wide uppercase font-heading"
                style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', background: 'var(--bg-secondary)' }}
              >
                Deposits &amp; Withdrawals
              </div>
              <table className="w-full text-xs border-collapse" style={{ minWidth: 560 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                    {['Date', 'Account', 'Type', 'Asset', 'Amount', 'Fee', 'Status'].map((col) => (
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
                  {visibleTx.map((tx) => {
                    const isDeposit = tx.type === 'deposit'
                    const amtColor  = isDeposit ? 'var(--accent-profit)' : 'var(--accent-loss)'
                    const accName   = nameMap[tx.account_id] ?? tx.account_id.slice(0, 8)
                    return (
                      <tr key={tx.id} style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                        <td className="px-3 py-2 text-center font-mono text-[11px]" style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                          {tx.recorded_at.slice(0, 10)}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--text-primary)', borderRight: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>
                          {accName}
                        </td>
                        <td className="px-3 py-2 text-center" style={{ borderRight: '1px solid var(--border-subtle)' }}>
                          <span
                            className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                            style={{ background: isDeposit ? 'rgba(0,255,136,0.12)' : 'rgba(255,59,59,0.12)', color: amtColor, borderRadius: 2 }}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-[11px]" style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-subtle)' }}>
                          {tx.asset}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular text-[11px] font-semibold" style={{ color: amtColor, borderRight: '1px solid var(--border-subtle)' }}>
                          {isDeposit ? '+' : '-'}{Number(tx.amount).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular text-[11px]" style={{ color: 'var(--text-muted)', borderRight: '1px solid var(--border-subtle)' }}>
                          {tx.fee != null ? Number(tx.fee).toFixed(4) : '—'}
                        </td>
                        <td className="px-3 py-2 text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {tx.status ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
