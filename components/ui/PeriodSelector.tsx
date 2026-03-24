'use client'

import { useState } from 'react'
import type { Period, DateRange } from '@/lib/types'

interface PeriodSelectorProps {
  value: Period
  customRange?: DateRange
  onChange: (period: Period, customRange?: DateRange) => void
}

const PERIODS: { value: Period; label: string }[] = [
  { value: '1D',     label: '1D' },
  { value: '1W',     label: 'Week' },
  { value: '1M',     label: 'Month' },
  { value: '1Y',     label: 'Year' },
  { value: 'manual', label: 'Manual' },
]

export default function PeriodSelector({ value, customRange, onChange }: PeriodSelectorProps) {
  const today = new Date().toISOString().slice(0, 10)
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [manualStart, setManualStart] = useState(customRange?.start ?? oneYearAgo)
  const [manualEnd,   setManualEnd]   = useState(customRange?.end   ?? today)

  const handlePeriodClick = (period: Period) => {
    if (period === 'manual') {
      onChange('manual', { start: manualStart, end: manualEnd })
    } else {
      onChange(period)
    }
  }

  const handleManualApply = () => {
    if (manualStart && manualEnd && manualStart <= manualEnd) {
      onChange('manual', { start: manualStart, end: manualEnd })
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Period tabs */}
      <div
        className="flex items-center rounded-lg p-0.5 gap-0.5"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
      >
        {PERIODS.map((p) => {
          const isActive = value === p.value
          return (
            <button
              key={p.value}
              onClick={() => handlePeriodClick(p.value)}
              className="px-3 py-1 rounded-md text-xs font-medium transition-all duration-150"
              style={{
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                border: isActive ? '1px solid var(--border-medium)' : '1px solid transparent',
              }}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Manual date inputs — only visible when manual is selected */}
      {value === 'manual' && (
        <div className="flex items-center gap-1.5 animate-fade-in">
          <input
            type="date"
            value={manualStart}
            max={manualEnd}
            onChange={(e) => setManualStart(e.target.value)}
            className="rounded-md px-2 py-1 text-xs"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              colorScheme: 'dark',
            }}
          />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>→</span>
          <input
            type="date"
            value={manualEnd}
            min={manualStart}
            onChange={(e) => setManualEnd(e.target.value)}
            className="rounded-md px-2 py-1 text-xs"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              colorScheme: 'dark',
            }}
          />
          <button
            onClick={handleManualApply}
            className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
            style={{
              background: 'var(--accent-blue)',
              color: '#fff',
            }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
