// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGetFullTrades = jest.fn()
const mockDiscoverTradedSymbols = jest.fn()

// Mock supabase
const mockSelectEqSingle = jest.fn()
const mockUpdateEq       = jest.fn()
const mockUpsert         = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'accounts') {
        return {
          select: jest.fn(() => ({ eq: jest.fn(() => ({ single: mockSelectEqSingle })) })),
          update: jest.fn(() => ({ eq: mockUpdateEq })),
        }
      }
      // trades table
      return { upsert: mockUpsert }
    }),
  },
}))

jest.mock('@/lib/crypto/decrypt', () => ({
  decrypt: jest.fn((s: string) => `dec:${s}`),
}))

jest.mock('@/lib/adapters/binance', () => ({
  BinanceAdapter: jest.fn().mockImplementation(() => ({
    getFullTrades:          mockGetFullTrades,
    discoverTradedSymbols:  mockDiscoverTradedSymbols,
  })),
}))

import { NextRequest } from 'next/server'

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/binance/full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/binance/full', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
describe('POST /api/sync/binance/full', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 400 if account_id is missing', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ symbol: 'BTCUSDT' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 if symbol is missing', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 if symbol is empty string', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', symbol: '', weeks: [0] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 if weeks is missing', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', symbol: 'BTCUSDT' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 if weeks is empty array', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', symbol: 'BTCUSDT', weeks: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 404 if account not found in Supabase', async () => {
    mockSelectEqSingle.mockResolvedValue({ data: null, error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'not-found', symbol: 'BTCUSDT', weeks: [0] }))
    expect(res.status).toBe(404)
  })

  it('calls getFullTrades with the symbol and weeks passed by the caller', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec', instrument: 'unified' },
      error: null,
    })
    mockGetFullTrades.mockResolvedValue({ trades: [], failedSymbols: [] })
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    await POST(makePost({ account_id: 'uuid-1', symbol: 'BTCUSDT', weeks: [0, 3, 15] }))

    expect(mockGetFullTrades).toHaveBeenCalledWith('BTCUSDT', [0, 3, 15])
  })

  it('upserts fetched trades and returns synced count', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'key', api_secret: 'sec', instrument: 'unified' },
      error: null,
    })
    mockGetFullTrades.mockResolvedValue({
      trades: [{
        id: 't1', symbol: 'BTC/USDT:USDT', side: 'long', tradeType: 'futures',
        entryPrice: 50000, exitPrice: 51000, quantity: 0.1, pnl: 100,
        pnlPercent: 0, fee: 5, durationMin: 0, leverage: 1,
        fundingCost: 0, isOvernight: false,
        openedAt: '2025-01-01T00:00:00.000Z',
        closedAt: '2025-01-01T00:00:00.000Z',
        subAccountId: '', exchangeId: 'binance',
      }],
      failedSymbols: [],
    })
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', symbol: 'BTCUSDT', weeks: [0] }))

    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalled()
    const json = await res.json()
    expect(json.synced).toBe(1)
    expect(json.failedSymbols).toEqual([])
  })

  it('returns 500 if upsert fails', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'key', api_secret: 'sec', instrument: 'unified' },
      error: null,
    })
    mockGetFullTrades.mockResolvedValue({
      trades: [{
        id: 't1', symbol: 'BTC/USDT:USDT', side: 'long', tradeType: 'futures',
        entryPrice: 50000, exitPrice: 51000, quantity: 0.1, pnl: 100,
        pnlPercent: 0, fee: 5, durationMin: 0, leverage: 1,
        fundingCost: 0, isOvernight: false,
        openedAt: '2025-01-01T00:00:00.000Z',
        closedAt: '2025-01-01T00:00:00.000Z',
        subAccountId: '', exchangeId: 'binance',
      }],
      failedSymbols: [],
    })
    mockUpsert.mockResolvedValue({ error: { message: 'db write failed' } })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', symbol: 'BTCUSDT', weeks: [0] }))

    expect(res.status).toBe(500)
  })

  it('returns failedSymbols from getFullTrades in the response', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'key', api_secret: 'sec', instrument: 'unified' },
      error: null,
    })
    mockGetFullTrades.mockResolvedValue({
      trades: [],
      failedSymbols: [{ symbol: 'BAD/USDT:USDT', error: 'invalid symbol' }],
    })
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', symbol: 'BADUSDT', weeks: [0] }))
    const json = await res.json()

    expect(json.failedSymbols).toHaveLength(1)
    expect(json.failedSymbols[0].symbol).toBe('BAD/USDT:USDT')
  })
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/sync/binance/full', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 400 if account_id is missing', async () => {
    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ done: true }))
    expect(res.status).toBe(400)
  })

  it('writes last_full_sync_at to accounts and returns { ok: true }', async () => {
    mockUpdateEq.mockResolvedValue({ error: null })

    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ account_id: 'uuid-1', done: true }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'uuid-1')
  })

  it('writes last_full_sync_at even when previous chunks had failedSymbols', async () => {
    mockUpdateEq.mockResolvedValue({ error: null })

    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ account_id: 'uuid-with-some-failures', done: true }))

    expect(res.status).toBe(200)
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'uuid-with-some-failures')
  })
})
