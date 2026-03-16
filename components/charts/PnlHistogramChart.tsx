'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
} from 'recharts'
import { formatMoney } from '@/lib/utils'

interface PnlHistogramChartProps {
  data: { month: string; pnl: number }[]
  height?: number
}

interface CustomTooltipProps {
  active?: boolean
  label?: string
  payload?: { value: number }[]
}

function CustomTooltip({ active, label, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const pnl = payload[0].value
  const isPos = pnl >= 0
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-medium)',
        borderRadius: 2,
        padding: '8px 12px',
      }}
    >
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </p>
      <span
        style={{
          color: isPos ? 'var(--accent-profit)' : 'var(--accent-loss)',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'var(--font-geist-mono)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {isPos ? '+' : ''}{formatMoney(pnl)}
      </span>
    </div>
  )
}

export default function PnlHistogramChart({ data, height = 240 }: PnlHistogramChartProps) {
  const formatY = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
    return `$${v}`
  }

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs"
        style={{ height, color: 'var(--text-muted)' }}
      >
        No data
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={formatY}
          tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--border-subtle)', fillOpacity: 0.4 }} />
        <ReferenceLine y={0} stroke="var(--border-medium)" strokeDasharray="2 4" />
        <Bar dataKey="pnl" maxBarSize={32} radius={[2, 2, 0, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.pnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)'}
              fillOpacity={0.75}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
