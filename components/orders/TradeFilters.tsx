'use client'

import { EXCHANGES } from '@/lib/mock-data'
import type { HistoryFilterState, ExchangeId, TradeType, TradeSide } from '@/lib/types'

const MOCK_TODAY = '2025-12-31'
const MAX_DAYS = 180

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function subDays(dateStr: string, days: number): string {
  return addDays(dateStr, -days)
}

function capEnd(start: string, end: string): string {
  const max = addDays(start, MAX_DAYS)
  return end > max ? max : end
}

interface TradeFiltersProps {
  filter: HistoryFilterState
  onChange: (patch: Partial<HistoryFilterState>) => void
}

const QUICK_PERIODS: { label: string; days: number }[] = [
  { label: 'Day',  days: 1 },
  { label: 'Week', days: 7 },
  { label: 'Month', days: 30 },
  { label: '180D', days: 180 },
]

const selectStyle = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-medium)',
  color: 'var(--text-primary)',
  borderRadius: 2,
}

export default function TradeFilters({ filter, onChange }: TradeFiltersProps) {
  const selectedExchange =
    filter.exchangeId !== 'all' ? EXCHANGES.find((e) => e.id === filter.exchangeId) : null

  const subAccounts =
    filter.exchangeId === 'all'
      ? []
      : EXCHANGES.find((e) => e.id === filter.exchangeId)?.subAccounts ?? []

  const maxEnd = addDays(filter.dateRange.start, MAX_DAYS)
  const isAtMaxRange = filter.dateRange.end >= maxEnd

  const handleExchange = (id: ExchangeId | 'all') => {
    onChange({ exchangeId: id, subAccountId: 'all', page: 1 })
  }

  const handleSymbol = (raw: string) => {
    onChange({ symbol: raw.toUpperCase(), page: 1 })
  }

  const handleStartDate = (start: string) => {
    onChange({ dateRange: { start, end: capEnd(start, filter.dateRange.end) }, page: 1 })
  }

  const handleEndDate = (end: string) => {
    onChange({ dateRange: { start: filter.dateRange.start, end }, page: 1 })
  }

  const handleQuickPeriod = (days: number) => {
    const end = MOCK_TODAY
    const start = subDays(end, days - 1)
    onChange({ dateRange: { start, end }, page: 1 })
  }

  const activeQuickDays = QUICK_PERIODS.find(({ days }) => {
    const expectedStart = subDays(MOCK_TODAY, days - 1)
    return filter.dateRange.end === MOCK_TODAY && filter.dateRange.start === expectedStart
  })?.days ?? null

  return (
    <div
      className="px-4 py-2 flex flex-wrap items-center gap-3"
      style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      {/* Exchange dropdown */}
      <select
        value={filter.exchangeId}
        onChange={(e) => handleExchange(e.target.value as ExchangeId | 'all')}
        className="text-xs px-2.5 py-1 outline-none cursor-pointer"
        style={{
          ...selectStyle,
          border: `1px solid ${selectedExchange ? selectedExchange.color + '44' : 'var(--border-medium)'}`,
          color: selectedExchange ? selectedExchange.color : 'var(--text-primary)',
        }}
      >
        <option value="all">All Exchanges</option>
        {EXCHANGES.map((ex) => (
          <option key={ex.id} value={ex.id}>{ex.name}</option>
        ))}
      </select>

      {/* Account dropdown */}
      <select
        value={filter.subAccountId}
        onChange={(e) => onChange({ subAccountId: e.target.value, page: 1 })}
        disabled={filter.exchangeId === 'all'}
        className="text-xs px-2.5 py-1 outline-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        style={{
          ...selectStyle,
          border: `1px solid ${selectedExchange && filter.subAccountId !== 'all' ? selectedExchange.color + '44' : 'var(--border-medium)'}`,
        }}
      >
        <option value="all">All Accounts</option>
        {subAccounts.map((sa) => (
          <option key={sa.id} value={sa.id}>{sa.name}</option>
        ))}
      </select>

      {/* Symbol input */}
      <input
        type="text"
        value={filter.symbol}
        onChange={(e) => handleSymbol(e.target.value)}
        placeholder="Symbol (BTC/USDT)"
        className="text-xs px-2.5 py-1 outline-none w-36"
        style={selectStyle}
      />

      {/* Section dropdown (Spot / Futures) */}
      <select
        value={filter.tradeType}
        onChange={(e) => onChange({ tradeType: e.target.value as TradeType, page: 1 })}
        className="text-xs px-2.5 py-1 outline-none cursor-pointer"
        style={selectStyle}
      >
        <option value="spot">Spot</option>
        <option value="futures">Futures</option>
      </select>

      {/* Side dropdown */}
      <select
        value={filter.side}
        onChange={(e) => onChange({ side: e.target.value as TradeSide | 'all', page: 1 })}
        className="text-xs px-2.5 py-1 outline-none cursor-pointer"
        style={selectStyle}
      >
        <option value="all">All Sides</option>
        <option value="long">Long</option>
        <option value="short">Short</option>
      </select>

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        {/* Quick-period buttons */}
        <div className="flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
          {QUICK_PERIODS.map(({ label, days }) => {
            const active = activeQuickDays === days
            return (
              <button
                key={label}
                onClick={() => handleQuickPeriod(days)}
                className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors"
                style={{
                  background: active ? 'var(--bg-elevated)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderRight: label !== '180D' ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        <input
          type="date"
          value={filter.dateRange.start}
          max={filter.dateRange.end}
          onChange={(e) => handleStartDate(e.target.value)}
          className="text-xs px-2 py-1 outline-none"
          style={selectStyle}
        />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
        <input
          type="date"
          value={filter.dateRange.end}
          min={filter.dateRange.start}
          max={maxEnd}
          onChange={(e) => handleEndDate(e.target.value)}
          className="text-xs px-2 py-1 outline-none"
          style={selectStyle}
        />
        {isAtMaxRange && (
          <span
            className="text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--accent-gold)' }}
          >
            Max 180d
          </span>
        )}
      </div>
    </div>
  )
}
