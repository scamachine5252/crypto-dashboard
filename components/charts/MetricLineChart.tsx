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
import type { MetricTimeSeries, Metrics } from '@/lib/types'
import { ACCOUNT_COLORS, EXCHANGES } from '@/lib/mock-data'
import { formatMoney, formatRatio, formatPercent } from '@/lib/utils'

interface MetricLineChartProps {
  data: MetricTimeSeries[]
  metric: keyof Metrics
  activeIds: string[]
}

const METRIC_META: Record<keyof Metrics, { label: string; format: (v: number) => string; unit?: string }> = {
  sharpeRatio:   { label: 'Sharpe Ratio',    format: formatRatio },
  sortinoRatio:  { label: 'Sortino Ratio',   format: formatRatio },
  maxDrawdown:   { label: 'Max Drawdown',    format: formatMoney },
  maxDrawdownPct:{ label: 'Max DD %',        format: (v) => `${v.toFixed(1)}%` },
  winRate:       { label: 'Win Rate',        format: (v) => `${v.toFixed(1)}%` },
  profitFactor:  { label: 'Profit Factor',   format: formatRatio },
  cagr:          { label: 'CAGR',            format: (v) => `${v.toFixed(1)}%` },
  annualYield:   { label: 'Annual Yield',    format: (v) => `${v.toFixed(1)}%` },
  riskReward:    { label: 'Risk / Reward',   format: (v) => `${formatRatio(v)}x` },
  averageWin:    { label: 'Avg Win',         format: formatMoney },
  averageLoss:   { label: 'Avg Loss',        format: formatMoney },
  totalFees:     { label: 'Total Fees',      format: formatMoney },
  totalPnl:      { label: 'Total PnL',       format: formatMoney },
  totalTrades:   { label: 'Total Trades',    format: (v) => String(Math.round(v)) },
}

// Friendly account names from exchange config
const ACCOUNT_NAMES: Record<string, string> = {}
EXCHANGES.forEach((ex) => ex.subAccounts.forEach((sa) => { ACCOUNT_NAMES[sa.id] = sa.name }))

interface TooltipPayloadItem {
  dataKey: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  metric: keyof Metrics
}

function CustomTooltip({ active, payload, label, metric }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const fmt = METRIC_META[metric].format

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
              {ACCOUNT_NAMES[item.dataKey] ?? item.dataKey}
            </span>
            <span style={{ color: 'var(--text-primary)', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', fontVariantNumeric: 'tabular-nums' }}>
              {fmt(item.value)}
            </span>
          </div>
        ))}
    </div>
  )
}

export default function MetricLineChart({ data, metric, activeIds }: MetricLineChartProps) {
  const meta = METRIC_META[metric]

  const formatY = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
    if (meta.format === formatRatio) return formatRatio(v)
    return `${v}`
  }

  if (data.length === 0) {
    return (
      <div
        className="mx-4 mb-4 flex items-center justify-center"
        style={{ height: 260, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No data for selected period</p>
      </div>
    )
  }

  return (
    <div className="mx-4 mb-4" style={{ border: '1px solid var(--border-subtle)' }}>
      {/* Chart header */}
      <div
        className="px-4 py-2.5 flex items-center gap-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <p
          className="text-xs font-semibold tracking-wide uppercase font-heading"
          style={{ color: 'var(--text-primary)' }}
        >
          {meta.label}
        </p>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>by account over time</span>

        {/* Inline legend */}
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {activeIds.map((id) => (
            <span key={id} className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ width: 16, height: 2, background: ACCOUNT_COLORS[id] ?? '#888', display: 'inline-block', borderRadius: 1 }} />
              {ACCOUNT_NAMES[id] ?? id}
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="px-2 py-3" style={{ background: 'var(--bg-secondary)' }}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
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
              width={52}
            />

            <Tooltip content={<CustomTooltip metric={metric} />} cursor={{ stroke: 'var(--border-medium)', strokeWidth: 1 }} />

            {activeIds.map((id) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                stroke={ACCOUNT_COLORS[id] ?? '#888'}
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
