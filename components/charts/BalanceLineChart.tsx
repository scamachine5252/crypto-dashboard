'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { ACCOUNT_COLORS } from '@/lib/mock-data'
import { formatMoney } from '@/lib/utils'

interface BalanceSeries {
  subAccountId: string
  data: { date: string; value: number }[]
}

interface BalanceLineChartProps {
  series: BalanceSeries[]
  height?: number
  colorMap?: Record<string, string>
  nameMap?: Record<string, string>
}

interface TooltipPayloadItem {
  dataKey: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  label?: string
  payload?: TooltipPayloadItem[]
  nameMap?: Record<string, string>
}

function CustomTooltip({ active, label, payload, nameMap }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-medium)',
        borderRadius: 2,
        padding: '8px 12px',
        minWidth: 160,
      }}
    >
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </p>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 3 }}>
          <span style={{ color: p.color, fontSize: 10 }}>{nameMap?.[p.dataKey] ?? p.dataKey}</span>
          <span style={{ color: 'var(--text-primary)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

// Merge all series into recharts-friendly format: [{ date, id1: val, id2: val }]
function mergeData(series: BalanceSeries[]): Record<string, number | string>[] {
  if (series.length === 0) return []

  // Use first series as date scaffold
  return series[0].data.map((entry, i) => {
    const point: Record<string, number | string> = { date: entry.date }
    for (const s of series) {
      point[s.subAccountId] = s.data[i]?.value ?? 0
    }
    return point
  })
}

export default function BalanceLineChart({ series, height = 240, colorMap, nameMap }: BalanceLineChartProps) {
  const data = mergeData(series)

  const formatY = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
    return `$${v}`
  }

  const tickInterval = Math.max(1, Math.floor((data.length) / 8))

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
    <div style={{ border: '1px solid var(--border-subtle)' }}>
      {/* Chart header with legend */}
      <div
        className="px-4 py-2.5 flex items-center gap-3 flex-wrap"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <p
          className="text-xs font-semibold tracking-wide uppercase font-heading"
          style={{ color: 'var(--text-primary)' }}
        >
          USDT Balance
        </p>
        <div className="ml-auto flex items-center gap-4 flex-wrap">
          {series.map((s) => (
            <span key={s.subAccountId} className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
              <span style={{ width: 20, height: 2.5, background: colorMap?.[s.subAccountId] ?? ACCOUNT_COLORS[s.subAccountId] ?? 'var(--accent-blue)', display: 'inline-block', borderRadius: 1 }} />
              {nameMap?.[s.subAccountId] ?? s.subAccountId}
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ background: 'var(--bg-secondary)', padding: '12px 8px' }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
            />
            <YAxis
              tickFormatter={formatY}
              tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip content={<CustomTooltip nameMap={nameMap} />} cursor={{ stroke: 'var(--border-medium)', strokeWidth: 1 }} />
            {series.map((s) => (
              <Line
                key={s.subAccountId}
                type="monotone"
                dataKey={s.subAccountId}
                stroke={colorMap?.[s.subAccountId] ?? ACCOUNT_COLORS[s.subAccountId] ?? 'var(--accent-blue)'}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, stroke: 'var(--bg-secondary)', strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
