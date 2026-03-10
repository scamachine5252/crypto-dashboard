'use client'

import { EXCHANGES } from '@/lib/mock-data'
import type { FilterState, ExchangeId } from '@/lib/types'
import { cn } from '@/lib/utils'

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
    <div className="bg-[#0a1628] border-b border-[#152035] px-6 py-3 flex flex-wrap items-center gap-4">
      {/* Exchange tabs */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleExchange('all')}
          className={cn(
            'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
            filter.exchangeId === 'all'
              ? 'bg-blue-600 text-white'
              : 'text-[#8ba3c7] hover:text-white hover:bg-[#0f1e32]'
          )}
        >
          All Exchanges
        </button>
        {EXCHANGES.map((ex) => (
          <button
            key={ex.id}
            onClick={() => handleExchange(ex.id)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5',
              filter.exchangeId === ex.id
                ? 'text-white'
                : 'text-[#8ba3c7] hover:text-white hover:bg-[#0f1e32]'
            )}
            style={
              filter.exchangeId === ex.id
                ? { backgroundColor: ex.color + '22', color: ex.color }
                : {}
            }
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: ex.color }}
            />
            {ex.name}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-[#152035] hidden sm:block" />

      {/* Sub-account dropdown */}
      <div className="flex items-center gap-2">
        <span className="text-[#4d6b8e] text-xs">Account:</span>
        <select
          value={filter.subAccountId}
          onChange={(e) => handleSubAccount(e.target.value)}
          disabled={filter.exchangeId === 'all'}
          className="bg-[#0f1e32] border border-[#1a2d45] text-[#e8f0fe] text-xs rounded-md px-3 py-1.5 outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          style={
            selectedExchange && filter.subAccountId !== 'all'
              ? { borderColor: selectedExchange.color + '44' }
              : {}
          }
        >
          <option value="all">All Accounts</option>
          {subAccounts.map((sa) => (
            <option key={sa.id} value={sa.id}>
              {sa.name}
            </option>
          ))}
        </select>
      </div>

      {/* Active filter badge */}
      {(filter.exchangeId !== 'all' || filter.subAccountId !== 'all') && (
        <button
          onClick={() => onChange({ ...filter, exchangeId: 'all', subAccountId: 'all' })}
          className="ml-auto text-[#4d6b8e] hover:text-[#f6465d] text-xs flex items-center gap-1 transition-colors"
        >
          ✕ Clear filter
        </button>
      )}
    </div>
  )
}
