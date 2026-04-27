import { evaluateRules, computeAllMetricValues } from '../risk/evaluate'
import { formatEvaluationErrorMessage } from '../telegram'
import type { EvaluateInput, RiskRule } from '../risk/types'
import type { Position } from '../types'

function makeRule(overrides: Partial<RiskRule> & { rule_type: RiskRule['rule_type'] }): RiskRule {
  return { id: 'rule-1', account_id: 'acc-1', alert_threshold: 10000, kill_threshold: null, enabled: true, ...overrides }
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    symbol: 'BTC/USDT', side: 'long', size: 1, entryPrice: 40000, markPrice: 41000,
    notional: 41000, unrealizedPnl: 1000, leverage: 10, margin: 4100,
    liquidationPrice: 36000, openTimestamp: Date.now() - 3600000,
    accountId: 'acc-1', accountName: 'Test', exchange: 'bybit',
    ...overrides,
  }
}

const baseInput: EvaluateInput = {
  positions: [], currentUsdtBalance: 100000, athUsdtBalance: 110000, rules: [],
}

describe('evaluateRules', () => {
  it('returns empty array when no rules', () => {
    expect(evaluateRules({ ...baseInput, rules: [] })).toEqual([])
  })

  it('ignores disabled rules', () => {
    const rule = makeRule({ rule_type: 'max_positions', alert_threshold: 1, enabled: false })
    expect(evaluateRules({ ...baseInput, positions: [makePosition()], rules: [rule] })).toHaveLength(0)
  })

  describe('position_size', () => {
    it('no violation when max notional below threshold', () => {
      const rule = makeRule({ rule_type: 'position_size', alert_threshold: 50000 })
      expect(evaluateRules({ ...baseInput, positions: [makePosition({ notional: 30000 })], rules: [rule] })).toHaveLength(0)
    })
    it('warning when max notional exceeds alert_threshold', () => {
      const rule = makeRule({ rule_type: 'position_size', alert_threshold: 30000 })
      const result = evaluateRules({ ...baseInput, positions: [makePosition({ notional: 41000 })], rules: [rule] })
      expect(result).toHaveLength(1)
      expect(result[0].severity).toBe('warning')
      expect(result[0].current_value).toBe(41000)
    })
    it('critical when max notional exceeds kill_threshold', () => {
      const rule = makeRule({ rule_type: 'position_size', alert_threshold: 30000, kill_threshold: 40000 })
      const result = evaluateRules({ ...baseInput, positions: [makePosition({ notional: 41000 })], rules: [rule] })
      expect(result[0].severity).toBe('critical')
    })
    it('no violation when no positions', () => {
      const rule = makeRule({ rule_type: 'position_size', alert_threshold: 1 })
      expect(evaluateRules({ ...baseInput, positions: [], rules: [rule] })).toHaveLength(0)
    })
  })

  describe('max_drawdown', () => {
    it('no violation when drawdown below threshold', () => {
      const rule = makeRule({ rule_type: 'max_drawdown', alert_threshold: 10 })
      expect(evaluateRules({ ...baseInput, rules: [rule] })).toHaveLength(0)
    })
    it('warning when drawdown exceeds threshold', () => {
      const rule = makeRule({ rule_type: 'max_drawdown', alert_threshold: 9 })
      const result = evaluateRules({ ...baseInput, rules: [rule] })
      expect(result).toHaveLength(1)
      expect(result[0].current_value).toBeCloseTo(9.09, 1)
    })
    it('no violation when ath is 0', () => {
      const rule = makeRule({ rule_type: 'max_drawdown', alert_threshold: 5 })
      expect(evaluateRules({ ...baseInput, athUsdtBalance: 0, rules: [rule] })).toHaveLength(0)
    })
    it('no violation when current >= ath', () => {
      const rule = makeRule({ rule_type: 'max_drawdown', alert_threshold: 1 })
      expect(evaluateRules({ ...baseInput, currentUsdtBalance: 110000, athUsdtBalance: 110000, rules: [rule] })).toHaveLength(0)
    })
  })

  describe('max_positions', () => {
    it('no violation when count below threshold', () => {
      const rule = makeRule({ rule_type: 'max_positions', alert_threshold: 3 })
      expect(evaluateRules({ ...baseInput, positions: [makePosition(), makePosition({ symbol: 'ETH/USDT' })], rules: [rule] })).toHaveLength(0)
    })
    it('warning when count exceeds threshold', () => {
      const rule = makeRule({ rule_type: 'max_positions', alert_threshold: 1 })
      const result = evaluateRules({ ...baseInput, positions: [makePosition(), makePosition({ symbol: 'ETH/USDT' })], rules: [rule] })
      expect(result).toHaveLength(1)
      expect(result[0].current_value).toBe(2)
    })
  })

  describe('max_unrealized_pnl_per_position', () => {
    it('no violation when loss below threshold', () => {
      const rule = makeRule({ rule_type: 'max_unrealized_pnl_per_position', alert_threshold: 1000 })
      expect(evaluateRules({ ...baseInput, positions: [makePosition({ unrealizedPnl: -500 })], rules: [rule] })).toHaveLength(0)
    })
    it('warning when loss exceeds threshold', () => {
      const rule = makeRule({ rule_type: 'max_unrealized_pnl_per_position', alert_threshold: 500 })
      const result = evaluateRules({ ...baseInput, positions: [makePosition({ unrealizedPnl: -1000 })], rules: [rule] })
      expect(result).toHaveLength(1)
      expect(result[0].current_value).toBe(1000)
    })
    it('no violation when no positions', () => {
      const rule = makeRule({ rule_type: 'max_unrealized_pnl_per_position', alert_threshold: 1 })
      expect(evaluateRules({ ...baseInput, rules: [rule] })).toHaveLength(0)
    })
  })

  describe('max_net_position_instrument', () => {
    it('no violation when net per symbol below threshold', () => {
      const rule = makeRule({ rule_type: 'max_net_position_instrument', alert_threshold: 50000 })
      const positions = [
        makePosition({ symbol: 'BTC/USDT', side: 'long',  notional: 40000 }),
        makePosition({ symbol: 'BTC/USDT', side: 'short', notional: 35000 }),
      ]
      expect(evaluateRules({ ...baseInput, positions, rules: [rule] })).toHaveLength(0)
    })
    it('warning when net for a symbol exceeds threshold', () => {
      const rule = makeRule({ rule_type: 'max_net_position_instrument', alert_threshold: 10000 })
      const positions = [
        makePosition({ symbol: 'BTC/USDT', side: 'long',  notional: 40000 }),
        makePosition({ symbol: 'BTC/USDT', side: 'short', notional: 20000 }),
      ]
      const result = evaluateRules({ ...baseInput, positions, rules: [rule] })
      expect(result).toHaveLength(1)
      expect(result[0].current_value).toBe(20000)
    })
  })

  describe('max_net_position_account', () => {
    it('no violation when total net below threshold', () => {
      const rule = makeRule({ rule_type: 'max_net_position_account', alert_threshold: 50000 })
      const positions = [
        makePosition({ symbol: 'BTC/USDT', side: 'long',  notional: 40000 }),
        makePosition({ symbol: 'ETH/USDT', side: 'short', notional: 35000 }),
      ]
      expect(evaluateRules({ ...baseInput, positions, rules: [rule] })).toHaveLength(0)
    })
    it('warning when total net exceeds threshold', () => {
      const rule = makeRule({ rule_type: 'max_net_position_account', alert_threshold: 5000 })
      const positions = [
        makePosition({ symbol: 'BTC/USDT', side: 'long',  notional: 40000 }),
        makePosition({ symbol: 'ETH/USDT', side: 'long',  notional: 10000 }),
        makePosition({ symbol: 'SOL/USDT', side: 'short', notional: 5000 }),
      ]
      const result = evaluateRules({ ...baseInput, positions, rules: [rule] })
      expect(result).toHaveLength(1)
      expect(result[0].current_value).toBe(45000)
    })
  })
})

describe('computeAllMetricValues', () => {
  it('returns 0 for all metrics when no positions and no drawdown', () => {
    const result = computeAllMetricValues({ positions: [], currentUsdtBalance: 100000, athUsdtBalance: 100000 })
    expect(result.position_size).toBe(0)
    expect(result.max_drawdown).toBe(0)
    expect(result.max_positions).toBe(0)
    expect(result.max_unrealized_pnl_per_position).toBe(0)
    expect(result.max_net_position_instrument).toBe(0)
    expect(result.max_net_position_account).toBe(0)
    expect(result.leverage).toBe(0)
    expect(result.margin_utilization).toBe(0)
    expect(result.min_liq_distance).toBe(100)
  })

  it('computes correct values with a long position and drawdown', () => {
    const positions = [makePosition({ notional: 50000, unrealizedPnl: -2000 })]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 90000, athUsdtBalance: 100000 })
    expect(result.position_size).toBe(50000)
    expect(result.max_drawdown).toBeCloseTo(10, 1)
    expect(result.max_positions).toBe(1)
    expect(result.max_unrealized_pnl_per_position).toBe(2000)
    expect(result.max_net_position_account).toBe(50000)
  })

  it('net exposure account is abs(long - short)', () => {
    const positions = [
      makePosition({ symbol: 'BTC/USDT', side: 'long',  notional: 60000 }),
      makePosition({ symbol: 'ETH/USDT', side: 'short', notional: 40000 }),
    ]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 100000, athUsdtBalance: 100000 })
    expect(result.max_net_position_account).toBe(20000)
  })

  it('max_drawdown is 0 when ath equals current', () => {
    const result = computeAllMetricValues({ positions: [], currentUsdtBalance: 110000, athUsdtBalance: 110000 })
    expect(result.max_drawdown).toBe(0)
  })

  it('max_drawdown is 0 when ath is 0', () => {
    const result = computeAllMetricValues({ positions: [], currentUsdtBalance: 0, athUsdtBalance: 0 })
    expect(result.max_drawdown).toBe(0)
  })

  it('max_unrealized_pnl_per_position is 0 when all positions are profitable', () => {
    const positions = [makePosition({ unrealizedPnl: 500 })]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 100000, athUsdtBalance: 100000 })
    expect(result.max_unrealized_pnl_per_position).toBe(0)
  })

  it('leverage = total notional / balance', () => {
    const positions = [makePosition({ notional: 300000 })]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 100000, athUsdtBalance: 100000 })
    expect(result.leverage).toBeCloseTo(3, 2)
  })

  it('leverage is 0 when balance is 0', () => {
    const positions = [makePosition({ notional: 100000 })]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 0, athUsdtBalance: 0 })
    expect(result.leverage).toBe(0)
  })

  it('margin_utilization = sum(margin) / balance * 100', () => {
    const positions = [makePosition({ margin: 60000 })]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 100000, athUsdtBalance: 100000 })
    expect(result.margin_utilization).toBeCloseTo(60, 1)
  })

  it('margin_utilization sums across multiple positions', () => {
    const positions = [
      makePosition({ margin: 30000 }),
      makePosition({ symbol: 'ETH/USDT', margin: 20000 }),
    ]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 100000, athUsdtBalance: 100000 })
    expect(result.margin_utilization).toBeCloseTo(50, 1)
  })

  it('min_liq_distance = % gap to closest liquidation', () => {
    const positions = [
      makePosition({ markPrice: 100, liquidationPrice: 90 }),  // 10%
      makePosition({ symbol: 'ETH/USDT', markPrice: 100, liquidationPrice: 95 }),  // 5%
    ]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 100000, athUsdtBalance: 100000 })
    expect(result.min_liq_distance).toBeCloseTo(5, 1)
  })

  it('min_liq_distance is 100 when no positions have liq data', () => {
    const positions = [makePosition({ liquidationPrice: 0 })]
    const result = computeAllMetricValues({ positions, currentUsdtBalance: 100000, athUsdtBalance: 100000 })
    expect(result.min_liq_distance).toBe(100)
  })

  it('drawdown uses adjusted balance when available', () => {
    // balance = 150K (includes 50K deposit), peakAdjusted = 110K, currentAdjusted = 105K
    const result = computeAllMetricValues({
      positions: [], currentUsdtBalance: 150000, athUsdtBalance: 150000,
      peakAdjustedBalance: 110000, currentAdjustedBalance: 105000,
    })
    expect(result.max_drawdown).toBeCloseTo(4.55, 1)  // (110-105)/110
  })

  it('drawdown falls back to raw ATH when adjusted balances not provided', () => {
    const result = computeAllMetricValues({
      positions: [], currentUsdtBalance: 90000, athUsdtBalance: 100000,
    })
    expect(result.max_drawdown).toBeCloseTo(10, 1)
  })

  it('adjusted drawdown is 0 when currentAdjusted >= peakAdjusted', () => {
    const result = computeAllMetricValues({
      positions: [], currentUsdtBalance: 100000, athUsdtBalance: 100000,
      peakAdjustedBalance: 90000, currentAdjustedBalance: 95000,
    })
    expect(result.max_drawdown).toBe(0)
  })
})

describe('evaluateRules — leverage', () => {
  it('no violation when leverage below threshold', () => {
    const rule = makeRule({ rule_type: 'leverage', alert_threshold: 5 })
    const positions = [makePosition({ notional: 300000 })]
    expect(evaluateRules({ ...baseInput, positions, currentUsdtBalance: 100000, rules: [rule] })).toHaveLength(0)
  })

  it('warning when leverage exceeds alert_threshold', () => {
    const rule = makeRule({ rule_type: 'leverage', alert_threshold: 2 })
    const positions = [makePosition({ notional: 300000 })]
    const result = evaluateRules({ ...baseInput, positions, currentUsdtBalance: 100000, rules: [rule] })
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('warning')
    expect(result[0].current_value).toBeCloseTo(3, 2)
  })

  it('critical when leverage exceeds kill_threshold', () => {
    const rule = makeRule({ rule_type: 'leverage', alert_threshold: 2, kill_threshold: 2.5 })
    const positions = [makePosition({ notional: 300000 })]
    const result = evaluateRules({ ...baseInput, positions, currentUsdtBalance: 100000, rules: [rule] })
    expect(result[0].severity).toBe('critical')
  })

  it('no violation when balance is 0', () => {
    const rule = makeRule({ rule_type: 'leverage', alert_threshold: 1 })
    const positions = [makePosition({ notional: 100000 })]
    expect(evaluateRules({ ...baseInput, positions, currentUsdtBalance: 0, rules: [rule] })).toHaveLength(0)
  })
})

describe('evaluateRules — margin_utilization', () => {
  it('warning when margin utilization exceeds threshold', () => {
    const rule = makeRule({ rule_type: 'margin_utilization', alert_threshold: 50 })
    const positions = [makePosition({ margin: 60000 })]
    const result = evaluateRules({ ...baseInput, positions, currentUsdtBalance: 100000, rules: [rule] })
    expect(result).toHaveLength(1)
    expect(result[0].current_value).toBeCloseTo(60, 1)
  })

  it('no violation when margin utilization below threshold', () => {
    const rule = makeRule({ rule_type: 'margin_utilization', alert_threshold: 70 })
    const positions = [makePosition({ margin: 60000 })]
    expect(evaluateRules({ ...baseInput, positions, currentUsdtBalance: 100000, rules: [rule] })).toHaveLength(0)
  })
})

describe('evaluateRules — min_liq_distance (inverted)', () => {
  it('fires warning when distance is BELOW alert_threshold', () => {
    const rule = makeRule({ rule_type: 'min_liq_distance', alert_threshold: 10 })
    const positions = [makePosition({ markPrice: 100, liquidationPrice: 95 })]  // 5% distance
    const result = evaluateRules({ ...baseInput, positions, rules: [rule] })
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('warning')
    expect(result[0].current_value).toBeCloseTo(5, 1)
  })

  it('fires critical when distance is BELOW kill_threshold', () => {
    const rule = makeRule({ rule_type: 'min_liq_distance', alert_threshold: 10, kill_threshold: 7 })
    const positions = [makePosition({ markPrice: 100, liquidationPrice: 95 })]  // 5% distance
    const result = evaluateRules({ ...baseInput, positions, rules: [rule] })
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('critical')
  })

  it('does NOT fire when distance is ABOVE threshold', () => {
    const rule = makeRule({ rule_type: 'min_liq_distance', alert_threshold: 3 })
    const positions = [makePosition({ markPrice: 100, liquidationPrice: 95 })]  // 5% distance
    expect(evaluateRules({ ...baseInput, positions, rules: [rule] })).toHaveLength(0)
  })

  it('does NOT fire when no positions have liq data', () => {
    const rule = makeRule({ rule_type: 'min_liq_distance', alert_threshold: 50 })
    const positions = [makePosition({ liquidationPrice: 0 })]
    expect(evaluateRules({ ...baseInput, positions, rules: [rule] })).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// max_drawdown — edge cases: нулевой пик, netDeposits
// ---------------------------------------------------------------------------
describe('max_drawdown — edge cases (netDeposits)', () => {
  it('returns 0 when no organic peak and balance equals deposit level', () => {
    const r = computeAllMetricValues({
      positions: [], currentUsdtBalance: 100000, athUsdtBalance: 100000,
      peakAdjustedBalance: 0, currentAdjustedBalance: 0, netDeposits: 100000,
    })
    expect(r.max_drawdown).toBe(0)
  })

  it('returns % of deposit lost when balance is below deposit level', () => {
    const r = computeAllMetricValues({
      positions: [], currentUsdtBalance: 50000, athUsdtBalance: 100000,
      peakAdjustedBalance: 0, currentAdjustedBalance: -50000, netDeposits: 100000,
    })
    expect(r.max_drawdown).toBeCloseTo(50, 1)
  })

  it('returns 0 when net deposits are 0 (full withdrawal — no meaningful drawdown)', () => {
    const r = computeAllMetricValues({
      positions: [], currentUsdtBalance: 0, athUsdtBalance: 100000,
      peakAdjustedBalance: 0, currentAdjustedBalance: 0, netDeposits: 0,
    })
    expect(r.max_drawdown).toBe(0)
  })

  it('uses peakAdjustedBalance when > 0 (normal organic peak path)', () => {
    const r = computeAllMetricValues({
      positions: [], currentUsdtBalance: 150000, athUsdtBalance: 150000,
      peakAdjustedBalance: 110000, currentAdjustedBalance: 105000, netDeposits: 40000,
    })
    expect(r.max_drawdown).toBeCloseTo(4.55, 1)
  })
})

// ---------------------------------------------------------------------------
// formatEvaluationErrorMessage
// ---------------------------------------------------------------------------

describe('formatEvaluationErrorMessage', () => {
  it('includes account name, exchange, and error message', () => {
    const msg = formatEvaluationErrorMessage({
      accountName: 'Aniket', exchange: 'bybit', errorMessage: 'AuthenticationError: invalid key',
    })
    expect(msg).toContain('Aniket')
    expect(msg).toContain('bybit')
    expect(msg).toContain('AuthenticationError: invalid key')
  })

  it('includes EVALUATION ERROR label', () => {
    const msg = formatEvaluationErrorMessage({ accountName: 'X', exchange: 'binance', errorMessage: 'err' })
    expect(msg).toContain('EVALUATION ERROR')
  })

  it('truncates error messages longer than 300 characters', () => {
    const long = 'x'.repeat(400)
    const msg = formatEvaluationErrorMessage({ accountName: 'X', exchange: 'okx', errorMessage: long })
    expect(msg).toContain('…')
    expect(msg.length).toBeLessThan(long.length + 100)
  })

  it('wraps error in <code> tags for Telegram HTML formatting', () => {
    const msg = formatEvaluationErrorMessage({ accountName: 'X', exchange: 'bybit', errorMessage: 'timeout' })
    expect(msg).toContain('<code>')
    expect(msg).toContain('</code>')
  })
})
