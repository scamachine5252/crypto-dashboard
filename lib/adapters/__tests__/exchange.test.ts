// ---------------------------------------------------------------------------
// Mock ccxt entirely — no real network calls
// ---------------------------------------------------------------------------
const mockFetchBalance = jest.fn()
const mockFetchTrades  = jest.fn()
const mockLoadMarkets  = jest.fn()

const mockExchangeInstance = {
  fetchBalance:  mockFetchBalance,
  fetchMyTrades: mockFetchTrades,
  loadMarkets:   mockLoadMarkets,
}

jest.mock('ccxt', () => ({
  bybit:   jest.fn(() => mockExchangeInstance),
  binance: jest.fn(() => mockExchangeInstance),
  okx:     jest.fn(() => mockExchangeInstance),
}))

// ---------------------------------------------------------------------------
// Shared fixture — minimal ccxt trade object
// ---------------------------------------------------------------------------
const sampleCcxtTrade = {
  id: 'ccxt-1',
  symbol: 'BTC/USDT',
  side: 'buy',
  price: 50000,
  amount: 0.1,
  cost: 5000,
  fee: { cost: 5 },
  timestamp: 1704067200000,
  datetime: '2025-01-01T00:00:00.000Z',
  info: {},
}

// ---------------------------------------------------------------------------
// BybitAdapter
// ---------------------------------------------------------------------------
describe('BybitAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchBalance.mockReset()
    mockFetchTrades.mockReset()
    mockLoadMarkets.mockReset()
  })

  it('testConnection returns true on successful ping', async () => {
    mockFetchBalance.mockResolvedValue({ USDT: { free: 1000 }, total: { USDT: 1000 } })

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const result = await adapter.testConnection()

    expect(result).toBe(true)
  })

  it('testConnection returns false on auth error', async () => {
    mockFetchBalance.mockRejectedValue(new Error('AuthenticationError'))

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'bad-key', apiSecret: 'bad-secret' })
    const result = await adapter.testConnection()

    expect(result).toBe(false)
  })

  it('testConnection returns false on network error', async () => {
    mockFetchBalance.mockRejectedValue(new Error('NetworkError'))

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const result = await adapter.testConnection()

    expect(result).toBe(false)
  })

  it('fetchBalance returns usdt balance as number', async () => {
    mockFetchBalance.mockResolvedValue({
      USDT: { free: 4200.5, used: 0, total: 4200.5 },
      BTC:  { free: 0.5,    used: 0, total: 0.5 },
      total: { USDT: 4200.5, BTC: 0.5 },
    })

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const balance = await adapter.fetchBalance()

    expect(balance.usdt).toBe(4200.5)
    expect(balance.tokens['BTC']).toBe(0.5)
  })

  it('fetchBalance throws if exchange returns error', async () => {
    mockFetchBalance.mockRejectedValue(new Error('ExchangeError: invalid request'))

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })

    await expect(adapter.fetchBalance()).rejects.toThrow()
  })

  it('fetches trades for all 4 categories: spot, linear, inverse, option', async () => {
    mockFetchTrades.mockResolvedValue([])

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

    expect(mockFetchTrades).toHaveBeenCalledTimes(4)
    const categories = mockFetchTrades.mock.calls.map(
      (c) => (c[3] as Record<string, string>)?.category,
    )
    expect(categories).toContain('spot')
    expect(categories).toContain('linear')
    expect(categories).toContain('inverse')
    expect(categories).toContain('option')
  })

  it('merges trades from all categories into single array', async () => {
    mockFetchTrades.mockImplementation(
      (_s: unknown, _since: unknown, _limit: unknown, params: Record<string, string>) => {
        if (params?.category === 'spot')   return Promise.resolve([{ ...sampleCcxtTrade, id: 'spot-1' }])
        if (params?.category === 'linear') return Promise.resolve([{ ...sampleCcxtTrade, id: 'linear-1' }])
        return Promise.resolve([])
      },
    )

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

    expect(trades.length).toBe(2)
  })

  it('handles empty result for a category gracefully', async () => {
    mockFetchTrades.mockImplementation(
      (_s: unknown, _since: unknown, _limit: unknown, params: Record<string, string>) => {
        if (params?.category === 'spot')   return Promise.resolve([{ ...sampleCcxtTrade, id: 'spot-1' }])
        if (params?.category === 'linear') return Promise.reject(new Error('category not available'))
        return Promise.resolve([])
      },
    )

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

    expect(trades.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// BinanceAdapter
// ---------------------------------------------------------------------------
describe('BinanceAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchBalance.mockReset()
  })

  it('testConnection returns true on successful ping', async () => {
    mockFetchBalance.mockResolvedValue({ USDT: { free: 500 }, total: { USDT: 500 } })

    const { BinanceAdapter } = await import('../binance')
    const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const result = await adapter.testConnection()

    expect(result).toBe(true)
  })

  it('testConnection returns false on auth error', async () => {
    mockFetchBalance.mockRejectedValue(new Error('AuthenticationError'))

    const { BinanceAdapter } = await import('../binance')
    const adapter = new BinanceAdapter({ apiKey: 'bad', apiSecret: 'bad' })
    const result = await adapter.testConnection()

    expect(result).toBe(false)
  })

  describe('fetchBalance', () => {
    it('queries spot, future, and delivery wallets in parallel', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 0 } })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.fetchBalance()

      expect(mockFetchBalance).toHaveBeenCalledTimes(3)
      const calledTypes = mockFetchBalance.mock.calls.map(
        (c) => (c[0] as Record<string, string>)?.type,
      )
      expect(calledTypes).toContain('spot')
      expect(calledTypes).toContain('future')
      expect(calledTypes).toContain('delivery')
    })

    it('sums USDT across all wallet types', async () => {
      mockFetchBalance.mockImplementation((params: Record<string, string>) => {
        if (params?.type === 'spot')     return Promise.resolve({ total: { USDT: 1000 } })
        if (params?.type === 'future')   return Promise.resolve({ total: { USDT: 5000 } })
        if (params?.type === 'delivery') return Promise.resolve({ total: { USDT: 0 } })
        return Promise.resolve({ total: {} })
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const balance = await adapter.fetchBalance()

      expect(balance.usdt).toBe(6000)
    })

    it('merges non-USDT tokens across wallet types', async () => {
      mockFetchBalance.mockImplementation((params: Record<string, string>) => {
        if (params?.type === 'spot')     return Promise.resolve({ total: { USDT: 0, BTC: 0.1 } })
        if (params?.type === 'future')   return Promise.resolve({ total: { USDT: 0, BTC: 0.2, ETH: 1.0 } })
        if (params?.type === 'delivery') return Promise.resolve({ total: { USDT: 0 } })
        return Promise.resolve({ total: {} })
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const balance = await adapter.fetchBalance()

      expect(balance.tokens['BTC']).toBeCloseTo(0.3)
      expect(balance.tokens['ETH']).toBe(1.0)
    })

    it('ignores failed wallet types gracefully', async () => {
      mockFetchBalance.mockImplementation((params: Record<string, string>) => {
        if (params?.type === 'spot')     return Promise.reject(new Error('spot unavailable'))
        if (params?.type === 'future')   return Promise.resolve({ total: { USDT: 5000 } })
        if (params?.type === 'delivery') return Promise.resolve({ total: { USDT: 0 } })
        return Promise.resolve({ total: {} })
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const balance = await adapter.fetchBalance()

      expect(balance.usdt).toBe(5000)
    })
  })
})

// ---------------------------------------------------------------------------
// OkxAdapter
// ---------------------------------------------------------------------------
describe('OkxAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchBalance.mockReset()
  })

  it('testConnection returns true on successful ping', async () => {
    mockFetchBalance.mockResolvedValue({ USDT: { free: 2000 }, total: { USDT: 2000 } })

    const { OkxAdapter } = await import('../okx')
    const adapter = new OkxAdapter({ apiKey: 'key', apiSecret: 'secret', passphrase: 'pass' })
    const result = await adapter.testConnection()

    expect(result).toBe(true)
  })

  it('testConnection returns false on auth error', async () => {
    mockFetchBalance.mockRejectedValue(new Error('AuthenticationError'))

    const { OkxAdapter } = await import('../okx')
    const adapter = new OkxAdapter({ apiKey: 'bad', apiSecret: 'bad', passphrase: 'bad' })
    const result = await adapter.testConnection()

    expect(result).toBe(false)
  })

  it('fetches trades for all 5 instTypes: SPOT, SWAP, FUTURES, OPTION, MARGIN', async () => {
    mockFetchTrades.mockResolvedValue([])

    const { OkxAdapter } = await import('../okx')
    const adapter = new OkxAdapter({ apiKey: 'key', apiSecret: 'secret', passphrase: 'pass' })
    await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

    expect(mockFetchTrades).toHaveBeenCalledTimes(5)
    const types = mockFetchTrades.mock.calls.map(
      (c) => (c[3] as Record<string, string>)?.type,
    )
    expect(types).toContain('SPOT')
    expect(types).toContain('SWAP')
    expect(types).toContain('FUTURES')
    expect(types).toContain('OPTION')
    expect(types).toContain('MARGIN')
  })

  it('merges trades from all instTypes into single array', async () => {
    mockFetchTrades.mockImplementation(
      (_s: unknown, _since: unknown, _limit: unknown, params: Record<string, string>) => {
        if (params?.type === 'SPOT') return Promise.resolve([{ ...sampleCcxtTrade, id: 'spot-1' }])
        if (params?.type === 'SWAP') return Promise.resolve([{ ...sampleCcxtTrade, id: 'swap-1' }])
        return Promise.resolve([])
      },
    )

    const { OkxAdapter } = await import('../okx')
    const adapter = new OkxAdapter({ apiKey: 'key', apiSecret: 'secret', passphrase: 'pass' })
    const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

    expect(trades.length).toBe(2)
  })

  it('handles empty result for an instType gracefully', async () => {
    mockFetchTrades.mockImplementation(
      (_s: unknown, _since: unknown, _limit: unknown, params: Record<string, string>) => {
        if (params?.type === 'SPOT') return Promise.resolve([{ ...sampleCcxtTrade, id: 'spot-1' }])
        if (params?.type === 'SWAP') return Promise.reject(new Error('instType not available'))
        return Promise.resolve([])
      },
    )

    const { OkxAdapter } = await import('../okx')
    const adapter = new OkxAdapter({ apiKey: 'key', apiSecret: 'secret', passphrase: 'pass' })
    const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

    expect(trades.length).toBe(1)
  })
})
