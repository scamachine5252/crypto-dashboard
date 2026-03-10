'use client'

import { EXCHANGES } from '@/lib/mock-data'
import type { FilterState, ExchangeId } from '@/lib/types'

interface FilterBarProps {
  filter: FilterState
  onChange: (f: FilterState) => void
}

export default function FilterBar({ filter, onChange }: FilterBarProps) {
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
      {/* Exchange tabs */}
      <div className="flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
        <ExTabBtn
          active={filter.exchangeId === 'all'}
          onClick={() => handleExchange('all')}
          color={undefined}
        >
          All
        </ExTabBtn>
        {EXCHANGES.map((ex) => (
          <ExTabBtn
            key={ex.id}
            active={filter.exchangeId === ex.id}
            onClick={() => handleExchange(ex.id)}
            color={ex.color}
          >
            {ex.name}
          </ExTabBtn>
        ))}
      </div>

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
          className="ml-auto text-[10px] uppercase tracking-widest transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent-loss)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  )
}

function ExTabBtn({
  active, onClick, color, children,
}: {
  active: boolean
  onClick: () => void
  color: string | undefined
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors flex items-center gap-1.5"
      style={{
        background: active ? 'var(--bg-elevated)' : 'transparent',
        color: active ? (color ?? 'var(--text-primary)') : 'var(--text-muted)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      {color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  )
}
