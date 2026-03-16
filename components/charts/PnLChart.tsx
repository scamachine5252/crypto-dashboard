'use client'

import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts'
import type { ChartDataPoint, Timeframe, Period, DateRange } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import PeriodSelector from '@/components/ui/PeriodSelector'

interface PnLChartProps {
  data: ChartDataPoint[]
  timeframe: Timeframe
  onTimeframeChange: (t: Timeframe) => void
  totalPnl: number
  period: Period
  customRange: DateRange | undefined
  onPeriodChange: (p: Period, range?: DateRange) => void
}

interface TooltipProps {
  active?: boolean
  payload?: { payload: ChartDataPoint }[]
  label?: string
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const isPos = d.pnl >= 0
  const isCumPos = d.cumulativePnl >= 0
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-medium)',
        borderRadius: 2,
        padding: '10px 14px',
        minWidth: 180,
      }}
    >
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 5 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Period P&L</span>
        <span style={{ color: isPos ? 'var(--accent-profit)' : 'var(--accent-loss)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', fontVariantNumeric: 'tabular-nums' }}>
          {isPos ? '+' : ''}{formatMoney(d.pnl)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Cumulative</span>
        <span style={{ color: isCumPos ? 'var(--text-primary)' : 'var(--accent-loss)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', fontVariantNumeric: 'tabular-nums' }}>
          {isCumPos ? '+' : ''}{formatMoney(d.cumulativePnl)}
        </span>
      </div>
    </div>
  )
}

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: 'Daily',   value: 'daily' },
  { label: 'Weekly',  value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
]

export default function PnLChart({ data, timeframe, onTimeframeChange, totalPnl, period, customRange, onPeriodChange }: PnLChartProps) {
  const isPositive = totalPnl >= 0
  const GREEN = 'var(--accent-profit)'
  const RED   = 'var(--accent-loss)'
  const areaColor = isPositive ? '#00FF88' : '#FF3B3B'

  const tickInterval = Math.max(1, Math.floor(data.length / 9))

  const formatY = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
    return `$${v}`
  }

  return (
    <div
      className="mx-4 mb-2"
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-4">
          <p
            className="text-xs font-semibold tracking-wide font-heading"
            style={{ color: 'var(--text-primary)' }}
          >
            CUMULATIVE P&L
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Equity curve + period returns
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Period selector */}
          <PeriodSelector value={period} customRange={customRange} onChange={onPeriodChange} />

          {/* Divider */}
          <div className="h-4 w-px" style={{ background: 'var(--border-subtle)' }} />

          {/* Timeframe tabs */}
          <div className="flex items-center gap-px" style={{ border: '1px solid var(--border-subtle)' }}>
            {TIMEFRAMES.map((tf) => {
              const isActive = timeframe === tf.value
              return (
                <button
                  key={tf.value}
                  onClick={() => onTimeframeChange(tf.value)}
                  className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase transition-colors"
                  style={{
                    background: isActive ? 'var(--bg-elevated)' : 'transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    borderRight: tf.value !== 'monthly' ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  {tf.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="px-4 py-3" style={{ background: 'var(--bg-secondary)' }}>
        {data.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
            No data for selected filter
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={areaColor} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={areaColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />

              <XAxis
                dataKey="period"
                tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
              />

              <YAxis
                yAxisId="cum"
                orientation="left"
                tickFormatter={formatY}
                tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
                axisLine={false}
                tickLine={false}
                width={56}
              />

              <YAxis
                yAxisId="period"
                orientation="right"
                tickFormatter={formatY}
                tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-geist-mono)' }}
                axisLine={false}
                tickLine={false}
                width={56}
              />

              <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-medium)', strokeWidth: 1 }} />

              <ReferenceLine yAxisId="cum" y={0} stroke="var(--border-medium)" strokeDasharray="2 4" />

              <Bar yAxisId="period" dataKey="pnl" maxBarSize={5} radius={[1, 1, 0, 0]}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? '#00FF88' : '#FF3B3B'} fillOpacity={0.55} />
                ))}
              </Bar>

              <Area
                yAxisId="cum"
                type="monotone"
                dataKey="cumulativePnl"
                stroke={areaColor}
                strokeWidth={1.5}
                fill="url(#areaGrad)"
                dot={false}
                activeDot={{ r: 3, fill: areaColor, stroke: 'var(--bg-secondary)', strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
