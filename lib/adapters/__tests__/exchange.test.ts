// ---------------------------------------------------------------------------
// Mock ccxt entirely — no real network calls
// ---------------------------------------------------------------------------
const mockFetchBalance               = jest.fn()
const mockFetchTrades                = jest.fn()
const mockLoadMarkets                = jest.fn()
const mockPrivateGetV5ClosedPnl      = jest.fn()
const mockFapiGetUserTrades          = jest.fn()
const mockFapiGetIncome              = jest.fn()

const mockExchangeInstance = {
  fetchBalance:                    mockFetchBalance,
  fetchMyTrades:                   mockFetchTrades,
  loadMarkets:                     mockLoadMarkets,
  privateGetV5PositionClosedPnl:   mockPrivateGetV5ClosedPnl,
  fapiPrivateGetUserTrades:        mockFapiGetUserTrades,
  fapiPrivateGetIncome:            mockFapiGetIncome,
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
    mockPrivateGetV5ClosedPnl.mockReset()
    // Default: return empty closed-pnl list so tests that don't care about futures pass
    mockPrivateGetV5ClosedPnl.mockResolvedValue({ result: { list: [], nextPageCursor: '' } })
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

  it('calls fetchMyTrades for spot only, privateGetV5PositionClosedPnl for linear and inverse', async () => {
    mockFetchTrades.mockResolvedValue([])

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

    // fetchMyTrades called once for spot only (not for futures — uses closed-pnl endpoint)
    expect(mockFetchTrades).toHaveBeenCalledTimes(1)
    expect((mockFetchTrades.mock.calls[0][3] as Record<string, string>)?.category).toBe('spot')

    // closed-pnl endpoint called twice: linear + inverse
    expect(mockPrivateGetV5ClosedPnl).toHaveBeenCalledTimes(2)
    const categories = mockPrivateGetV5ClosedPnl.mock.calls.map(
      (c) => (c[0] as Record<string, string>)?.category,
    )
    expect(categories).toContain('linear')
    expect(categories).toContain('inverse')
  })

  it('extracts real closedPnl from privateGetV5PositionClosedPnl response', async () => {
    mockFetchTrades.mockResolvedValue([])
    mockPrivateGetV5ClosedPnl.mockImplementation((params: Record<string, string>) => {
      if (params.category === 'linear') {
        return Promise.resolve({
          result: {
            list: [
              {
                symbol: 'BTCUSDT', side: 'Sell', orderId: 'order-1',
                avgEntryPrice: '50000', avgExitPrice: '51000',
                closedSize: '0.1', closedPnl: '100.5',
                leverage: '10', createdTime: '1700000000000', updatedTime: '1700000001000',
              },
            ],
            nextPageCursor: '',
          },
        })
      }
      return Promise.resolve({ result: { list: [], nextPageCursor: '' } })
    })

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const trades = await adapter.getTrades('all', {} as DateRange)

    const futureTrade = trades.find((t) => t.symbol === 'BTC/USDT:USDT')
    expect(futureTrade).toBeDefined()
    expect(futureTrade?.pnl).toBe(100.5)
    expect(futureTrade?.entryPrice).toBe(50000)
    expect(futureTrade?.exitPrice).toBe(51000)
    expect(futureTrade?.tradeType).toBe('futures')
  })

  it('maps Sell-side close to long direction, Buy-side close to short direction', async () => {
    mockFetchTrades.mockResolvedValue([])
    mockPrivateGetV5ClosedPnl.mockImplementation((params: Record<string, string>) => {
      if (params.category === 'linear') {
        return Promise.resolve({
          result: {
            list: [
              { symbol: 'BTCUSDT', side: 'Sell', orderId: 'o1', avgEntryPrice: '50000', avgExitPrice: '51000', closedSize: '0.1', closedPnl: '100', leverage: '10', createdTime: '1700000000000', updatedTime: '1700000001000' },
              { symbol: 'ETHUSDT', side: 'Buy',  orderId: 'o2', avgEntryPrice: '3000',  avgExitPrice: '2900',  closedSize: '1',   closedPnl: '100', leverage: '5',  createdTime: '1700000002000', updatedTime: '1700000003000' },
            ],
            nextPageCursor: '',
          },
        })
      }
      return Promise.resolve({ result: { list: [], nextPageCursor: '' } })
    })

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const trades = await adapter.getTrades('all', {} as DateRange)

    const btc = trades.find((t) => t.symbol === 'BTC/USDT:USDT')
    const eth = trades.find((t) => t.symbol === 'ETH/USDT:USDT')
    expect(btc?.side).toBe('long')   // Sell to close = was long
    expect(eth?.side).toBe('short')  // Buy to close  = was short
  })

  it('paginates closed-pnl until nextPageCursor is empty', async () => {
    mockFetchTrades.mockResolvedValue([])
    let page = 0
    mockPrivateGetV5ClosedPnl.mockImplementation((params: Record<string, string>) => {
      if (params.category !== 'linear') return Promise.resolve({ result: { list: [], nextPageCursor: '' } })
      page++
      if (page === 1) {
        return Promise.resolve({
          result: {
            list: [{ symbol: 'BTCUSDT', side: 'Sell', orderId: 'o1', avgEntryPrice: '50000', avgExitPrice: '51000', closedSize: '0.1', closedPnl: '50', leverage: '10', createdTime: '1700000000000', updatedTime: '1700000001000' }],
            nextPageCursor: 'page2cursor',
          },
        })
      }
      return Promise.resolve({
        result: {
          list: [{ symbol: 'BTCUSDT', side: 'Buy', orderId: 'o2', avgEntryPrice: '50000', avgExitPrice: '49000', closedSize: '0.1', closedPnl: '-50', leverage: '10', createdTime: '1700000010000', updatedTime: '1700000011000' }],
          nextPageCursor: '',
        },
      })
    })

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const trades = await adapter.getTrades('all', {} as DateRange)

    const futures = trades.filter((t) => t.tradeType === 'futures')
    expect(futures.length).toBe(2)  // fetched 2 pages
  })

  it('handles privateGetV5PositionClosedPnl failure gracefully (returns spot trades only)', async () => {
    mockFetchTrades.mockResolvedValue([{ ...sampleCcxtTrade, id: 'spot-1' }])
    mockPrivateGetV5ClosedPnl.mockRejectedValue(new Error('API error'))

    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const trades = await adapter.getTrades('all', {} as DateRange)

    expect(trades.length).toBe(1)  // only spot trades
    expect(trades[0].symbol).toBe('BTC/USDT')
  })

  it('passes until to privateGetV5PositionClosedPnl as endTime', async () => {
    mockFetchTrades.mockResolvedValue([])
    const until = 1700000000000
    const { BybitAdapter } = await import('../bybit')
    const adapter = new BybitAdapter({ apiKey: 'key', apiSecret: 'secret' })
    await adapter.getTrades('all', {} as DateRange, 0, 100, until)

    const anyCall = mockPrivateGetV5ClosedPnl.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.endTime === until,
    )
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

  describe('getTrades (quick sync — futures)', () => {
    const sampleRawFapiTrade = {
      id: 1, orderId: 2, symbol: 'BTCUSDT', side: 'BUY',
      price: '50000', qty: '0.1', realizedPnl: '100',
      commission: '5', commissionAsset: 'USDT',
      time: 1704067200000, positionSide: 'LONG',
    }

    beforeEach(() => {
      jest.clearAllMocks()
      mockFapiGetIncome.mockReset()
      mockFapiGetUserTrades.mockReset()
    })

    it('uses fapiPrivateGetIncome to discover traded symbols', async () => {
      mockFapiGetIncome.mockResolvedValue([{ symbol: 'BTCUSDT' }])
      mockFapiGetUserTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(mockFapiGetIncome).toHaveBeenCalledTimes(1)
      const arg = mockFapiGetIncome.mock.calls[0][0] as Record<string, unknown>
      expect(arg.incomeType).toBe('REALIZED_PNL')
      expect(typeof arg.startTime).toBe('number')
      expect(typeof arg.endTime).toBe('number')
    })

    it('calls fapiPrivateGetUserTrades for each discovered symbol with startTime+endTime', async () => {
      mockFapiGetIncome.mockResolvedValue([{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }])
      mockFapiGetUserTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(mockFapiGetUserTrades).toHaveBeenCalledTimes(2)
      const arg = mockFapiGetUserTrades.mock.calls[0][0] as Record<string, unknown>
      expect(typeof arg.endTime).toBe('number')
    })

    it('derives entryPrice correctly: long = exitPrice - pnl/qty', async () => {
      mockFapiGetIncome.mockResolvedValue([{ symbol: 'BTCUSDT' }])
      mockFapiGetUserTrades.mockResolvedValue([
        { ...sampleRawFapiTrade, price: '51000', realizedPnl: '100', qty: '0.1', positionSide: 'LONG' },
      ])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

      expect(trades[0].exitPrice).toBe(51000)
      expect(trades[0].entryPrice).toBeCloseTo(51000 - 100 / 0.1)  // = 50000
    })

    it('derives entryPrice correctly: short = exitPrice + pnl/qty', async () => {
      mockFapiGetIncome.mockResolvedValue([{ symbol: 'BTCUSDT' }])
      mockFapiGetUserTrades.mockResolvedValue([
        { ...sampleRawFapiTrade, price: '49000', realizedPnl: '100', qty: '0.1', positionSide: 'SHORT' },
      ])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

      expect(trades[0].exitPrice).toBe(49000)
      expect(trades[0].entryPrice).toBeCloseTo(49000 + 100 / 0.1)  // = 50000
    })

    it('returns empty if income returns nothing', async () => {
      mockFapiGetIncome.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

      expect(trades).toEqual([])
      expect(mockFapiGetUserTrades).not.toHaveBeenCalled()
    })

    it('skips symbol silently if fapiPrivateGetUserTrades throws', async () => {
      mockFapiGetIncome.mockResolvedValue([{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }])
      mockFapiGetUserTrades.mockImplementation((p: Record<string, unknown>) => {
        if (p.symbol === 'ETHUSDT') return Promise.reject(new Error('invalid symbol'))
        return Promise.resolve([sampleRawFapiTrade])
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' })

      expect(trades).toHaveLength(1)
      expect(trades[0].symbol).toBe('BTC/USDT:USDT')
    })
  })

  it('always creates futures exchange instance (defaultType: future)', async () => {
    const ccxtMod = await import('ccxt')
    const { BinanceAdapter } = await import('../binance')
    new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
    const ctorOptions = (ccxtMod.binance as jest.Mock).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect((ctorOptions?.options as Record<string, unknown>)?.defaultType).toBe('future')
  })

  it('sets portfolioMargin flag when portfolioMargin credential is true', async () => {
    const ccxtMod = await import('ccxt')
    const { BinanceAdapter } = await import('../binance')
    new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret', portfolioMargin: true })
    const ctorOptions = (ccxtMod.binance as jest.Mock).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect((ctorOptions?.options as Record<string, unknown>)?.portfolioMargin).toBe(true)
  })

  describe('discoverTradedSymbols', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      mockFapiGetIncome.mockReset()
    })

    it('calls fapiPrivateGetIncome for full 180-day window', async () => {
      mockFapiGetIncome.mockResolvedValue([{ symbol: 'BTCUSDT', time: Date.now() - 1000 }])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const before = Date.now()
      await adapter.discoverTradedSymbols()

      expect(mockFapiGetIncome).toHaveBeenCalledTimes(1)
      const arg = mockFapiGetIncome.mock.calls[0][0] as Record<string, unknown>
      expect(arg.incomeType).toBe('REALIZED_PNL')
      const expectedStart = before - 180 * 24 * 3600_000
      expect(arg.startTime as number).toBeGreaterThanOrEqual(expectedStart - 5000)
      expect(typeof arg.endTime).toBe('number')
    })

    it('returns DiscoveredSymbol[] with rawSymbol and weekIndices', async () => {
      const now = Date.now()
      const scanStart = now - 180 * 24 * 3600_000
      mockFapiGetIncome.mockResolvedValue([
        { symbol: 'BTCUSDT', time: scanStart + 1000 },           // week 0
        { symbol: 'ETHUSDT', time: scanStart + 14 * 24 * 3600_000 + 1000 }, // week 2
        { symbol: 'BTCUSDT', time: scanStart + 7 * 24 * 3600_000 + 1000 },  // week 1 (dupe symbol)
      ])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.discoverTradedSymbols()

      expect(result).toHaveLength(2)
      const btc = result.find((s) => s.rawSymbol === 'BTCUSDT')
      const eth = result.find((s) => s.rawSymbol === 'ETHUSDT')
      expect(btc?.weekIndices).toContain(0)
      expect(btc?.weekIndices).toContain(1)
      expect(eth?.weekIndices).toContain(2)
    })

    it('returns empty array if income API throws', async () => {
      mockFapiGetIncome.mockRejectedValue(new Error('network error'))

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.discoverTradedSymbols()

      expect(result).toEqual([])
    })

    it('returns empty array if no income events', async () => {
      mockFapiGetIncome.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.discoverTradedSymbols()

      expect(result).toEqual([])
    })
  })

  describe('getFullTrades (full scan — per symbol, 26 windows)', () => {
    const sampleRawFapiTrade = {
      id: 1, orderId: 2, symbol: 'BTCUSDT', side: 'BUY',
      price: '50000', qty: '0.1', realizedPnl: '100',
      commission: '5', commissionAsset: 'USDT',
      time: 1704067200000, positionSide: 'LONG',
    }

    beforeEach(() => {
      jest.clearAllMocks()
      mockFapiGetIncome.mockReset()
      mockFapiGetUserTrades.mockReset()
    })

    it('does NOT call fapiPrivateGetIncome (income discovery is separate)', async () => {
      mockFapiGetUserTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getFullTrades('BTCUSDT', [0, 3, 15])

      expect(mockFapiGetIncome).not.toHaveBeenCalled()
    })

    it('calls fapiPrivateGetUserTrades only for the provided weekIndices', async () => {
      mockFapiGetUserTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getFullTrades('BTCUSDT', [0, 5, 12])

      expect(mockFapiGetUserTrades).toHaveBeenCalledTimes(3)
    })

    it('passes the rawSymbol and time windows to fapiPrivateGetUserTrades', async () => {
      mockFapiGetUserTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getFullTrades('ETHUSDT', [2])

      const firstCall = mockFapiGetUserTrades.mock.calls[0][0] as Record<string, unknown>
      expect(firstCall.symbol).toBe('ETHUSDT')
      expect(typeof firstCall.startTime).toBe('number')
      expect(typeof firstCall.endTime).toBe('number')
      expect(firstCall.endTime as number).toBeGreaterThan(firstCall.startTime as number)
    })

    it('maps positionSide LONG → side long with correct entryPrice derivation', async () => {
      mockFapiGetUserTrades.mockResolvedValueOnce([
        { ...sampleRawFapiTrade, price: '51000', realizedPnl: '100', qty: '0.1', positionSide: 'LONG' },
      ])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades('BTCUSDT', [0])

      expect(result.trades[0].side).toBe('long')
      expect(result.trades[0].exitPrice).toBe(51000)
      expect(result.trades[0].entryPrice).toBeCloseTo(51000 - 100 / 0.1)  // = 50000
    })

    it('maps positionSide SHORT → side short with correct entryPrice derivation', async () => {
      mockFapiGetUserTrades.mockResolvedValueOnce([
        { ...sampleRawFapiTrade, price: '49000', realizedPnl: '100', qty: '0.1', positionSide: 'SHORT' },
      ])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades('BTCUSDT', [0])

      expect(result.trades[0].side).toBe('short')
      expect(result.trades[0].exitPrice).toBe(49000)
      expect(result.trades[0].entryPrice).toBeCloseTo(49000 + 100 / 0.1)  // = 50000
    })

    it('marks symbol as failed and stops if fapiPrivateGetUserTrades throws', async () => {
      mockFapiGetUserTrades.mockRejectedValue(new Error('rate limit'))

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades('BTCUSDT', [0, 3, 15])

      expect(result.failedSymbols).toHaveLength(1)
      expect(result.failedSymbols[0].symbol).toBe('BTC/USDT:USDT')
      expect(result.failedSymbols[0].error).toMatch(/rate limit/)
      // should stop after first failure (break)
      expect(mockFapiGetUserTrades).toHaveBeenCalledTimes(1)
    })

    it('maps pnl and fee from raw Binance fields', async () => {
      mockFapiGetUserTrades.mockResolvedValueOnce([
        { ...sampleRawFapiTrade, realizedPnl: '123.45', commission: '0.99' },
      ])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades('BTCUSDT', [0])

      expect(result.trades[0].pnl).toBe(123.45)
      expect(result.trades[0].fee).toBe(0.99)
    })

    it('accumulates trades from multiple windows', async () => {
      mockFapiGetUserTrades.mockResolvedValueOnce([sampleRawFapiTrade])
      mockFapiGetUserTrades.mockResolvedValueOnce([sampleRawFapiTrade])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades('BTCUSDT', [0, 5])

      expect(result.trades).toHaveLength(2)
      expect(result.failedSymbols).toHaveLength(0)
    })

    it('returns empty when weekIndices is empty', async () => {
      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades('BTCUSDT', [])

      expect(result.trades).toEqual([])
      expect(result.failedSymbols).toEqual([])
      expect(mockFapiGetUserTrades).not.toHaveBeenCalled()
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
