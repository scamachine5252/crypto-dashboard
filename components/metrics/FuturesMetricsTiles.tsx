import type { FuturesMetrics } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import { DollarSign, Layers, ArrowLeftRight, ShieldAlert, Moon } from 'lucide-react'
import type { ReactNode } from 'react'

interface FuturesMetricsTilesProps {
  metrics: FuturesMetrics
}

interface TileDef {
  label: string
  value: string
  description: string
  icon: ReactNode
  trend: 'positive' | 'negative' | 'neutral'
}

function getTiles(m: FuturesMetrics): TileDef[] {
  return [
    {
      label: 'Funding Rate Costs',
      value: formatMoney(m.totalFundingCost),
      description: 'Cumulative funding paid on futures',
      icon: <DollarSign className="w-3.5 h-3.5" />,
      trend: 'negative',
    },
    {
      label: 'Avg Leverage',
      value: `${m.averageLeverage.toFixed(1)}x`,
      description: 'Mean leverage across futures trades',
      icon: <Layers className="w-3.5 h-3.5" />,
      trend: m.averageLeverage >= 15 ? 'negative' : m.averageLeverage >= 8 ? 'neutral' : 'positive',
    },
    {
      label: 'Long / Short Ratio',
      value: `${m.longShortRatio.toFixed(1)}% L`,
      description: `${(100 - m.longShortRatio).toFixed(1)}% short — directional bias`,
      icon: <ArrowLeftRight className="w-3.5 h-3.5" />,
      trend: 'neutral',
    },
    {
      label: 'Liq. Distance',
      value: `${m.liquidationDistancePct.toFixed(1)}%`,
      description: 'Avg theoretical distance to liquidation',
      icon: <ShieldAlert className="w-3.5 h-3.5" />,
      trend: m.liquidationDistancePct >= 10 ? 'positive' : m.liquidationDistancePct >= 5 ? 'neutral' : 'negative',
    },
    {
      label: 'Overnight Exposure',
      value: String(m.overnightExposureCount),
      description: 'Positions held past midnight UTC',
      icon: <Moon className="w-3.5 h-3.5" />,
      trend: 'neutral',
    },
  ]
}

const TREND_VALUE_COLOR: Record<string, string> = {
  positive: 'var(--accent-profit)',
  negative: 'var(--accent-loss)',
  neutral:  'var(--text-primary)',
}

export default function FuturesMetricsTiles({ metrics }: FuturesMetricsTilesProps) {
  const tiles = getTiles(metrics)

  return (
    <div className="px-4 pb-1">
      {/* Section header */}
      <div
        className="flex items-center gap-3 py-2"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--text-muted)' }}
        >
          Futures Metrics
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Perpetuals &amp; leveraged positions only
        </span>
      </div>

      {/* Tiles */}
      <div
        className="grid grid-cols-5 gap-px"
        style={{ background: 'var(--border-subtle)' }}
      >
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="px-3 py-2.5 flex flex-col gap-1.5"
            style={{
              background: 'var(--bg-secondary)',
              borderLeft: `2px solid ${TREND_VALUE_COLOR[tile.trend]}22`,
            }}
          >
            {/* Label row */}
            <div className="flex items-center justify-between">
              <span
                className="text-[9px] font-semibold tracking-widest uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                {tile.label}
              </span>
              <span style={{ color: 'var(--border-medium)' }}>{tile.icon}</span>
            </div>

            {/* Value */}
            <span
              className="font-mono text-lg font-bold leading-none tabular"
              style={{ color: TREND_VALUE_COLOR[tile.trend] }}
            >
              {tile.value}
            </span>

            {/* Description */}
            <p className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>
              {tile.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
