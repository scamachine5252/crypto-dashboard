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
})
