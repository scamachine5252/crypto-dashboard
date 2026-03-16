import type { ConnectionStatus } from '@/lib/types'

interface StatusBadgeProps {
  status: ConnectionStatus
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; color: string; dot: string }> = {
  connected:     { label: 'Connected',     color: 'var(--accent-profit)', dot: 'var(--accent-profit)' },
  error:         { label: 'Error',         color: 'var(--accent-loss)',   dot: 'var(--accent-loss)'   },
  not_configured:{ label: 'Not configured',color: 'var(--text-muted)',    dot: 'var(--border-medium)' },
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { label, color, dot } = STATUS_CONFIG[status]
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: dot }}
      />
      <span
        className="text-[10px] font-semibold uppercase tracking-widest"
        style={{ color }}
      >
        {label}
      </span>
    </span>
  )
}
