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

function makeCcxtPositionHistory(overrides: Partial<{
  id: string; symbol: string; side: string; contracts: number
  entryPrice: number; markPrice: number; lastPrice: number
  realizedPnl: number; leverage: number
  datetime: string; lastUpdateTimestamp: number
}> = {}) {
  return {
    id: 'pos1',
    symbol: 'BTC/USDT:USDT',
    side: 'long',
    contracts: 0.1,
    entryPrice: 50000,
    markPrice: 51000,
    lastPrice: 51000,
    realizedPnl: 100,
    leverage: 10,
    datetime: '2025-01-01T00:00:00.000Z',
    lastUpdateTimestamp: new Date('2025-01-01T01:00:00.000Z').getTime(),
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
    fetchBalance: jest.fn(),
  }
  const swapMock = {
    fetchBalance:         jest.fn(),
    fetchPositionsHistory: jest.fn().mockResolvedValue([]),
    fetchPositions:        jest.fn().mockResolvedValue([]),
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
  it('calls swap.fetchPositionsHistory (not fetchMyTrades)', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositionsHistory.mockResolvedValue([])

    await adapter.getTrades('acc', { start: '', end: '' })
    expect(swapMock.fetchPositionsHistory).toHaveBeenCalled()
  })

  it('maps closed position to tradeType=futures', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositionsHistory.mockResolvedValue([makeCcxtPositionHistory()])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades[0].tradeType).toBe('futures')
  })

  it('maps realizedPnl to trade.pnl', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositionsHistory.mockResolvedValue([
      makeCcxtPositionHistory({ realizedPnl: 250 }),
    ])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades[0].pnl).toBe(250)
  })

  it('maps position side correctly (long/short)', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositionsHistory.mockResolvedValue([
      makeCcxtPositionHistory({ side: 'short' }),
    ])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades[0].side).toBe('short')
  })

  it('uses lastUpdateTimestamp as closedAt', async () => {
    const { adapter, swapMock } = buildAdapter()
    const lastUpdateTimestamp = new Date('2025-06-01T12:00:00.000Z').getTime()
    swapMock.fetchPositionsHistory.mockResolvedValue([
      makeCcxtPositionHistory({ lastUpdateTimestamp }),
    ])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades[0].closedAt).toBe('2025-06-01T12:00:00.000Z')
  })

  it('filters out positions outside until boundary (client-side)', async () => {
    const { adapter, swapMock } = buildAdapter()
    const until = new Date('2025-03-01T00:00:00.000Z').getTime()
    swapMock.fetchPositionsHistory.mockResolvedValue([
      makeCcxtPositionHistory({ lastUpdateTimestamp: until + 1000 }), // after until → filtered
      makeCcxtPositionHistory({ id: 'pos2', lastUpdateTimestamp: until - 1000 }), // before until → kept
    ])

    const trades = await adapter.getTrades('acc', { start: '', end: '' }, undefined, undefined, until)
    expect(trades).toHaveLength(1)
    expect(trades[0].id).toBe('pos2')
  })

  it('filters out positions before since boundary (client-side)', async () => {
    const { adapter, swapMock } = buildAdapter()
    const since = new Date('2025-03-01T00:00:00.000Z').getTime()
    swapMock.fetchPositionsHistory.mockResolvedValue([
      makeCcxtPositionHistory({ lastUpdateTimestamp: since - 1000 }), // before since → filtered
      makeCcxtPositionHistory({ id: 'pos2', lastUpdateTimestamp: since + 1000 }), // after since → kept
    ])

    const trades = await adapter.getTrades('acc', { start: '', end: '' }, since)
    expect(trades).toHaveLength(1)
    expect(trades[0].id).toBe('pos2')
  })

  it('returns empty array if fetchPositionsHistory throws', async () => {
    const { adapter, swapMock } = buildAdapter()
    swapMock.fetchPositionsHistory.mockRejectedValue(new Error('network'))

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades).toHaveLength(0)
  })

  it('does not pass since to fetchPositionsHistory (client-side filtering instead)', async () => {
    const { adapter, swapMock } = buildAdapter()
    const since = Date.now() - 86400000
    swapMock.fetchPositionsHistory.mockResolvedValue([])

    await adapter.getTrades('acc', { start: '', end: '' }, since)
    expect(swapMock.fetchPositionsHistory).toHaveBeenCalledWith(
      undefined, undefined, expect.any(Number), expect.any(Object),
    )
  })

  it('paginates via page_num until an empty page is returned', async () => {
    const { adapter, swapMock } = buildAdapter()
    const pos = makeCcxtPositionHistory()
    // Page 1: full page (100), page 2: empty → stops
    swapMock.fetchPositionsHistory
      .mockResolvedValueOnce(Array(100).fill(pos))
      .mockResolvedValueOnce([])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(swapMock.fetchPositionsHistory).toHaveBeenCalledTimes(2)
    expect(swapMock.fetchPositionsHistory).toHaveBeenNthCalledWith(1, undefined, undefined, 100, { page_num: 1 })
    expect(swapMock.fetchPositionsHistory).toHaveBeenNthCalledWith(2, undefined, undefined, 100, { page_num: 2 })
    expect(trades).toHaveLength(100)
  })

  it('stops pagination when page is smaller than PAGE_SIZE', async () => {
    const { adapter, swapMock } = buildAdapter()
    const pos = makeCcxtPositionHistory()
    swapMock.fetchPositionsHistory.mockResolvedValueOnce([pos, pos, pos]) // 3 < 100

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(swapMock.fetchPositionsHistory).toHaveBeenCalledTimes(1)
    expect(trades).toHaveLength(3)
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
      makeCcxtPosition({ contracts: 0 }),
      makeCcxtPosition({ contracts: 1.5 }),
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
