import type { Metrics } from '@/lib/types'
import { formatMoney, formatPercent, formatRatio } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, BarChart2, Target, Percent,
  Award, Zap, Scale, DollarSign, Receipt,
} from 'lucide-react'
import type { ReactNode } from 'react'

interface MetricSelectorProps {
  metrics: Metrics
  selected: keyof Metrics
  onSelect: (key: keyof Metrics) => void
}

interface MetricDef {
  key: keyof Metrics
  label: string
  value: string
  trend: 'positive' | 'negative' | 'neutral'
  icon: ReactNode
}

function getCards(m: Metrics): MetricDef[] {
  return [
    {
      key: 'sharpeRatio',
      label: 'Sharpe Ratio',
      value: formatRatio(m.sharpeRatio),
      trend: m.sharpeRatio >= 1 ? 'positive' : m.sharpeRatio >= 0 ? 'neutral' : 'negative',
      icon: <Award className="w-3.5 h-3.5" />,
    },
    {
      key: 'sortinoRatio',
      label: 'Sortino Ratio',
      value: formatRatio(m.sortinoRatio),
      trend: m.sortinoRatio >= 1.5 ? 'positive' : m.sortinoRatio >= 0 ? 'neutral' : 'negative',
      icon: <Zap className="w-3.5 h-3.5" />,
    },
    {
      key: 'maxDrawdown',
      label: 'Max Drawdown',
      value: formatMoney(m.maxDrawdown),
      trend: 'negative',
      icon: <TrendingDown className="w-3.5 h-3.5" />,
    },
    {
      key: 'winRate',
      label: 'Win Rate',
      value: `${m.winRate.toFixed(1)}%`,
      trend: m.winRate >= 55 ? 'positive' : m.winRate >= 45 ? 'neutral' : 'negative',
      icon: <Target className="w-3.5 h-3.5" />,
    },
    {
      key: 'profitFactor',
      label: 'Profit Factor',
      value: formatRatio(m.profitFactor),
      trend: m.profitFactor >= 1.5 ? 'positive' : m.profitFactor >= 1 ? 'neutral' : 'negative',
      icon: <BarChart2 className="w-3.5 h-3.5" />,
    },
    {
      key: 'cagr',
      label: 'CAGR',
      value: `${m.cagr.toFixed(1)}%`,
      trend: m.cagr > 0 ? 'positive' : 'negative',
      icon: <TrendingUp className="w-3.5 h-3.5" />,
    },
    {
      key: 'annualYield',
      label: 'Annual Yield',
      value: formatPercent(m.annualYield),
      trend: m.annualYield > 0 ? 'positive' : 'negative',
      icon: <Percent className="w-3.5 h-3.5" />,
    },
    {
      key: 'riskReward',
      label: 'Risk / Reward',
      value: `${formatRatio(m.riskReward)}x`,
      trend: m.riskReward >= 1.5 ? 'positive' : m.riskReward >= 1 ? 'neutral' : 'negative',
      icon: <Scale className="w-3.5 h-3.5" />,
    },
    {
      key: 'averageWin',
      label: 'Avg Win',
      value: formatMoney(m.averageWin),
      trend: 'positive',
      icon: <DollarSign className="w-3.5 h-3.5" />,
    },
    {
      key: 'totalFees',
      label: 'Total Fees',
      value: formatMoney(m.totalFees),
      trend: 'negative',
      icon: <Receipt className="w-3.5 h-3.5" />,
    },
  ]
}

const TREND_VALUE_COLOR: Record<string, string> = {
  positive: 'var(--accent-profit)',
  negative: 'var(--accent-loss)',
  neutral:  'var(--text-primary)',
}

export default function MetricSelector({ metrics, selected, onSelect }: MetricSelectorProps) {
  const cards = getCards(metrics)

  return (
    <div className="px-4 pt-3 pb-1">
      <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
        Select metric to analyze
      </p>
      <div
        className="grid grid-cols-5 gap-px"
        style={{ background: 'var(--border-subtle)' }}
      >
        {cards.map((card) => {
          const isActive = selected === card.key
          return (
            <button
              key={card.key}
              onClick={() => onSelect(card.key)}
              className="text-left px-3 py-2.5 flex flex-col gap-1.5 transition-colors"
              style={{
                background: isActive ? 'var(--bg-elevated)' : 'var(--bg-secondary)',
                borderBottom: isActive ? `2px solid var(--accent-blue)` : '2px solid transparent',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[9px] font-semibold tracking-widest uppercase"
                  style={{ color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)' }}
                >
                  {card.label}
                </span>
                <span style={{ color: isActive ? 'var(--accent-blue)' : 'var(--border-medium)' }}>
                  {card.icon}
                </span>
              </div>
              <span
                className="font-mono text-lg font-bold leading-none tabular"
                style={{ color: isActive ? TREND_VALUE_COLOR[card.trend] : 'var(--text-secondary)' }}
              >
                {card.value}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
