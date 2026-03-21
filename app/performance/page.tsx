'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import type { Period, DateRange, AccountMetricsRow } from '@/lib/types'
import { EXCHANGES, getAllDailyPnL, ACCOUNT_COLORS } from '@/lib/mock-data'
import { useAccountToggles } from '@/hooks/useAccountToggles'
import {
  resolveDateRange,
  buildOverlayData,
  buildPerAccountMetrics,
} from '@/lib/calculations'
import { formatMoney } from '@/lib/utils'
import Header from '@/components/layout/Header'
import PeriodSelector from '@/components/ui/PeriodSelector'
import OverlayLineChart from '@/components/charts/OverlayLineChart'
import { ChevronDown, Check } from 'lucide-react'

type L1Tab = 'spot' | 'futures'
type SpotL2 = 'overview' | 'returns' | 'risk' | 'costs'
type FuturesL2 = 'overview' | 'returns' | 'risk-exposure' | 'cost' | 'execution'

interface ColDef {
  key: string
  label: string
  format: (v: number) => string
  lowerBetter?: boolean
  sum?: boolean  // sum in totals row; otherwise avg
}

const SPOT_L2_TABS: { id: SpotL2; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'returns',  label: 'Returns' },
  { id: 'risk',     label: 'Risk' },
  { id: 'costs',    label: 'Costs' },
]

const FUTURES_L2_TABS: { id: FuturesL2; label: string }[] = [
  { id: 'overview',      label: 'Overview' },
  { id: 'returns',       label: 'Returns' },
  { id: 'risk-exposure', label: 'Risk & Exposure' },
  { id: 'cost',          label: 'Cost' },
  { id: 'execution',     label: 'Execution' },
]

const SPOT_COLS: Record<SpotL2, ColDef[]> = {
  overview: [
    { key: 'totalPnl',       label: 'Total PnL',      format: (v) => formatMoney(v),        sum: true },
    { key: 'annualYield',    label: 'Annual Yield',    format: (v) => `${v.toFixed(1)}%` },
    { key: 'sharpeRatio',    label: 'Sharpe',          format: (v) => v.toFixed(2) },
    { key: 'winRate',        label: 'Win Rate',        format: (v) => `${v.toFixed(1)}%` },
    { key: 'profitFactor',   label: 'Profit Factor',   format: (v) => v.toFixed(2) },
    { key: 'riskReward',     label: 'R/R',             format: (v) => v.toFixed(2) },
    { key: 'maxDrawdownPct', label: 'Max DD %',        format: (v) => `${v.toFixed(1)}%`,   lowerBetter: true },
    { key: 'recoveryFactor', label: 'Recovery Factor', format: (v) => v.toFixed(2) },
    { key: 'totalFees',      label: 'Total Fees',      format: (v) => formatMoney(v),        lowerBetter: true, sum: true },
    { key: 'feesAsPctOfPnl', label: 'Fees % PnL',     format: (v) => `${v.toFixed(1)}%`,   lowerBetter: true },
  ],
  returns: [
    { key: 'totalPnl',     label: 'Total PnL',    format: (v) => formatMoney(v),        sum: true },
    { key: 'annualYield',  label: 'Annual Yield',  format: (v) => `${v.toFixed(1)}%` },
    { key: 'cagr',         label: 'CAGR',          format: (v) => `${v.toFixed(1)}%` },
    { key: 'sharpeRatio',  label: 'Sharpe',        format: (v) => v.toFixed(2) },
    { key: 'sortinoRatio', label: 'Sortino',       format: (v) => v.toFixed(2) },
    { key: 'winRate',      label: 'Win Rate',      format: (v) => `${v.toFixed(1)}%` },
    { key: 'profitFactor', label: 'Profit Factor', format: (v) => v.toFixed(2) },
    { key: 'riskReward',   label: 'R/R',           format: (v) => v.toFixed(2) },
    { key: 'averageWin',   label: 'Avg Win',       format: (v) => formatMoney(v) },
    { key: 'averageLoss',  label: 'Avg Loss',      format: (v) => formatMoney(v) },
  ],
  risk: [
    { key: 'maxDrawdown',    label: 'Max DD $',        format: (v) => formatMoney(v),      lowerBetter: true, sum: true },
    { key: 'maxDrawdownPct', label: 'Max DD %',        format: (v) => `${v.toFixed(1)}%`, lowerBetter: true },
    { key: 'riskReward',     label: 'R/R',             format: (v) => v.toFixed(2) },
    { key: 'recoveryFactor', label: 'Recovery Factor', format: (v) => v.toFixed(2) },
  ],
  costs: [
    { key: 'totalFees',      label: 'Total Fees',      format: (v) => formatMoney(v),      lowerBetter: true, sum: true },
    { key: 'avgFeePerTrade', label: 'Avg Fee/Trade',   format: (v) => formatMoney(v),      lowerBetter: true },
    { key: 'feesAsPctOfPnl', label: 'Fees % PnL',     format: (v) => `${v.toFixed(1)}%`,  lowerBetter: true },
  ],
}

const FUTURES_COLS: Record<FuturesL2, ColDef[]> = {
  overview: [
    { key: 'totalPnl',               label: 'Total PnL',        format: (v) => formatMoney(v),        sum: true },
    { key: 'annualYield',            label: 'Annual Yield',     format: (v) => `${v.toFixed(1)}%` },
    { key: 'winRate',                label: 'Win Rate',         format: (v) => `${v.toFixed(1)}%` },
    { key: 'riskReward',             label: 'R/R',              format: (v) => v.toFixed(2) },
    { key: 'averageLeverage',        label: 'Avg Leverage',     format: (v) => `${v.toFixed(1)}x` },
    { key: 'longShortRatio',         label: 'Long/Short',       format: (v) => `${v.toFixed(1)}%` },
    { key: 'liquidationDistancePct', label: 'Liq. Distance',    format: (v) => `${v.toFixed(1)}%` },
    { key: 'totalFundingCost',       label: 'Funding Cost',     format: (v) => formatMoney(v),        lowerBetter: true, sum: true },
    { key: 'avgFundingPerTrade',     label: 'Avg Funding/Trade',format: (v) => formatMoney(v),        lowerBetter: true },
    { key: 'rolloverCosts',          label: 'Rollover Costs',   format: (v) => formatMoney(v),        lowerBetter: true, sum: true },
    { key: 'avgHoldingMin',          label: 'Avg Holding Time', format: (v) => `${v.toFixed(0)}m` },
    { key: 'openInterest',           label: 'Open Interest',    format: (v) => formatMoney(v) },
    { key: 'liquidationsCount',      label: 'Liquidations',     format: (v) => v.toFixed(0),          lowerBetter: true, sum: true },
  ],
  returns: [
    { key: 'totalPnl',    label: 'Total PnL',   format: (v) => formatMoney(v),        sum: true },
    { key: 'annualYield', label: 'Annual Yield', format: (v) => `${v.toFixed(1)}%` },
    { key: 'winRate',     label: 'Win Rate',     format: (v) => `${v.toFixed(1)}%` },
    { key: 'riskReward',  label: 'Risk/Reward',  format: (v) => v.toFixed(2) },
  ],
  'risk-exposure': [
    { key: 'averageLeverage',        label: 'Avg Leverage',  format: (v) => `${v.toFixed(1)}x` },
    { key: 'longShortRatio',         label: 'Long/Short',    format: (v) => `${v.toFixed(1)}%` },
    { key: 'liquidationDistancePct', label: 'Liq. Distance', format: (v) => `${v.toFixed(1)}%` },
  ],
  cost: [
    { key: 'totalFundingCost',   label: 'Funding Rate Costs', format: (v) => formatMoney(v), lowerBetter: true, sum: true },
    { key: 'avgFundingPerTrade', label: 'Avg Funding/Trade',  format: (v) => formatMoney(v), lowerBetter: true },
    { key: 'rolloverCosts',      label: 'Rollover Costs',     format: (v) => formatMoney(v), lowerBetter: true, sum: true },
  ],
  execution: [
    { key: 'avgHoldingMin',     label: 'Avg Holding Time',   format: (v) => `${v.toFixed(0)}m` },
    { key: 'openInterest',      label: 'Open Interest',      format: (v) => formatMoney(v) },
    { key: 'liquidationsCount', label: 'Liquidations Count', format: (v) => v.toFixed(0),       lowerBetter: true, sum: true },
  ],
}

function getValue(row: AccountMetricsRow, key: string, l1: L1Tab): number {
  if (l1 === 'futures') {
    const fromFutures = (row.futuresMetrics as unknown as Record<string, number>)[key]
    if (fromFutures !== undefined) return fromFutures
    const fromMetrics = (row.metrics as unknown as Record<string, number>)[key]
    if (fromMetrics !== undefined) return fromMetrics
    return row.extras[key] ?? 0
  }
  return (row.metrics as unknown as Record<string, number>)[key] ?? 0
}

function extremes(rows: AccountMetricsRow[], key: string, l1: L1Tab, lowerBetter = false) {
  if (rows.length < 2) return { best: NaN, worst: NaN }
  const vals = rows.map((r) => getValue(r, key, l1))
  return lowerBetter
    ? { best: Math.min(...vals), worst: Math.max(...vals) }
    : { best: Math.max(...vals), worst: Math.min(...vals) }
}

export default function PerformancePage() {
  const [period, setPeriod]           = useState<Period>('1Y')
  const [customRange, setCustomRange] = useState<DateRange | undefined>()
  const [l1, setL1]                   = useState<L1Tab>('spot')
  const [spotL2, setSpotL2]           = useState<SpotL2>('overview')
  const [futuresL2, setFuturesL2]     = useState<FuturesL2>('overview')
  const [acctOpen, setAcctOpen]       = useState(false)
  const dropdownRef                   = useRef<HTMLDivElement>(null)

  const { activeIds, toggleAccount, toggleExchange, selectAll, reset } = useAccountToggles()

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAcctOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const dateRange = useMemo<DateRange>(() => {
    if (period === 'manual' && customRange) return customRange
    return resolveDateRange(period, '2025-12-31')
  }, [period, customRange])

  const handlePeriodChange = useCallback((p: Period, range?: DateRange) => {
    setPeriod(p)
    setCustomRange(range)
  }, [])

  const rows = useMemo(
    () => buildPerAccountMetrics([...activeIds], dateRange, l1),
    [activeIds, dateRange, l1],
  )

  const overlayData = useMemo(
    () => buildOverlayData(getAllDailyPnL(), [...activeIds], dateRange),
    [activeIds, dateRange],
  )

  const cols      = l1 === 'spot' ? SPOT_COLS[spotL2] : FUTURES_COLS[futuresL2]
  const l2Tabs    = l1 === 'spot' ? SPOT_L2_TABS : FUTURES_L2_TABS
  const currentL2 = l1 === 'spot' ? spotL2 : futuresL2

  const colExtremes = useMemo(
    () => cols.map((col) => extremes(rows, col.key, l1, col.lowerBetter)),
    [cols, rows, l1],
  )

  const totalsRow = useMemo(() => {
    if (rows.length === 0) return null
    const result: Record<string, number> = {}
    for (const col of cols) {
      const vals = rows.map((r) => getValue(r, col.key, l1))
      result[col.key] = col.sum
        ? vals.reduce((a, b) => a + b, 0)
        : vals.reduce((a, b) => a + b, 0) / vals.length
    }
    return result
  }, [rows, cols, l1])

  const totalAccounts = EXCHANGES.reduce((s, ex) => s + ex.subAccounts.length, 0)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Controls bar */}
      <div
        className="px-4 py-2 flex items-center gap-3 flex-wrap"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <PeriodSelector value={period} customRange={customRange} onChange={handlePeriodChange} />

        <div style={{ width: 1, height: 16, background: 'var(--border-subtle)' }} />

        {/* Accounts dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setAcctOpen((v) => !v)}
            className="flex items-center gap-2 text-xs px-3 py-1.5"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              borderRadius: 2,
            }}
          >
            <span>Accounts</span>
            <span
              className="text-[10px] font-bold px-1.5 rounded"
              style={{ background: 'var(--accent-blue)', color: '#fff' }}
            >
              {activeIds.size}/{totalAccounts}
            </span>
            <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-muted)', transform: acctOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>

          {acctOpen && (
            <div
              className="absolute top-full left-0 mt-1 z-50 py-1"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-medium)',
                minWidth: 220,
                borderRadius: 2,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
            >
              <div className="flex items-center gap-3 px-3 py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <button onClick={selectAll} className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--accent-blue)' }}>All</button>
                <button onClick={reset}    className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Reset</button>
              </div>
              {EXCHANGES.map((ex) => (
                <div key={ex.id}>
                  <button
                    onClick={() => toggleExchange(ex.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-left"
                    style={{ color: ex.color }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: ex.color }} />
                    {ex.name}
                  </button>
                  {ex.subAccounts.map((sa) => {
                    const on    = activeIds.has(sa.id)
                    const color = ACCOUNT_COLORS[sa.id] ?? ex.color
                    return (
                      <button
                        key={sa.id}
                        onClick={() => toggleAccount(sa.id)}
                        className="w-full flex items-center gap-2 px-5 py-1.5 text-xs text-left"
                        style={{ color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)' }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <span
                          className="w-3 h-3 border flex items-center justify-center shrink-0"
                          style={{
                            borderColor: on ? color : 'var(--border-medium)',
                            background:  on ? color : 'transparent',
                            borderRadius: 2,
                          }}
                        >
                          {on && <Check className="w-2 h-2" style={{ color: '#000' }} />}
                        </span>
                        {sa.name}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* L1 tabs: SPOT / FUTURES */}
      <div
        className="px-4 flex items-center gap-1"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        {(['spot', 'futures'] as L1Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setL1(tab)}
            className="px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all my-1"
            style={{
              background: l1 === tab ? 'var(--accent-profit)' : 'transparent',
              color:      l1 === tab ? '#000' : 'var(--text-muted)',
              borderRadius: 2,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* L2 tabs */}
      <div
        className="px-4 flex items-center"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        {(l2Tabs as { id: string; label: string }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() =>
              l1 === 'spot'
                ? setSpotL2(tab.id as SpotL2)
                : setFuturesL2(tab.id as FuturesL2)
            }
            className="px-3 py-2.5 text-xs font-medium transition-colors"
            style={{
              color:        currentL2 === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: currentL2 === tab.id ? '2px solid var(--accent-profit)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main className="flex-1 pb-6">
        {/* Per-account metrics table */}
        {rows.length > 0 ? (
          <div
            className="mx-6 mt-4 overflow-x-auto"
            style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th
                    className="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                    style={{ color: 'var(--text-muted)', minWidth: 160, background: 'var(--bg-secondary)' }}
                  >
                    Account
                  </th>
                  {cols.map((col) => (
                    <th
                      key={col.key}
                      className="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const exColor   = EXCHANGES.find((e) => e.id === row.exchangeId)?.color ?? '#888'
                  const acctColor = ACCOUNT_COLORS[row.subAccountId] ?? exColor
                  return (
                    <tr
                      key={row.subAccountId}
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: acctColor }} />
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{row.accountName}</span>
                          <span className="text-[9px] uppercase font-bold" style={{ color: exColor }}>{row.exchangeId}</span>
                        </span>
                      </td>
                      {cols.map((col, ci) => {
                        const val     = getValue(row, col.key, l1)
                        const { best, worst } = colExtremes[ci]
                        const isBest  = rows.length > 1 && val === best
                        const isWorst = rows.length > 1 && val === worst && best !== worst
                        return (
                          <td
                            key={col.key}
                            className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap"
                            style={{
                              fontFamily: 'var(--font-geist-mono)',
                              color:      isBest  ? 'var(--accent-profit)'
                                        : isWorst ? 'var(--accent-loss)'
                                        : 'var(--text-secondary)',
                              background: isBest  ? 'rgba(0,255,136,0.06)'
                                        : isWorst ? 'rgba(255,59,59,0.06)'
                                        : 'transparent',
                            }}
                          >
                            {col.format(val)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}

                {/* Totals / averages row */}
                {totalsRow && (
                  <tr style={{ borderTop: '1px solid var(--border-medium)', background: 'var(--bg-elevated)' }}>
                    <td
                      className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {rows.length > 1 ? 'Total / Avg' : 'Total'}
                    </td>
                    {cols.map((col) => (
                      <td
                        key={col.key}
                        className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold"
                        style={{ fontFamily: 'var(--font-geist-mono)', color: 'var(--text-primary)' }}
                      >
                        {col.format(totalsRow[col.key])}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            className="mx-6 mt-4 flex items-center justify-center py-10"
            style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
          >
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data for selected period</p>
          </div>
        )}

        {/* Equity curves chart */}
        <div className="mt-4">
          <OverlayLineChart
            data={overlayData}
            activeIds={[...activeIds]}
            height={280}
          />
        </div>
      </main>
    </div>
  )
}
