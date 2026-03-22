// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGetTrades = jest.fn()
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

jest.mock('@/lib/adapters/bybit', () => ({
  BybitAdapter: jest.fn().mockImplementation(() => ({
    getTrades: mockGetTrades,
  })),
}))

import { NextRequest } from 'next/server'

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/bybit/full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/bybit/full', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
describe('POST /api/sync/bybit/full', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 400 if account_id is missing', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ chunk_index: 0 }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/account_id/)
  })

  it('returns 400 if chunk_index is missing', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/chunk_index/)
  })

  it('returns 400 if chunk_index is not a non-negative integer', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: -1 }))
    expect(res.status).toBe(400)
  })

  it('returns 404 if account not found in Supabase', async () => {
    mockSelectEqSingle.mockResolvedValue({ data: null, error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'not-found', chunk_index: 0 }))
    expect(res.status).toBe(404)
  })

  it('returns 404 if Supabase returns an error for account lookup', async () => {
    mockSelectEqSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'bad-id', chunk_index: 0 }))
    expect(res.status).toBe(404)
  })

  it('returns { synced, failedCategories } on success with empty trades', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec' },
      error: null,
    })
    mockGetTrades.mockResolvedValue([])
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.synced).toBe(0)
    expect(json.failedCategories).toEqual([])
  })

  it('upserts fetched trades and returns correct synced count', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec' },
      error: null,
    })
    mockGetTrades.mockResolvedValue([
      {
        id: 't1', symbol: 'BTC/USDT', side: 'long', tradeType: 'futures',
        entryPrice: 50000, exitPrice: 51000, quantity: 0.1, pnl: 100,
        pnlPercent: 2, fee: 5, durationMin: 60, leverage: 10,
        fundingCost: 0, isOvernight: false,
        openedAt: '2025-01-01T00:00:00.000Z',
        closedAt: '2025-01-01T01:00:00.000Z',
        subAccountId: 'bybit', exchangeId: 'bybit',
      },
    ])
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 2 }))

    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalled()
    const json = await res.json()
    expect(json.synced).toBe(1)
    expect(json.failedCategories).toEqual([])
  })

  it('returns 500 if upsert fails', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec' },
      error: null,
    })
    mockGetTrades.mockResolvedValue([
      {
        id: 't1', symbol: 'ETH/USDT', side: 'short', tradeType: 'futures',
        entryPrice: 3000, exitPrice: 2900, quantity: 1, pnl: 100,
        pnlPercent: 3.33, fee: 3, durationMin: 30, leverage: 5,
        fundingCost: 0, isOvernight: false,
        openedAt: '2025-01-02T00:00:00.000Z',
        closedAt: '2025-01-02T00:30:00.000Z',
        subAccountId: 'bybit', exchangeId: 'bybit',
      },
    ])
    mockUpsert.mockResolvedValue({ error: { message: 'db write failed' } })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(500)
  })

  it('returns 500 if getTrades throws', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec' },
      error: null,
    })
    mockGetTrades.mockRejectedValue(new Error('exchange timeout'))

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/exchange timeout/)
  })

  it('passes correct since and limit to getTrades (until filtered post-fetch)', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec' },
      error: null,
    })
    mockGetTrades.mockResolvedValue([])
    mockUpsert.mockResolvedValue({ error: null })

    const before = Date.now()
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))
    const after = Date.now()

    expect(res.status).toBe(200)
    // getTrades called with only since + limit — until is NOT passed (post-fetch filtered)
    const [, , since, limit, until] = mockGetTrades.mock.calls[0]
    const expectedSince = before - 6 * 30 * 24 * 60 * 60 * 1000
    expect(since).toBeGreaterThanOrEqual(expectedSince - 1000)
    expect(since).toBeLessThanOrEqual(after - 6 * 30 * 24 * 60 * 60 * 1000 + 1000)
    expect(limit).toBe(1000)
    expect(until).toBeUndefined() // not passed — filtering done post-fetch
  })

  it('deduplicates trades with same account_id/symbol/openedAt before upsert', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec' },
      error: null,
    })
    const dupTrade = {
      id: 't1', symbol: 'BTC/USDT', side: 'long', tradeType: 'spot',
      entryPrice: 50000, exitPrice: 50000, quantity: 0.1, pnl: 10,
      pnlPercent: 0.2, fee: 5, durationMin: 0, leverage: 1,
      fundingCost: 0, isOvernight: false,
      openedAt: '2025-01-01T00:00:00.000Z',
      closedAt: '2025-01-01T00:00:00.000Z',
      subAccountId: 'bybit', exchangeId: 'bybit',
    }
    mockGetTrades.mockResolvedValue([dupTrade, dupTrade])
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    const json = await res.json()
    expect(json.synced).toBe(1) // deduped from 2 → 1
  })
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/sync/bybit/full', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 400 if account_id is missing', async () => {
    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ done: true }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/account_id/)
  })

  it('writes last_full_sync_at and full_sync_failed_count, returns { ok: true }', async () => {
    mockUpdateEq.mockResolvedValue({ error: null })

    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ account_id: 'uuid-1', failed_count: 2 }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'uuid-1')
  })

  it('defaults failed_count to 0 if not provided', async () => {
    mockUpdateEq.mockResolvedValue({ error: null })

    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ account_id: 'uuid-1' }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('returns 500 if Supabase update fails', async () => {
    mockUpdateEq.mockResolvedValue({ error: { message: 'update failed' } })

    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ account_id: 'uuid-1' }))

    expect(res.status).toBe(500)
  })
})
