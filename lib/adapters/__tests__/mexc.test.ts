/**
 * MexcAdapter unit tests
 *
 * Tests are structured around the four ExchangeAdapter methods:
 * testConnection, fetchBalance, getTrades, fetchPositions.
 * Both spot and swap instances are mocked on the adapter internals.
 */

import { MexcAdapter } from '../mexc'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBalance(usdt: number, tokens: Record<string, number> = {}) {
  return { total: { USDT: usdt, ...tokens } }
}

function makeCcxtTrade(overrides: Partial<{
  id: string; symbol: string; side: string; price: number; amount: number
  cost: number; fee: { cost: number; currency: string }; timestamp: number
  info: Record<string, unknown>
}> = {}) {
  return {
    id: 't1',
    symbol: 'BTC/USDT',
    side: 'buy',
    price: 50000,
    amount: 0.01,
    cost: 500,
    fee: { cost: 0.5, currency: 'USDT' },
    timestamp: Date.now(),
    info: {},
    ...overrides,
  }
}

function makeCcxtPosition(overrides: Partial<{
  symbol: string; side: string; contracts: number; contractSize: number
  entryPrice: number; markPrice: number; notional: number; unrealizedPnl: number
  leverage: number; initialMargin: number; liquidationPrice: number; timestamp: number
}> = {}) {
  return {
    symbol: 'BTC/USDT:USDT',
    side: 'long',
    contracts: 0.5,
    contractSize: 1,
    entryPrice: 50000,
    markPrice: 51000,
    notional: 25500,
    unrealizedPnl: 500,
    leverage: 10,
    initialMargin: 2550,
    liquidationPrice: 40000,
    timestamp: Date.now(),
    ...overrides,
  }
}

/** Build a MexcAdapter and replace spot/swap CCXT instances with mocks. */
function buildAdapter() {
  const adapter = new MexcAdapter({ apiKey: 'k', apiSecret: 's' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = adapter as any

  const spotMock = {
    fetchBalance:  jest.fn(),
    fetchMyTrades: jest.fn().mockResolvedValue([]),
  }
  const swapMock = {
    fetchBalance:   jest.fn(),
    fetchMyTrades:  jest.fn().mockResolvedValue([]),
    fetchPositions: jest.fn().mockResolvedValue([]),
  }

  a.spot = spotMock
  a.swap = swapMock

  return { adapter, spotMock, swapMock }
}

// ─── testConnection() ─────────────────────────────────────────────────────────

describe('MexcAdapter.testConnection()', () => {
  it('returns true when spot fetchBalance succeeds', async () => {
    const { adapter, spotMock } = buildAdapter()
    spotMock.fetchBalance.mockResolvedValue(makeBalance(1000))
    expect(await adapter.testConnection()).toBe(true)
  })

  it('returns false when spot fetchBalance throws', async () => {
    const { adapter, spotMock } = buildAdapter()
    spotMock.fetchBalance.mockRejectedValue(new Error('invalid key'))
    expect(await adapter.testConnection()).toBe(false)
  })
})

// ─── fetchBalance() ───────────────────────────────────────────────────────────

describe('MexcAdapter.fetchBalance()', () => {
  it('sums USDT from spot and swap wallets', async () => {
    const { adapter, spotMock, swapMock } = buildAdapter()
    spotMock.fetchBalance.mockResolvedValue(makeBalance(300))
    swapMock.fetchBalance.mockResolvedValue(makeBalance(700))

    const result = await adapter.fetchBalance()
    expect(result.usdt).toBe(1000)
  })

  it('returns spot USDT only if swap fetchBalance fails', async () => {
    const { adapter, spotMock, swapMock } = buildAdapter()
    spotMock.fetchBalance.mockResolvedValue(makeBalance(500))
    swapMock.fetchBalance.mockRejectedValue(new Error('network'))

    const result = await adapter.fetchBalance()
    expect(result.usdt).toBe(500)
  })

  it('throws if both spot and swap fail', async () => {
    const { adapter, spotMock, swapMock } = buildAdapter()
    spotMock.fetchBalance.mockRejectedValue(new Error('spot fail'))
    swapMock.fetchBalance.mockRejectedValue(new Error('swap fail'))

    await expect(adapter.fetchBalance()).rejects.toThrow()
  })

  it('collects non-USDT tokens from both wallets without double-counting', async () => {
    const { adapter, spotMock, swapMock } = buildAdapter()
    spotMock.fetchBalance.mockResolvedValue(makeBalance(0, { BTC: 1.0, ETH: 2.0 }))
    swapMock.fetchBalance.mockResolvedValue(makeBalance(0, { BTC: 0.5 }))

    const result = await adapter.fetchBalance()
    expect(result.tokens['BTC']).toBeCloseTo(1.5)
    expect(result.tokens['ETH']).toBeCloseTo(2.0)
  })
})

// ─── getTrades() ──────────────────────────────────────────────────────────────

describe('MexcAdapter.getTrades()', () => {
  it('merges spot and swap trades', async () => {
    const { adapter, spotMock, swapMock } = buildAdapter()
    spotMock.fetchMyTrades.mockResolvedValue([makeCcxtTrade({ id: 'sp1', symbol: 'ETH/USDT' })])
    swapMock.fetchMyTrades.mockResolvedValue([makeCcxtTrade({ id: 'sw1', symbol: 'BTC/USDT:USDT' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades).toHaveLength(2)
  })

  it('maps spot trade to tradeType=spot via symbol without colon', async () => {
    const { adapter, spotMock } = buildAdapter()
    spotMock.fetchMyTrades.mockResolvedValue([makeCcxtTrade({ symbol: 'ETH/USDT' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades[0].tradeType).toBe('spot')
  })

  it('maps swap trade to tradeType=futures via symbol containing colon', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchMyTrades.mockResolvedValue([makeCcxtTrade({ symbol: 'BTC/USDT:USDT' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades[0].tradeType).toBe('futures')
  })

  it('returns empty array if both spot and swap fail', async () => {
    const { adapter, spotMock, swapMock } = buildAdapter()
    spotMock.fetchMyTrades.mockRejectedValue(new Error('spot err'))
    swapMock.fetchMyTrades.mockRejectedValue(new Error('swap err'))

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades).toHaveLength(0)
  })

  it('passes since parameter to both spot and swap fetchMyTrades', async () => {
    const { adapter, spotMock, swapMock } = buildAdapter()
    const since = Date.now() - 86400000

    await adapter.getTrades('acc', { start: '', end: '' }, since)

    expect(spotMock.fetchMyTrades).toHaveBeenCalledWith(undefined, since, expect.any(Number), expect.any(Object))
    expect(swapMock.fetchMyTrades).toHaveBeenCalledWith(undefined, since, expect.any(Number), expect.any(Object))
  })
})

// ─── fetchPositions() ─────────────────────────────────────────────────────────

describe('MexcAdapter.fetchPositions()', () => {
  it('returns open swap positions with correct fields', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositions.mockResolvedValue([makeCcxtPosition()])

    const positions = await adapter.fetchPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].symbol).toBe('BTC/USDT')
    expect(positions[0].side).toBe('long')
    expect(positions[0].size).toBe(0.5)
    expect(positions[0].entryPrice).toBe(50000)
  })

  it('filters zero-size positions', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositions.mockResolvedValue([
      makeCcxtPosition({ contracts: 0 }),      // zero — filtered
      makeCcxtPosition({ contracts: 1.5 }),    // non-zero — keep
    ])

    const positions = await adapter.fetchPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].size).toBe(1.5)
  })

  it('returns empty array if swap fetchPositions throws', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositions.mockRejectedValue(new Error('unauthorized'))

    const positions = await adapter.fetchPositions()
    expect(positions).toHaveLength(0)
  })

  it('maps side correctly for short positions', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositions.mockResolvedValue([makeCcxtPosition({ side: 'short', contracts: 0.3 })])

    const positions = await adapter.fetchPositions()
    expect(positions[0].side).toBe('short')
  })
})
