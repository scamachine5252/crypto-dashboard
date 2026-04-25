import type { Position } from '@/lib/types'
import type { EvaluateInput, RiskViolation } from './types'

export function evaluateRules(input: EvaluateInput): RiskViolation[] {
  const { positions, currentUsdtBalance, athUsdtBalance, rules } = input
  const violations: RiskViolation[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue

    let currentValue: number | null = null

    switch (rule.rule_type) {
      case 'position_size': {
        if (positions.length === 0) continue
        currentValue = Math.max(...positions.map((p: Position) => p.notional))
        break
      }
      case 'max_drawdown': {
        if (athUsdtBalance <= 0) continue
        currentValue = (athUsdtBalance - currentUsdtBalance) / athUsdtBalance * 100
        if (currentValue <= 0) continue
        break
      }
      case 'max_positions': {
        currentValue = positions.length
        break
      }
      case 'max_unrealized_pnl_per_position': {
        if (positions.length === 0) continue
        const worstPnl = Math.min(...positions.map((p: Position) => p.unrealizedPnl))
        if (worstPnl >= -rule.alert_threshold) continue
        currentValue = Math.abs(worstPnl)
        break
      }
      case 'max_net_position_instrument': {
        const bySymbol: Record<string, number> = {}
        for (const p of positions) {
          bySymbol[p.symbol] = (bySymbol[p.symbol] ?? 0) + (p.side === 'long' ? p.notional : -p.notional)
        }
        const maxNet = Object.values(bySymbol).reduce((m, v) => Math.max(m, Math.abs(v)), 0)
        if (maxNet <= rule.alert_threshold) continue
        currentValue = maxNet
        break
      }
      case 'max_net_position_account': {
        const totalNet = positions.reduce((sum: number, p: Position) => sum + (p.side === 'long' ? p.notional : -p.notional), 0)
        currentValue = Math.abs(totalNet)
        break
      }
    }

    if (currentValue === null || currentValue <= rule.alert_threshold) continue

    const severity: 'warning' | 'critical' =
      rule.kill_threshold !== null && currentValue > rule.kill_threshold ? 'critical' : 'warning'

    violations.push({ rule, current_value: currentValue, severity })
  }

  return violations
}
