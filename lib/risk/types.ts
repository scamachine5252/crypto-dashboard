import type { Position } from '@/lib/types'

export type RuleType =
  | 'position_size'
  | 'max_drawdown'
  | 'max_positions'
  | 'max_unrealized_pnl_per_position'
  | 'max_net_position_instrument'
  | 'max_net_position_account'
  | 'leverage'
  | 'margin_utilization'
  | 'min_liq_distance'

export interface RiskRule {
  id: string
  account_id: string
  rule_type: RuleType
  alert_threshold: number
  kill_threshold: number | null
  enabled: boolean
}

export interface RiskAlert {
  id: string
  account_id: string
  rule_type: RuleType
  current_value: number
  alert_threshold: number
  kill_threshold: number | null
  severity: 'warning' | 'critical'
  acknowledged: boolean
  fired_at: string
}

export interface RiskViolation {
  rule: RiskRule
  current_value: number
  severity: 'warning' | 'critical'
}

export interface EvaluateInput {
  positions: Position[]
  currentUsdtBalance: number
  athUsdtBalance: number
  peakAdjustedBalance?: number
  currentAdjustedBalance?: number
  netDeposits?: number
  rules: RiskRule[]
}
