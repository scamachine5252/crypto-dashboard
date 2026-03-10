import type { ReactNode } from 'react'

interface MetricCardProps {
  label: string
  value: string
  subValue?: string
  trend?: 'positive' | 'negative' | 'neutral'
  icon?: ReactNode
  description?: string
}

const TREND_COLOR: Record<string, string> = {
  positive: 'var(--accent-profit)',
  negative: 'var(--accent-loss)',
  neutral:  'var(--text-primary)',
}

const TREND_BORDER: Record<string, string> = {
  positive: 'var(--accent-profit)',
  negative: 'var(--accent-loss)',
  neutral:  'var(--border-medium)',
}

export default function MetricCard({
  label,
  value,
  subValue,
  trend = 'neutral',
  icon,
  description,
}: MetricCardProps) {
  return (
    <div
      className="px-3 py-2.5 flex flex-col gap-1.5 transition-colors"
      style={{
        background: 'var(--bg-secondary)',
        borderTop: `1px solid var(--border-subtle)`,
        borderRight: `1px solid var(--border-subtle)`,
        borderBottom: `1px solid var(--border-subtle)`,
        borderLeft: `2px solid ${TREND_BORDER[trend]}`,
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'
      }}
    >
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span
          className="text-[9px] font-semibold tracking-widest uppercase"
          style={{ color: 'var(--text-muted)' }}
        >
          {label}
        </span>
        {icon && (
          <span style={{ color: 'var(--border-medium)' }}>
            {icon}
          </span>
        )}
      </div>

      {/* Value row */}
      <div className="flex items-baseline gap-1.5">
        <span
          className="font-mono text-xl font-bold leading-none tabular"
          style={{ color: TREND_COLOR[trend] }}
        >
          {value}
        </span>
        {subValue && (
          <span
            className="font-mono text-xs leading-none"
            style={{ color: 'var(--text-muted)' }}
          >
            {subValue}
          </span>
        )}
      </div>

      {/* Description */}
      {description && (
        <p className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}
    </div>
  )
}
