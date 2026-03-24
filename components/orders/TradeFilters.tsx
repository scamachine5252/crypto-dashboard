'use client'

import type { HistoryFilterState, ExchangeId, TradeType, TradeSide } from '@/lib/types'

const MAX_DAYS = 180

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit:   '#FF6B2C',
  okx:     '#4F8EF7',
}

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

export interface AccountInfo {
  id: string
  accountName: string
  exchange: string
}

interface TradeFiltersProps {
  filter: HistoryFilterState
  onChange: (patch: Partial<HistoryFilterState>) => void
  accounts: AccountInfo[]
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

export default function TradeFilters({ filter, onChange, accounts }: TradeFiltersProps) {
  const today = new Date().toISOString().slice(0, 10)

  const uniqueExchanges = [...new Set(accounts.map((a) => a.exchange))]
  const selectedColor = filter.exchangeId !== 'all' ? EXCHANGE_COLORS[filter.exchangeId] : undefined
  const subAccounts = filter.exchangeId === 'all'
    ? []
    : accounts.filter((a) => a.exchange === filter.exchangeId)

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
    const end = today
    const start = subDays(end, days - 1)
    onChange({ dateRange: { start, end }, page: 1 })
  }

  const activeQuickDays = QUICK_PERIODS.find(({ days }) => {
    const expectedStart = subDays(today, days - 1)
    return filter.dateRange.end === today && filter.dateRange.start === expectedStart
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
          border: `1px solid ${selectedColor ? selectedColor + '44' : 'var(--border-medium)'}`,
          color: selectedColor ?? 'var(--text-primary)',
        }}
      >
        <option value="all">All Exchanges</option>
        {uniqueExchanges.map((ex) => (
          <option key={ex} value={ex} style={{ color: EXCHANGE_COLORS[ex] }}>
            {ex.charAt(0).toUpperCase() + ex.slice(1)}
          </option>
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
          border: `1px solid ${selectedColor && filter.subAccountId !== 'all' ? selectedColor + '44' : 'var(--border-medium)'}`,
        }}
      >
        <option value="all">All Accounts</option>
        {subAccounts.map((acc) => (
          <option key={acc.id} value={acc.id}>{acc.accountName}</option>
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

      {/* Trade type dropdown */}
      <select
        value={filter.tradeType}
        onChange={(e) => onChange({ tradeType: e.target.value as TradeType | 'all', page: 1 })}
        className="text-xs px-2.5 py-1 outline-none cursor-pointer"
        style={selectStyle}
      >
        <option value="all">All Types</option>
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
