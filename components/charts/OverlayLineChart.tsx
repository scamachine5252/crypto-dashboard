'use client'

import { useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { MetricTimeSeries } from '@/lib/types'
import { ACCOUNT_COLORS, EXCHANGES } from '@/lib/mock-data'
import { formatMoney } from '@/lib/utils'
import { aggregateOverlayData } from '@/lib/calculations'

type ChartTimeframe = 'daily' | 'weekly' | 'monthly'

interface OverlayLineChartProps {
  data: MetricTimeSeries[]  // output of buildOverlayData — date + one key per active account
  activeIds: string[]       // controls which Lines are rendered and in what order
  height?: number           // chart area height in px, default 320
  colorMap?: Record<string, string>  // optional: account ID → color override
  nameMap?: Record<string, string>   // optional: account ID → display name override
}

const ACCOUNT_NAMES: Record<string, string> = {}
EXCHANGES.forEach((ex) => ex.subAccounts.forEach((sa) => { ACCOUNT_NAMES[sa.id] = sa.name }))

function formatY(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${v < 0 ? '-' : ''}$${(abs / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

interface TooltipPayloadItem {
  dataKey: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  nameMap?: Record<string, string>
}

function CustomTooltip({ active, payload, label, nameMap: nm }: CustomTooltipProps) {
  if (!active || !payload?.length) return null

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-medium)',
        borderRadius: 2,
        padding: '10px 14px',
        minWidth: 200,
      }}
    >
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </p>
      {payload
        .slice()
        .sort((a, b) => b.value - a.value)
        .map((item) => (
          <div key={item.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
            <span style={{ color: item.color, fontSize: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 2, background: item.color, display: 'inline-block', borderRadius: 1 }} />
              {nm?.[item.dataKey] ?? ACCOUNT_NAMES[item.dataKey] ?? item.dataKey}
            </span>
            <span style={{ color: 'var(--text-primary)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {item.value >= 0 ? '+' : ''}{formatMoney(item.value)}
            </span>
          </div>
        ))}
    </div>
  )
}

export default function OverlayLineChart({ data, activeIds, height = 320, colorMap, nameMap }: OverlayLineChartProps) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('weekly')

  // Aggregate into the selected timeframe
  const aggregated = aggregateOverlayData(data, timeframe)

  // Re-normalize so the first point is always 0 for every account,
  // regardless of timeframe (weekly/monthly buckets don't start at 0 after aggregation)
  const chartData: MetricTimeSeries[] = aggregated.map((row, i) => {
    if (i === 0) return row
    const first = aggregated[0]
    const normalized: MetricTimeSeries = { date: row.date }
    for (const key of Object.keys(row)) {
      if (key === 'date') continue
      normalized[key] = (row[key] as number) - (first[key] as number ?? 0)
    }
    return normalized
  })

  if (data.length === 0 || activeIds.length === 0) {
    return (
      <div
        className="mx-4 mb-4 flex items-center justify-center"
        style={{ height, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data for selected period</p>
      </div>
    )
  }

  return (
    <div className="mx-4 mb-4" style={{ border: '1px solid var(--border-subtle)' }}>
      {/* Chart header */}
      <div
        className="px-4 py-2.5 flex items-center gap-3 flex-wrap"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <p
          className="text-xs font-semibold tracking-wide uppercase font-heading"
          style={{ color: 'var(--text-primary)' }}
        >
          Equity Curves
        </p>

        {/* D/W/M timeframe switcher */}
        <div className="flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
          {(['daily', 'weekly', 'monthly'] as ChartTimeframe[]).map((tf, i, arr) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className="px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition-colors"
              style={{
                background:  timeframe === tf ? 'var(--bg-elevated)' : 'transparent',
                color:       timeframe === tf ? 'var(--text-primary)' : 'var(--text-muted)',
                borderRight: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              {tf === 'daily' ? 'D' : tf === 'weekly' ? 'W' : 'M'}
            </button>
          ))}
        </div>

        {/* Inline legend */}
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {activeIds.map((id) => (
            <span key={id} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ width: 16, height: 2, background: colorMap?.[id] ?? ACCOUNT_COLORS[id] ?? '#888', display: 'inline-block', borderRadius: 1 }} />
              {nameMap?.[id] ?? ACCOUNT_NAMES[id] ?? id}
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="px-2 py-3" style={{ background: 'var(--bg-secondary)' }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />

            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />

            <YAxis
              tickFormatter={formatY}
              tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
              axisLine={false}
              tickLine={false}
              width={62}
            />

            <ReferenceLine y={0} stroke="var(--border-medium)" strokeDasharray="4 4" strokeWidth={1} />

            <Tooltip content={<CustomTooltip nameMap={nameMap} />} cursor={{ stroke: 'var(--border-medium)', strokeWidth: 1 }} />

            {activeIds.map((id) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                stroke={colorMap?.[id] ?? ACCOUNT_COLORS[id] ?? '#888'}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
