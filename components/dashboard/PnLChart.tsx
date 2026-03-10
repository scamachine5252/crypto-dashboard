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
import type { ChartDataPoint, Timeframe } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface PnLChartProps {
  data: ChartDataPoint[]
  timeframe: Timeframe
  onTimeframeChange: (t: Timeframe) => void
  totalPnl: number
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
        background: '#0f1e32',
        border: '1px solid #1a2d45',
        borderRadius: 10,
        padding: '12px 16px',
        minWidth: 180,
      }}
    >
      <p style={{ color: '#8ba3c7', fontSize: 11, marginBottom: 8 }}>{label}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
        <span style={{ color: '#4d6b8e', fontSize: 11 }}>Period P&L</span>
        <span
          style={{
            color: isPos ? '#0ecb81' : '#f6465d',
            fontSize: 13,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {isPos ? '+' : ''}
          {formatMoney(d.pnl)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ color: '#4d6b8e', fontSize: 11 }}>Cumulative</span>
        <span
          style={{
            color: isCumPos ? '#e8f0fe' : '#f6465d',
            fontSize: 13,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {isCumPos ? '+' : ''}
          {formatMoney(d.cumulativePnl)}
        </span>
      </div>
    </div>
  )
}

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
]

export default function PnLChart({ data, timeframe, onTimeframeChange, totalPnl }: PnLChartProps) {
  const isPositive = totalPnl >= 0
  const GREEN = '#0ecb81'
  const RED = '#f6465d'
  const areaColor = isPositive ? GREEN : RED

  const tickInterval = Math.max(1, Math.floor(data.length / 9))

  const formatY = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
    return `$${v}`
  }

  return (
    <div className="mx-6 mb-4 bg-[#0a1628] border border-[#152035] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#152035]">
        <div>
          <p className="text-[#e8f0fe] text-sm font-semibold">Cumulative PnL</p>
          <p className="text-[#4d6b8e] text-xs mt-0.5">Equity curve + period returns</p>
        </div>
        <div className="flex items-center gap-1 bg-[#0f1e32] rounded-lg p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => onTimeframeChange(tf.value)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-all',
                timeframe === tf.value
                  ? 'bg-blue-600 text-white'
                  : 'text-[#8ba3c7] hover:text-white'
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="p-5 pt-4">
        {data.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-[#4d6b8e] text-sm">
            No data for selected filter
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={areaColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={areaColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#152035"
                vertical={false}
              />

              <XAxis
                dataKey="period"
                tick={{ fill: '#4d6b8e', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
              />

              {/* Left Y-axis: cumulative PnL */}
              <YAxis
                yAxisId="cum"
                orientation="left"
                tickFormatter={formatY}
                tick={{ fill: '#4d6b8e', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={60}
              />

              {/* Right Y-axis: period PnL */}
              <YAxis
                yAxisId="period"
                orientation="right"
                tickFormatter={formatY}
                tick={{ fill: '#4d6b8e', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={60}
              />

              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#1a2d45', strokeWidth: 1 }} />

              <ReferenceLine yAxisId="cum" y={0} stroke="#1a2d45" strokeDasharray="3 3" />

              {/* Period PnL bars */}
              <Bar yAxisId="period" dataKey="pnl" maxBarSize={6} radius={[2, 2, 0, 0]}>
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.pnl >= 0 ? GREEN : RED}
                    fillOpacity={0.65}
                  />
                ))}
              </Bar>

              {/* Cumulative PnL area */}
              <Area
                yAxisId="cum"
                type="monotone"
                dataKey="cumulativePnl"
                stroke={areaColor}
                strokeWidth={2}
                fill="url(#areaGrad)"
                dot={false}
                activeDot={{ r: 4, fill: areaColor, stroke: '#0a1628', strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
