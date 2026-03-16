'use client'

import { EXCHANGES } from '@/lib/mock-data'
import type { FilterState, ExchangeId, DateRange, Period } from '@/lib/types'
import PeriodSelector from '@/components/ui/PeriodSelector'

interface FilterBarProps {
  filter: FilterState
  onChange: (f: FilterState) => void
  period: Period
  customRange: DateRange | undefined
  onPeriodChange: (p: Period, range?: DateRange) => void
}

export default function FilterBar({ filter, onChange, period, customRange, onPeriodChange }: FilterBarProps) {
  const selectedExchange =
    filter.exchangeId !== 'all' ? EXCHANGES.find((e) => e.id === filter.exchangeId) : null

  const subAccounts =
    filter.exchangeId === 'all'
      ? []
      : EXCHANGES.find((e) => e.id === filter.exchangeId)?.subAccounts ?? []

  const handleExchange = (id: ExchangeId | 'all') => {
    onChange({ ...filter, exchangeId: id, subAccountId: 'all' })
  }

  const handleSubAccount = (id: string) => {
    onChange({ ...filter, subAccountId: id })
  }

  return (
    <div
      className="px-4 py-1.5 flex flex-wrap items-center gap-3"
      style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      {/* Exchange dropdown */}
      <select
        value={filter.exchangeId}
        onChange={(e) => handleExchange(e.target.value as ExchangeId | 'all')}
        className="text-xs px-2.5 py-1 outline-none cursor-pointer"
        style={{
          background: 'var(--bg-tertiary)',
          border: `1px solid ${selectedExchange ? selectedExchange.color + '44' : 'var(--border-medium)'}`,
          color: selectedExchange ? selectedExchange.color : 'var(--text-primary)',
          borderRadius: 2,
        }}
      >
        <option value="all">All Exchanges</option>
        {EXCHANGES.map((ex) => (
          <option key={ex.id} value={ex.id}>{ex.name}</option>
        ))}
      </select>

      {/* Divider */}
      <div className="h-4 w-px hidden sm:block" style={{ background: 'var(--border-subtle)' }} />

      {/* Sub-account */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Account
        </span>
        <select
          value={filter.subAccountId}
          onChange={(e) => handleSubAccount(e.target.value)}
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
      </div>

      {/* Clear */}
      {(filter.exchangeId !== 'all' || filter.subAccountId !== 'all') && (
        <button
          onClick={() => onChange({ ...filter, exchangeId: 'all', subAccountId: 'all' })}
          className="text-[10px] uppercase tracking-widest transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent-loss)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
        >
          ✕ Clear
        </button>
      )}

      {/* Divider */}
      <div className="h-4 w-px hidden sm:block ml-auto" style={{ background: 'var(--border-subtle)' }} />

      {/* Period selector — prominent, right-aligned */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Period
        </span>
        <div
          className="flex items-center px-2 py-1"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: 2,
          }}
        >
          <PeriodSelector value={period} customRange={customRange} onChange={onPeriodChange} />
        </div>
      </div>
    </div>
  )
}
