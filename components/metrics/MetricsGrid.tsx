import type { Metrics } from '@/lib/types'
import MetricCard from './MetricCard'
import { formatMoney, formatPercent, formatRatio } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, BarChart2, Target, Percent,
  Award, Zap, Scale, DollarSign, Receipt, Activity,
} from 'lucide-react'

interface MetricsGridProps {
  metrics: Metrics
  totalNotional?: number
}

export default function MetricsGrid({ metrics, totalNotional = 0 }: MetricsGridProps) {
  const cards = [
    {
      label: 'Sharpe Ratio',
      value: formatRatio(metrics.sharpeRatio),
      trend: metrics.sharpeRatio >= 1 ? 'positive' : metrics.sharpeRatio >= 0 ? 'neutral' : 'negative',
      icon: <Award className="w-3.5 h-3.5" />,
      description: 'Risk-adjusted return (ann.)',
    },
    {
      label: 'Sortino Ratio',
      value: formatRatio(metrics.sortinoRatio),
      trend: metrics.sortinoRatio >= 1.5 ? 'positive' : metrics.sortinoRatio >= 0 ? 'neutral' : 'negative',
      icon: <Zap className="w-3.5 h-3.5" />,
      description: 'Downside-risk-adjusted return',
    },
    {
      label: 'Max Drawdown',
      value: formatMoney(metrics.maxDrawdown),
      subValue: `-${metrics.maxDrawdownPct.toFixed(1)}%`,
      trend: 'negative' as const,
      icon: <TrendingDown className="w-3.5 h-3.5" />,
      description: 'Peak-to-trough decline',
    },
    {
      label: 'Win Rate',
      value: `${metrics.winRate.toFixed(1)}%`,
      trend: metrics.winRate >= 55 ? 'positive' : metrics.winRate >= 45 ? 'neutral' : 'negative',
      icon: <Target className="w-3.5 h-3.5" />,
      description: `${metrics.totalTrades.toLocaleString()} total trades`,
    },
    {
      label: 'Profit Factor',
      value: formatRatio(metrics.profitFactor),
      trend: metrics.profitFactor >= 1.5 ? 'positive' : metrics.profitFactor >= 1 ? 'neutral' : 'negative',
      icon: <BarChart2 className="w-3.5 h-3.5" />,
      description: 'Gross profit / gross loss',
    },
    {
      label: 'CAGR',
      value: `${metrics.cagr.toFixed(1)}%`,
      trend: metrics.cagr > 0 ? 'positive' : 'negative',
      icon: <TrendingUp className="w-3.5 h-3.5" />,
      description: 'Compound annual growth rate',
    },
    {
      label: 'Annual Yield',
      value: formatPercent(metrics.annualYield),
      trend: metrics.annualYield > 0 ? 'positive' : 'negative',
      icon: <Percent className="w-3.5 h-3.5" />,
      description: 'Simple annualized return',
    },
    {
      label: 'Risk / Reward',
      value: `${formatRatio(metrics.riskReward)}x`,
      trend: metrics.riskReward >= 1.5 ? 'positive' : metrics.riskReward >= 1 ? 'neutral' : 'negative',
      icon: <Scale className="w-3.5 h-3.5" />,
      description: 'Avg win / avg loss',
    },
    {
      label: 'Avg Win / Loss',
      value: formatMoney(metrics.averageWin),
      subValue: `/ ${formatMoney(metrics.averageLoss)}`,
      trend: 'positive' as const,
      icon: <DollarSign className="w-3.5 h-3.5" />,
      description: 'Per-trade averages',
    },
    {
      label: 'Trading Volume',
      value: formatMoney(totalNotional),
      trend: 'neutral' as const,
      icon: <Activity className="w-3.5 h-3.5" />,
      description: 'Total notional traded (Σ qty × price)',
    },
  ] as const

  return (
    <div className="px-4 pt-1 pb-1">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-px" style={{ background: 'var(--border-subtle)' }}>
        {cards.map((c) => (
          <MetricCard
            key={c.label}
            label={c.label}
            value={c.value}
            subValue={'subValue' in c ? c.subValue : undefined}
            trend={c.trend as 'positive' | 'negative' | 'neutral'}
            icon={c.icon}
            description={c.description}
          />
        ))}
      </div>
    </div>
  )
}
