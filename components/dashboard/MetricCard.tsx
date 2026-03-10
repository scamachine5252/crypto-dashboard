import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface MetricCardProps {
  label: string
  value: string
  subValue?: string
  trend?: 'positive' | 'negative' | 'neutral'
  icon?: ReactNode
  description?: string
}

export default function MetricCard({
  label,
  value,
  subValue,
  trend = 'neutral',
  icon,
  description,
}: MetricCardProps) {
  const valueColor =
    trend === 'positive'
      ? 'text-[#0ecb81]'
      : trend === 'negative'
      ? 'text-[#f6465d]'
      : 'text-[#e8f0fe]'

  return (
    <div className="bg-[#0a1628] border border-[#152035] rounded-xl p-4 flex flex-col gap-2 hover:border-[#1a2d45] transition-colors group">
      <div className="flex items-center justify-between">
        <span className="text-[#4d6b8e] text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
        {icon && (
          <span className="text-[#1a2d45] group-hover:text-[#4d6b8e] transition-colors">
            {icon}
          </span>
        )}
      </div>

      <div className="flex items-end gap-2">
        <span className={cn('text-2xl font-bold tabular-nums leading-none', valueColor)}>
          {value}
        </span>
        {subValue && (
          <span className="text-[#4d6b8e] text-xs mb-0.5 leading-none">{subValue}</span>
        )}
      </div>

      {description && (
        <p className="text-[#4d6b8e] text-[11px] leading-relaxed">{description}</p>
      )}
    </div>
  )
}
