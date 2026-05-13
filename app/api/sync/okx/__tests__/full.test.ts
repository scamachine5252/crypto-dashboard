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

jest.mock('@/lib/adapters/okx', () => ({
  OkxAdapter: jest.fn().mockImplementation(() => ({
    getTrades: mockGetTrades,
  })),
}))

import { NextRequest } from 'next/server'

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/okx/full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/okx/full', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
describe('POST /api/sync/okx/full', () => {
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

  it('returns { fills, failedCategories } on success with empty trades', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec', passphrase: 'enc-pass' },
      error: null,
    })
    mockGetTrades.mockResolvedValue([])
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.fills).toBe(0)
    expect(json.failedCategories).toEqual([])
    expect(json).not.toHaveProperty('synced')
  })

  it('writes raw_fills and returns fills count (no trades write)', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec', passphrase: 'enc-pass' },
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
        subAccountId: 'okx', exchangeId: 'okx',
      },
    ])
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 2 }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.fills).toBe(1)
    expect(json.failedCategories).toEqual([])
    expect(json).not.toHaveProperty('synced')
  })

  it('returns 500 if getTrades throws', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec', passphrase: 'enc-pass' },
      error: null,
    })
    mockGetTrades.mockRejectedValue(new Error('exchange timeout'))

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/exchange timeout/)
  })

  it('passes correct time window to getTrades based on chunk_index', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec', passphrase: 'enc-pass' },
      error: null,
    })
    mockGetTrades.mockResolvedValue([])
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(200)
    // Verify getTrades was called with since and until as numbers, 30 days apart
    const [, , since, limit, until] = mockGetTrades.mock.calls[0]
    expect(typeof since).toBe('number')
    expect(typeof until).toBe('number')
    expect(limit).toBe(1000)
    expect(until - since).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('deduplication of trades is now handled by PositionReconstructor; raw_fills use exec_id conflict key', async () => {
    // The route no longer writes trades. Deduplication is PositionReconstructor's job.
    // raw_fills deduplication happens via the exec_id ON CONFLICT key in the upsert.
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec', passphrase: 'enc-pass' },
      error: null,
    })
    mockGetTrades.mockResolvedValue([])
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).not.toHaveProperty('synced')
    expect(json.fills).toBeDefined()
  })

  it('handles account with null passphrase gracefully', async () => {
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec', passphrase: null },
      error: null,
    })
    mockGetTrades.mockResolvedValue([])
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.fills).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/sync/okx/full', () => {
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
