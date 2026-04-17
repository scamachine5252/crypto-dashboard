/**
 * BybitAdapter — fetchBybitClosedPnl fee + pnl calculation tests
 *
 * Covers:
 *  - Linear long/short: fee = (price movement) − closedPnl
 *  - Linear funding farming: fee is negative when funding income > commission
 *  - Inverse long/short: gross uses USD-contract formula, pnl converted to USDT
 *  - Inverse avgEntry=0 guard: fee defaults to 0
 *  - getTrades calls both linear and inverse endpoints
 */

import { BybitAdapter } from '../bybit'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAdapter() {
  const adapter = new BybitAdapter({ apiKey: 'k', apiSecret: 's' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ex = (adapter as any).exchange as Record<string, unknown>

  const fns = {
    privateGetV5PositionClosedPnl: jest.fn(),
    fetchMyTrades:  jest.fn().mockResolvedValue([]),
    fetchBalance:   jest.fn().mockResolvedValue({ total: {} }),
    fetchPositions: jest.fn().mockResolvedValue([]),
  }
  Object.assign(ex, fns)
  return { adapter, fns }
}

/** Route mock responses by category so linear and inverse can be tested independently. */
function mockByCategory(
  fns: ReturnType<typeof buildAdapter>['fns'],
  linear: Array<Record<string, string>>,
  inverse: Array<Record<string, string>> = [],
) {
  fns.privateGetV5PositionClosedPnl.mockImplementation(
    (params: Record<string, unknown>) =>
      Promise.resolve({
        result: {
          list: params.category === 'linear' ? linear : inverse,
          nextPageCursor: '',
        },
      })
  )
}

function makeLinearPos(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    symbol:        'BTCUSDT',
    side:          'Sell',      // 'Sell' = closing a long position
    orderId:       'ord1',
    avgEntryPrice: '50000',
    avgExitPrice:  '51000',
    closedSize:    '0.1',
    closedPnl:     '95',        // gross=100, fee=5
    leverage:      '10',
    createdTime:   '1735689600000',
    updatedTime:   '1735693200000',
    ...overrides,
  }
}

function makeInversePos(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    symbol:        'BTCUSD',
    side:          'Sell',      // closing a long
    orderId:       'ord2',
    avgEntryPrice: '1000',
    avgExitPrice:  '1100',
    closedSize:    '1000',      // contracts (each = $1 USD)
    // closedPnl in BTC: 0.09 BTC * 1100 USD/BTC = 99 USDT
    // gross_usdt = 1000 * (1100-1000)/1000 = 100 USDT → fee = 1 USDT
    closedPnl:     '0.09',
    leverage:      '10',
    createdTime:   '1735689600000',
    updatedTime:   '1735693200000',
    ...overrides,
  }
}

// ─── Linear contracts ─────────────────────────────────────────────────────────

describe('BybitAdapter linear fee calculation', () => {
  it('fee = gross − closedPnl for long (pos.side=Sell)', async () => {
    const { adapter, fns } = buildAdapter()
    // gross = (51000 - 50000) * 0.1 = 100 USDT; closedPnl = 95 → fee = 5
    mockByCategory(fns, [makeLinearPos()])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find((t) => t.tradeType === 'futures')!
    expect(t.fee).toBeCloseTo(5, 2)
    expect(t.pnl).toBeCloseTo(95, 2)
    expect(t.side).toBe('long')
  })

  it('fee = gross − closedPnl for short (pos.side=Buy)', async () => {
    const { adapter, fns } = buildAdapter()
    // closing short: entry=51000, exit=50000 → gross = (51000-50000)*0.1 = 100; fee = 5
    mockByCategory(fns, [makeLinearPos({ side: 'Buy', avgEntryPrice: '51000', avgExitPrice: '50000' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find((t) => t.tradeType === 'futures')!
    expect(t.fee).toBeCloseTo(5, 2)
    expect(t.side).toBe('short')
  })

  it('fee is negative when funding income > trading commission (funding farming)', async () => {
    const { adapter, fns } = buildAdapter()
    // gross = (51000-50000)*0.1 = 100; closedPnl = 105 (received $10 funding, paid $5 commission)
    // fee = 100 - 105 = -5 → net income from cost structure
    mockByCategory(fns, [makeLinearPos({ closedPnl: '105' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find((t) => t.tradeType === 'futures')!
    expect(t.fee).toBeCloseTo(-5, 2)
  })

  it('fee = 0 when position has no price movement and closedPnl = 0', async () => {
    const { adapter, fns } = buildAdapter()
    mockByCategory(fns, [makeLinearPos({ avgEntryPrice: '50000', avgExitPrice: '50000', closedPnl: '0' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find((t) => t.tradeType === 'futures')!
    expect(t.fee).toBe(0)
  })
})

// ─── Inverse contracts ────────────────────────────────────────────────────────

describe('BybitAdapter inverse fee and pnl calculation', () => {
  it('pnl is closedPnl_base × exitPrice (converted to USDT)', async () => {
    const { adapter, fns } = buildAdapter()
    // closedPnl=0.09 BTC, exitPrice=1100 → pnl = 0.09 * 1100 = 99 USDT
    mockByCategory(fns, [], [makeInversePos()])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find((t) => t.tradeType === 'futures')!
    expect(t.pnl).toBeCloseTo(99, 1)
  })

  it('fee uses USD-contract gross formula for long (contracts × (exit−entry) / entry)', async () => {
    const { adapter, fns } = buildAdapter()
    // gross_usdt = 1000 * (1100-1000)/1000 = 100; closedPnl_usdt = 0.09*1100 = 99; fee = 1
    mockByCategory(fns, [], [makeInversePos()])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find((t) => t.tradeType === 'futures')!
    expect(t.fee).toBeCloseTo(1, 1)
  })

  it('fee uses USD-contract gross formula for short (contracts × (entry−exit) / entry)', async () => {
    const { adapter, fns } = buildAdapter()
    // short: entry=1100, exit=1000, size=1000, closedPnl=0.09 BTC
    // gross_usdt = 1000 * (1100-1000)/1100 ≈ 90.91
    // closedPnl_usdt = 0.09 * 1000 = 90  → fee ≈ 0.91
    mockByCategory(fns, [], [makeInversePos({ side: 'Buy', avgEntryPrice: '1100', avgExitPrice: '1000' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find((t) => t.tradeType === 'futures')!
    expect(t.fee).toBeCloseTo(0.91, 1)
    expect(t.side).toBe('short')
  })

  it('fee = 0 when avgEntryPrice = 0 (guard against division by zero)', async () => {
    const { adapter, fns } = buildAdapter()
    mockByCategory(fns, [], [makeInversePos({ avgEntryPrice: '0' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find((t) => t.tradeType === 'futures')!
    expect(t.fee).toBe(0)
  })
})

// ─── Routing ──────────────────────────────────────────────────────────────────

describe('BybitAdapter getTrades routing', () => {
  it('calls privateGetV5PositionClosedPnl for both linear and inverse categories', async () => {
    const { adapter, fns } = buildAdapter()
    mockByCategory(fns, [], [])

    await adapter.getTrades('acc', { start: '', end: '' })

    const categories = fns.privateGetV5PositionClosedPnl.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).category
    )
    expect(categories).toContain('linear')
    expect(categories).toContain('inverse')
  })
})
