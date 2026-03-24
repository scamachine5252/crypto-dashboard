'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import type { FilterState, DateRange, FundSummary, DashboardMetrics, DailyPnLEntry, ExchangeId, Position } from '@/lib/types'
import { getAllDailyPnL, getAllTrades } from '@/lib/mock-data'
import { calculateMetrics, aggregateChartData, resolveDateRange, filterByDateRange } from '@/lib/calculations'
import { formatMoney } from '@/lib/utils'
import Header from '@/components/layout/Header'
import FundCards from '@/components/metrics/FundCards'
import MetricsGrid from '@/components/metrics/MetricsGrid'
import PnLChart from '@/components/charts/PnLChart'
import { RefreshCw, ChevronDown, Check } from 'lucide-react'

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit:   '#FF6B2C',
  okx:     '#4F8EF7',
}

interface AccountMeta {
  id: string
  accountName: string
  exchange: string
  fund: string
}

export default function DashboardPage() {
  const [filter, setFilter] = useState<FilterState>({
    exchangeId: 'all',
    subAccountId: 'all',
    timeframe: 'monthly',
    period: '1Y',
  })
  const [customRange, setCustomRange] = useState<DateRange | undefined>()

  // Real data state
  const [funds, setFunds]             = useState<FundSummary[]>([])
  const [realMetrics, setRealMetrics] = useState<DashboardMetrics | null>(null)
  const [rawDailyPnl, setRawDailyPnl] = useState<Array<{ date: string; pnl: number }>>([])
  const [dataLoading, setDataLoading] = useState(true)

  // Open positions state
  const [positions, setPositions]         = useState<Position[]>([])
  const [posAccounts, setPosAccounts]     = useState<AccountMeta[]>([])
  const [posLoading, setPosLoading]       = useState(true)
  const [posRefreshing, setPosRefreshing] = useState(false)
  const [activeAccIds, setActiveAccIds]   = useState<Set<string>>(new Set())
  const [posDropOpen, setPosDropOpen]     = useState(false)

  const dateRange = useMemo<DateRange>(() => {
    if (filter.period === 'manual' && customRange) return customRange
    return resolveDateRange(filter.period, new Date().toISOString().slice(0, 10))
  }, [filter.period, customRange])

  // Fetch dashboard data when period changes
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const resolved = resolveDateRange(filter.period, today)
    const startStr = filter.period === 'manual' ? (customRange?.start ?? '') : (resolved.start ?? '')
    const since = startStr ? new Date(startStr).getTime() : 0

    setDataLoading(true)
    fetch(`/api/dashboard?since=${since}`)
      .then((r) => r.json())
      .then((data: { funds: FundSummary[]; metrics: DashboardMetrics; rawDailyPnl?: Array<{ date: string; pnl: number }> }) => {
        setFunds(data.funds ?? [])
        setRealMetrics(data.metrics ?? null)
        setRawDailyPnl(data.rawDailyPnl ?? [])
      })
      .catch(() => { /* keep previous data */ })
      .finally(() => setDataLoading(false))
  }, [filter.period, customRange])

  // Fetch positions on mount
  const fetchPositions = useCallback((isRefresh = false) => {
    if (isRefresh) setPosRefreshing(true)
    else setPosLoading(true)

    fetch('/api/positions')
      .then((r) => r.json())
      .then((data: { positions?: Position[]; accounts?: AccountMeta[] }) => {
        setPositions(data.positions ?? [])
        const accs = data.accounts ?? []
        setPosAccounts(accs)
        setActiveAccIds(new Set(accs.map((a) => a.id)))
      })
      .catch(() => {})
      .finally(() => {
        setPosLoading(false)
        setPosRefreshing(false)
      })
  }, [])

  useEffect(() => { fetchPositions() }, [fetchPositions])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-pos-dropdown]')) setPosDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const allDaily  = useMemo(() => getAllDailyPnL(), [])
  const allTrades = useMemo(() => getAllTrades(), [])
  const daily     = useMemo(() => filterByDateRange(allDaily, dateRange), [allDaily, dateRange])

  const metrics = useMemo(() => {
    if (realMetrics) {
      return {
        sharpeRatio: realMetrics.sharpeRatio,
        sortinoRatio: realMetrics.sortinoRatio,
        maxDrawdown: realMetrics.maxDrawdown,
        maxDrawdownPct: 0,
        winRate: realMetrics.winRate,
        profitFactor: realMetrics.profitFactor,
        cagr: realMetrics.cagr,
        annualYield: realMetrics.annualYield,
        riskReward: realMetrics.riskRewardRatio,
        averageWin: realMetrics.avgWin,
        averageLoss: realMetrics.avgLoss,
        totalFees: realMetrics.totalFees,
        totalPnl: realMetrics.totalPnl,
        totalTrades: realMetrics.totalTrades,
      }
    }
    return calculateMetrics(daily, allTrades)
  }, [realMetrics, daily, allTrades])

  const chartData = useMemo(() => {
    if (rawDailyPnl.length > 0) {
      const entries: DailyPnLEntry[] = rawDailyPnl.map(({ date, pnl }) => ({
        date,
        subAccountId: 'all',
        exchangeId: 'binance' as ExchangeId,
        pnl,
        cumulativePnl: 0,
      }))
      return aggregateChartData(entries, filter.timeframe)
    }
    return aggregateChartData(daily, filter.timeframe)
  }, [rawDailyPnl, daily, filter.timeframe])

  const handlePeriodChange = (period: FilterState['period'], range?: DateRange) => {
    setFilter((f) => ({ ...f, period }))
    setCustomRange(range)
  }

  // Filtered positions
  const filteredPositions = useMemo(
    () => positions.filter((p) => activeAccIds.has(p.accountId)),
    [positions, activeAccIds],
  )

  const totalUnrealizedPnl = filteredPositions.reduce((s, p) => s + p.unrealizedPnl, 0)
  const totalNotional      = filteredPositions.reduce((s, p) => s + p.notional, 0)

  const togglePosAccount = (id: string) => {
    setActiveAccIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { if (next.size > 1) next.delete(id) }
      else next.add(id)
      return next
    })
  }

  // Group accounts by exchange for the dropdown
  const exchangeGroups = useMemo(() => {
    const groups: Record<string, AccountMeta[]> = {}
    for (const acc of posAccounts) {
      if (!groups[acc.exchange]) groups[acc.exchange] = []
      groups[acc.exchange].push(acc)
    }
    return groups
  }, [posAccounts])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Fund cards */}
      <FundCards funds={funds} loading={dataLoading} />

      <main className="flex-1 pt-2 pb-6">
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

        {/* ── Open Positions ── */}
        <div className="mx-6 mt-4">
          {/* Section header */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Open Positions
              </p>
              {!posLoading && (
                <div className="flex items-center gap-4 mt-1">
                  <span className="text-xs flex items-center gap-1.5">
                    <span style={{ color: 'var(--text-muted)' }}>Unrealized PnL</span>
                    <span
                      className="font-mono font-semibold tabular-nums"
                      style={{ color: totalUnrealizedPnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)' }}
                    >
                      {totalUnrealizedPnl >= 0 ? '+' : ''}{formatMoney(totalUnrealizedPnl)}
                    </span>
                  </span>
                  <span className="text-xs flex items-center gap-1.5">
                    <span style={{ color: 'var(--text-muted)' }}>Notional</span>
                    <span className="font-mono font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {formatMoney(totalNotional)}
                    </span>
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {filteredPositions.length} position{filteredPositions.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Account filter dropdown */}
              {posAccounts.length > 0 && (
                <div className="relative" data-pos-dropdown>
                  <button
                    onClick={() => setPosDropOpen((v) => !v)}
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
                      {activeAccIds.size}/{posAccounts.length}
                    </span>
                    <ChevronDown
                      className="w-3 h-3"
                      style={{ color: 'var(--text-muted)', transform: posDropOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                    />
                  </button>

                  {posDropOpen && (
                    <div
                      className="absolute top-full right-0 mt-1 z-50 py-1"
                      style={{
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-medium)',
                        minWidth: 200,
                        borderRadius: 2,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                      }}
                      data-pos-dropdown
                    >
                      <div className="flex items-center gap-3 px-3 py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <button
                          onClick={() => setActiveAccIds(new Set(posAccounts.map((a) => a.id)))}
                          className="text-[10px] uppercase tracking-widest"
                          style={{ color: 'var(--accent-blue)' }}
                        >
                          All
                        </button>
                        <button
                          onClick={() => posAccounts.length > 0 && setActiveAccIds(new Set([posAccounts[0].id]))}
                          className="text-[10px] uppercase tracking-widest"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Reset
                        </button>
                      </div>
                      {Object.entries(exchangeGroups).map(([exchange, accs]) => {
                        const exColor = EXCHANGE_COLORS[exchange] ?? '#888'
                        return (
                          <div key={exchange}>
                            <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: exColor }}>
                              {exchange}
                            </p>
                            {accs.map((acc) => {
                              const on = activeAccIds.has(acc.id)
                              return (
                                <button
                                  key={acc.id}
                                  onClick={() => togglePosAccount(acc.id)}
                                  className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-left"
                                  style={{ color: on ? 'var(--text-primary)' : 'var(--text-muted)' }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)' }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                                >
                                  <span
                                    className="w-3 h-3 border flex items-center justify-center shrink-0"
                                    style={{
                                      borderColor: on ? exColor : 'var(--border-medium)',
                                      background:  on ? exColor : 'transparent',
                                      borderRadius: 2,
                                    }}
                                  >
                                    {on && <Check className="w-2 h-2" style={{ color: '#000' }} />}
                                  </span>
                                  {acc.accountName}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Refresh button */}
              <button
                onClick={() => fetchPositions(true)}
                disabled={posRefreshing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 disabled:opacity-50"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                  borderRadius: 2,
                }}
              >
                <RefreshCw className={`w-3 h-3 ${posRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Positions table */}
          {posLoading ? (
            <div className="space-y-px" style={{ borderLeft: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-11 animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
              ))}
            </div>
          ) : filteredPositions.length === 0 ? (
            <div
              className="flex items-center justify-center py-10"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderTop: 'none',
              }}
            >
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {positions.length === 0 ? 'No open positions' : 'No positions for selected accounts'}
              </p>
            </div>
          ) : (
            <div
              className="overflow-x-auto"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderTop: 'none' }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {['Symbol', 'Side', 'Size', 'Entry Price', 'Mark Price', 'Notional', 'Unrealized PnL', 'Leverage', 'Margin', 'Account'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left font-medium whitespace-nowrap"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPositions.map((pos, i) => {
                    const exColor  = EXCHANGE_COLORS[pos.exchange] ?? '#888'
                    const pnlColor = pos.unrealizedPnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)'
                    return (
                      <tr
                        key={`${pos.accountId}-${pos.symbol}-${i}`}
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <td className="px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                          {pos.symbol}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              background: pos.side === 'long' ? 'rgba(0,255,65,0.08)' : 'rgba(255,68,68,0.08)',
                              color: pos.side === 'long' ? 'var(--accent-profit)' : 'var(--accent-loss)',
                            }}
                          >
                            {pos.side}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {pos.size.toFixed(4)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap font-mono" style={{ color: 'var(--text-secondary)' }}>
                          {formatMoney(pos.entryPrice)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap font-mono" style={{ color: 'var(--text-primary)' }}>
                          {formatMoney(pos.markPrice)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap font-mono" style={{ color: 'var(--text-secondary)' }}>
                          {formatMoney(pos.notional)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap font-semibold font-mono" style={{ color: pnlColor }}>
                          {pos.unrealizedPnl >= 0 ? '+' : ''}{formatMoney(pos.unrealizedPnl)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {pos.leverage.toFixed(1)}x
                        </td>
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap font-mono" style={{ color: 'var(--text-secondary)' }}>
                          {formatMoney(pos.margin)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: exColor }} />
                            <span className="capitalize font-medium" style={{ color: exColor }}>{pos.exchange}</span>
                            <span style={{ color: 'var(--border-medium)' }}>/</span>
                            <span style={{ color: 'var(--text-secondary)' }}>{pos.accountName}</span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
