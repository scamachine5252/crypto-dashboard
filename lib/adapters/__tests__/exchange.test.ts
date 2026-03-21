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
// mapCcxtTrade
// ---------------------------------------------------------------------------
import { mapCcxtTrade } from '../ccxt-utils'
import type { DateRange } from '../../types'

describe('mapCcxtTrade', () => {
  describe('tradeType detection', () => {
    it('classifies spot symbol (no colon) as spot', () => {
      const trade = mapCcxtTrade({ symbol: 'BTC/USDT', side: 'buy' }, 'binance')
      expect(trade.tradeType).toBe('spot')
    })

    it('classifies linear futures symbol (colon-separated) as futures', () => {
      const trade = mapCcxtTrade({ symbol: 'BTC/USDT:USDT', side: 'buy' }, 'bybit')
      expect(trade.tradeType).toBe('futures')
    })

    it('classifies inverse futures symbol as futures', () => {
      const trade = mapCcxtTrade({ symbol: 'BTC/USD:BTC', side: 'buy' }, 'bybit')
      expect(trade.tradeType).toBe('futures')
    })

    it('classifies option symbol as futures', () => {
      const trade = mapCcxtTrade({ symbol: 'BTC/USDT:USDT-250101-50000-C', side: 'buy' }, 'okx')
      expect(trade.tradeType).toBe('futures')
    })

    it('classifies 1x leverage futures correctly as futures (regression test)', () => {
      // leverage=1 + colon symbol = futures (old heuristic would misclassify this as spot)
      const trade = mapCcxtTrade({ symbol: 'ETH/USDT:USDT', side: 'buy', info: { leverage: 1 } }, 'bybit')
      expect(trade.tradeType).toBe('futures')
    })
  })
})

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

  it('passes until to CCXT params when provided', async () => {
    mockFetchTrades.mockResolvedValue([])
    const until = 1700000000000
    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    await adapter.getTrades('all', {} as DateRange, 0, 100, until)
    // fetchMyTrades is called once per category (4 times). Check any call has until in params.
    const anyCall = mockFetchTrades.mock.calls.find((c) => (c[3] as Record<string, unknown>)?.until === until)
    expect(anyCall).toBeDefined()
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

    it('throws if all wallet types fail', async () => {
      mockFetchBalance.mockImplementation((params: Record<string, string>) => {
        if (params?.type === 'spot')     return Promise.reject(new Error('spot unavailable'))
        if (params?.type === 'future')   return Promise.reject(new Error('future unavailable'))
        if (params?.type === 'delivery') return Promise.reject(new Error('delivery unavailable'))
        return Promise.reject(new Error('unknown wallet unavailable'))
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })

      await expect(adapter.fetchBalance()).rejects.toThrow()
    })
  })

  describe('getTrades (quick sync)', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      mockFetchBalance.mockReset()
      mockFetchTrades.mockReset()
    })

    it('calls fetchBalance({type: spot}) to derive token symbol list', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100, BTC: 0.5 } })
      mockFetchTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(mockFetchBalance).toHaveBeenCalledWith({ type: 'spot' })
    })

    it('includes token-derived symbol in the fetch list', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100, SOL: 10 } })
      mockFetchTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      const calledSymbols = mockFetchTrades.mock.calls.map((c) => c[0] as string)
      expect(calledSymbols).toContain('SOL/USDT')
    })

    it('always includes BTC/USDT and ETH/USDT from hardcoded top-50 list', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } })
      mockFetchTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      const calledSymbols = mockFetchTrades.mock.calls.map((c) => c[0] as string)
      expect(calledSymbols).toContain('BTC/USDT')
      expect(calledSymbols).toContain('ETH/USDT')
    })

    it('deduplicates symbols — BTC in balance AND top-50 is fetched only once', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100, BTC: 0.1 } })
      mockFetchTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      const calledSymbols = mockFetchTrades.mock.calls.map((c) => c[0] as string)
      expect(calledSymbols.filter((s) => s === 'BTC/USDT')).toHaveLength(1)
    })

    it('passes since parameter to every fetchMyTrades call', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } })
      mockFetchTrades.mockResolvedValue([])
      const since = Date.now() - 48 * 3600_000

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, since)

      mockFetchTrades.mock.calls.forEach((call) => {
        expect(call[1]).toBe(since)
      })
    })

    it('maps returned ccxt trades to Trade objects', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } })
      mockFetchTrades.mockImplementation((symbol: string) => {
        if (symbol === 'BTC/USDT') return Promise.resolve([{ ...sampleCcxtTrade, symbol: 'BTC/USDT' }])
        return Promise.resolve([])
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(trades.length).toBeGreaterThan(0)
      expect(trades[0].symbol).toBe('BTC/USDT')
    })

    it('skips a symbol silently if fetchMyTrades throws — does not crash', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } })
      mockFetchTrades.mockRejectedValue(new Error('invalid symbol'))

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(trades).toEqual([])
    })

    it('returns trades from successful symbols when some symbols fail', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } })
      mockFetchTrades.mockImplementation((symbol: string) => {
        if (symbol === 'BTC/USDT') return Promise.resolve([{ ...sampleCcxtTrade, symbol: 'BTC/USDT' }])
        if (symbol === 'ETH/USDT') return Promise.reject(new Error('invalid symbol'))
        return Promise.resolve([])
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(trades.length).toBeGreaterThan(0)
      expect(trades.some((t) => t.symbol === 'BTC/USDT')).toBe(true)
    })
  })

  describe('getFullTrades (full scan)', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      mockFetchTrades.mockReset()
    })

    it('calls fetchMyTrades for each symbol with a ~180-day since window', async () => {
      mockFetchTrades.mockResolvedValue([])
      const before = Date.now()

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getFullTrades(['BTC/USDT', 'ETH/USDT'])

      expect(mockFetchTrades).toHaveBeenCalledTimes(2)
      const sinceArg = mockFetchTrades.mock.calls[0][1] as number
      const expected180d = before - 180 * 24 * 3600_000
      expect(sinceArg).toBeGreaterThanOrEqual(expected180d - 1000)
      expect(sinceArg).toBeLessThanOrEqual(expected180d + 5000)
    })

    it('retries a failed symbol exactly once before marking it failed', async () => {
      let callCount = 0
      mockFetchTrades.mockImplementation(() => {
        callCount++
        return Promise.reject(new Error('rate limit'))
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades(['BTC/USDT'])

      expect(callCount).toBe(2) // 1 original + 1 retry
      expect(result.failedSymbols).toHaveLength(1)
      expect(result.failedSymbols[0].symbol).toBe('BTC/USDT')
      expect(result.failedSymbols[0].error).toMatch(/rate limit/)
    }, 10_000)

    it('succeeds on retry if first attempt fails', async () => {
      let callCount = 0
      mockFetchTrades.mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject(new Error('timeout'))
        return Promise.resolve([{ ...sampleCcxtTrade, symbol: 'BTC/USDT' }])
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades(['BTC/USDT'])

      expect(result.trades).toHaveLength(1)
      expect(result.failedSymbols).toHaveLength(0)
    }, 10_000)

    it('continues loop when one symbol fails — does not stop', async () => {
      mockFetchTrades.mockImplementation((symbol: string) => {
        if (symbol === 'ETH/USDT') return Promise.reject(new Error('symbol error'))
        return Promise.resolve([{ ...sampleCcxtTrade, symbol }])
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades(['BTC/USDT', 'ETH/USDT', 'SOL/USDT'])

      expect(result.trades).toHaveLength(2) // BTC + SOL
      expect(result.failedSymbols).toHaveLength(1)
      expect(result.failedSymbols[0].symbol).toBe('ETH/USDT')
    }, 10_000)

    it('returns empty result for empty symbol list without calling fetchMyTrades', async () => {
      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades([])

      expect(result.trades).toEqual([])
      expect(result.failedSymbols).toEqual([])
      expect(mockFetchTrades).not.toHaveBeenCalled()
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

  it('passes until to CCXT params when provided', async () => {
    mockFetchTrades.mockResolvedValue([])
    const until = 1700000000000
    const { OkxAdapter } = await import('../okx')
    const adapter = new OkxAdapter({ apiKey: 'key', apiSecret: 'secret', passphrase: 'pass' })
    await adapter.getTrades('all', {} as DateRange, 0, 100, until)
    const anyCall = mockFetchTrades.mock.calls.find((c) => (c[3] as Record<string, unknown>)?.until === until)
    expect(anyCall).toBeDefined()
  })
})
