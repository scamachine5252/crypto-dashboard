const mockLoadMarkets = jest.fn()

jest.mock('ccxt', () => ({
  binance: jest.fn(() => ({ loadMarkets: mockLoadMarkets })),
}))

jest.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: jest.fn() } }))

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { GET } from '../markets/route'

const mockFrom = supabaseAdmin.from as jest.Mock

function makeAccountChain(instrument: string) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { instrument }, error: null }),
      }),
    }),
  }
}

function makeUrl(accountId: string) {
  return `http://localhost/api/sync/binance/markets?account_id=${accountId}`
}

describe('GET /api/sync/binance/markets', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFrom.mockReset()
    mockLoadMarkets.mockReset()
  })

  it('returns 400 if account_id is missing', async () => {
    // GET imported at top
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    expect(res.status).toBe(400)
  })

  it('returns 404 if account not found', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        }),
      }),
    })
    // GET imported at top
    const res = await GET(new NextRequest(makeUrl('bad-id')))
    expect(res.status).toBe(404)
  })

  it('returns totalChunks, chunkSize, and totalSymbols for spot account', async () => {
    mockFrom.mockReturnValue(makeAccountChain('spot'))
    const markets: Record<string, unknown> = {}
    for (let i = 0; i < 55; i++) {
      markets[`TOKEN${i}/USDT`] = { symbol: `TOKEN${i}/USDT`, quote: 'USDT', active: true }
    }
    for (let i = 0; i < 5; i++) {
      markets[`TOKEN${i}/BTC`] = { symbol: `TOKEN${i}/BTC`, quote: 'BTC', active: true }
    }
    mockLoadMarkets.mockResolvedValue(markets)

    // GET imported at top
    const res = await GET(new NextRequest(makeUrl('uuid-1')))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.totalSymbols).toBe(55)
    expect(json.chunkSize).toBe(50)
    expect(json.totalChunks).toBe(2)
  })

  it('excludes non-USDT quoted markets', async () => {
    mockFrom.mockReturnValue(makeAccountChain('spot'))
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT': { symbol: 'BTC/USDT', quote: 'USDT' },
      'ETH/BTC':  { symbol: 'ETH/BTC',  quote: 'BTC'  },
    })
    // GET imported at top
    const res = await GET(new NextRequest(makeUrl('uuid-1')))
    const json = await res.json()
    expect(json.totalSymbols).toBe(1)
  })

  it('returns totalChunks=0 and totalSymbols=0 if no matching markets', async () => {
    mockFrom.mockReturnValue(makeAccountChain('spot'))
    mockLoadMarkets.mockResolvedValue({})
    // GET imported at top
    const res = await GET(new NextRequest(makeUrl('uuid-1')))
    const json = await res.json()
    expect(json.totalSymbols).toBe(0)
    expect(json.totalChunks).toBe(0)
  })

  it('for futures account: only returns linear USDT markets', async () => {
    mockFrom.mockReturnValue(makeAccountChain('futures'))
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT':      { symbol: 'BTC/USDT',      quote: 'USDT', linear: false }, // spot — excluded
      'BTC/USDT:USDT': { symbol: 'BTC/USDT:USDT', quote: 'USDT', linear: true  }, // USDT-M — included
      'ETH/USDT:USDT': { symbol: 'ETH/USDT:USDT', quote: 'USDT', linear: true  }, // USDT-M — included
      'BTC/USD:BTC':   { symbol: 'BTC/USD:BTC',   quote: 'USD',  linear: false }, // inverse — excluded
    })
    // GET imported at top
    const res = await GET(new NextRequest(makeUrl('uuid-1')))
    const json = await res.json()
    expect(json.totalSymbols).toBe(2)
  })

  it('returns 500 if loadMarkets throws', async () => {
    mockFrom.mockReturnValue(makeAccountChain('spot'))
    mockLoadMarkets.mockRejectedValue(new Error('network error'))
    // GET imported at top
    const res = await GET(new NextRequest(makeUrl('uuid-1')))
    expect(res.status).toBe(500)
  })
})
