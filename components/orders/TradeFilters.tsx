'use client'

import type { ReactNode } from 'react'
import { EXCHANGES } from '@/lib/mock-data'
import type { HistoryFilterState, ExchangeId, TradeType, TradeSide } from '@/lib/types'

const MAX_DAYS = 180

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function capEnd(start: string, end: string): string {
  const max = addDays(start, MAX_DAYS)
  return end > max ? max : end
}

interface TradeFiltersProps {
  filter: HistoryFilterState
  onChange: (patch: Partial<HistoryFilterState>) => void
}

const TRADE_TYPES: { label: string; value: TradeType | 'all' }[] = [
  { label: 'All',     value: 'all' },
  { label: 'Spot',    value: 'spot' },
  { label: 'Futures', value: 'futures' },
  { label: 'Options', value: 'options' },
]

const SIDES: { label: string; value: TradeSide | 'all'; color?: string }[] = [
  { label: 'All',   value: 'all' },
  { label: 'Long',  value: 'long',  color: 'var(--accent-profit)' },
  { label: 'Short', value: 'short', color: 'var(--accent-loss)' },
]

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

  return (
    <div
      className="px-4 py-2 flex flex-wrap items-center gap-3"
      style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      {/* Exchange tabs */}
      <div className="flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
        <TabBtn active={filter.exchangeId === 'all'} onClick={() => handleExchange('all')}>
          All
        </TabBtn>
        {EXCHANGES.map((ex) => (
          <TabBtn
            key={ex.id}
            active={filter.exchangeId === ex.id}
            onClick={() => handleExchange(ex.id)}
            accentColor={ex.color}
          >
            {ex.name}
          </TabBtn>
        ))}
      </div>

      {/* Sub-account */}
      <select
        value={filter.subAccountId}
        onChange={(e) => onChange({ subAccountId: e.target.value, page: 1 })}
        disabled={filter.exchangeId === 'all'}
        className="text-xs px-2.5 py-1 outline-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        style={{
          background: 'var(--bg-tertiary)',
          border: `1px solid ${selectedExchange && filter.subAccountId !== 'all' ? selectedExchange.color + '44' : 'var(--border-medium)'}`,
          color: 'var(--text-primary)',
          borderRadius: 2,
        }}
      >
        <option value="all">All Accounts</option>
        {subAccounts.map((sa) => (
          <option key={sa.id} value={sa.id}>{sa.name}</option>
        ))}
      </select>

      {/* Symbol */}
      <input
        type="text"
        value={filter.symbol}
        onChange={(e) => handleSymbol(e.target.value)}
        placeholder="Symbol (BTC/USDT)"
        className="text-xs px-2.5 py-1 outline-none w-36"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-medium)',
          color: 'var(--text-primary)',
          borderRadius: 2,
        }}
      />

      {/* Trade type */}
      <div className="flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
        {TRADE_TYPES.map((t) => (
          <TabBtn
            key={t.value}
            active={filter.tradeType === t.value}
            onClick={() => onChange({ tradeType: t.value, page: 1 })}
          >
            {t.label}
          </TabBtn>
        ))}
      </div>

      {/* Side */}
      <div className="flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
        {SIDES.map((s) => (
          <TabBtn
            key={s.value}
            active={filter.side === s.value}
            onClick={() => onChange({ side: s.value, page: 1 })}
            accentColor={s.color}
          >
            {s.label}
          </TabBtn>
        ))}
      </div>

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={filter.dateRange.start}
          max={filter.dateRange.end}
          onChange={(e) => handleStartDate(e.target.value)}
          className="text-xs px-2 py-1 outline-none"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            colorScheme: 'dark',
            borderRadius: 2,
          }}
        />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
        <input
          type="date"
          value={filter.dateRange.end}
          min={filter.dateRange.start}
          max={maxEnd}
          onChange={(e) => handleEndDate(e.target.value)}
          className="text-xs px-2 py-1 outline-none"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            colorScheme: 'dark',
            borderRadius: 2,
          }}
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

// ---------------------------------------------------------------------------
// Shared tab button
// ---------------------------------------------------------------------------
function TabBtn({
  active,
  onClick,
  accentColor,
  children,
}: {
  active: boolean
  onClick: () => void
  accentColor?: string
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors flex items-center gap-1.5"
      style={{
        background: active ? 'var(--bg-elevated)' : 'transparent',
        color: active ? (accentColor ?? 'var(--text-primary)') : 'var(--text-muted)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      {accentColor && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: accentColor }}
        />
      )}
      {children}
    </button>
  )
}
