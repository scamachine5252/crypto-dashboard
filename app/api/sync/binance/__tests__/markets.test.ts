const mockLoadMarkets = jest.fn()

jest.mock('ccxt', () => ({
  binance: jest.fn(() => ({ loadMarkets: mockLoadMarkets })),
}))

import { NextRequest } from 'next/server'

describe('GET /api/sync/binance/markets', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns totalChunks, chunkSize, and totalSymbols', async () => {
    // 55 USDT spot markets → ceil(55/50) = 2 chunks
    const markets: Record<string, unknown> = {}
    for (let i = 0; i < 55; i++) {
      markets[`TOKEN${i}/USDT`] = { symbol: `TOKEN${i}/USDT`, quote: 'USDT', type: 'spot', active: true }
    }
    // 5 BTC-quoted — must be excluded
    for (let i = 0; i < 5; i++) {
      markets[`TOKEN${i}/BTC`] = { symbol: `TOKEN${i}/BTC`, quote: 'BTC', type: 'spot', active: true }
    }
    mockLoadMarkets.mockResolvedValue(markets)

    const { GET } = await import('../markets/route')
    const req = new NextRequest('http://localhost/api/sync/binance/markets')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.totalSymbols).toBe(55)
    expect(json.chunkSize).toBe(50)
    expect(json.totalChunks).toBe(2)
  })

  it('includes inactive (delisted) USDT markets', async () => {
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT':  { symbol: 'BTC/USDT',  quote: 'USDT', type: 'spot',   active: true  },
      'LUNA/USDT': { symbol: 'LUNA/USDT', quote: 'USDT', type: 'spot',   active: false },
    })

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    const json = await res.json()

    expect(json.totalSymbols).toBe(2)
  })

  it('includes linear (USDT-M futures) markets alongside spot', async () => {
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT':      { symbol: 'BTC/USDT',      quote: 'USDT', type: 'spot', active: true },
      'BTC/USDT:USDT': { symbol: 'BTC/USDT:USDT', quote: 'USDT', type: 'swap', active: true, linear: true },
      'ETH/BTC':       { symbol: 'ETH/BTC',        quote: 'BTC',  type: 'spot', active: true },
    })

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    const json = await res.json()

    expect(json.totalSymbols).toBe(2)
  })

  it('excludes non-USDT quoted markets', async () => {
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT': { symbol: 'BTC/USDT', quote: 'USDT', type: 'spot', active: true },
      'ETH/BTC':  { symbol: 'ETH/BTC',  quote: 'BTC',  type: 'spot', active: true },
    })

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    const json = await res.json()

    expect(json.totalSymbols).toBe(1)
  })

  it('returns totalChunks=0 and totalSymbols=0 if no USDT markets', async () => {
    mockLoadMarkets.mockResolvedValue({})

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    const json = await res.json()

    expect(json.totalSymbols).toBe(0)
    expect(json.totalChunks).toBe(0)
  })

  it('returns 500 if loadMarkets throws', async () => {
    mockLoadMarkets.mockRejectedValue(new Error('network error'))

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))

    expect(res.status).toBe(500)
  })
})
