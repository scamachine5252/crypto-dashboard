import { evaluateRules, computeAllMetricValues } from '../risk/evaluate'
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
})
