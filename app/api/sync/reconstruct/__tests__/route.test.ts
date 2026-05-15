import { NextRequest } from 'next/server'

// PositionReconstructor mock — set up before imports
const mockReconstruct = jest.fn()
jest.mock('@/worker/position-reconstructor', () => ({
  PositionReconstructor: jest.fn().mockImplementation(() => ({
    reconstruct: mockReconstruct,
  })),
}))

// Supabase mock
jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: jest.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase/server'
const mockFrom = supabaseAdmin.from as jest.Mock

import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sync/reconstruct', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Build a chainable Supabase query mock ending in .single() */
function makeSingleChain(data: unknown, error: unknown = null) {
  const single = jest.fn().mockResolvedValue({ data, error })
  const eq = jest.fn().mockReturnValue({ single })
  const select = jest.fn().mockReturnValue({ eq })
  return { select }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/sync/reconstruct', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when account_id is missing from body', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/account_id/i)
  })

  it('returns 404 when account is not found in DB (data: null)', async () => {
    mockFrom.mockReturnValue(makeSingleChain(null, null))
    const res = await POST(makeRequest({ account_id: 'missing-id' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 404 when DB returns an error', async () => {
    mockFrom.mockReturnValue(makeSingleChain(null, { message: 'row not found' }))
    const res = await POST(makeRequest({ account_id: 'bad-id' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 200 { ok: true } when reconstruction succeeds', async () => {
    mockFrom.mockReturnValue(
      makeSingleChain({ id: 'acc-1', exchange: 'binance' })
    )
    mockReconstruct.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ account_id: 'acc-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('calls reconstructor.reconstruct with account.id and account.exchange from DB — not from request body', async () => {
    mockFrom.mockReturnValue(
      makeSingleChain({ id: 'db-acc-id', exchange: 'bybit' })
    )
    mockReconstruct.mockResolvedValue(undefined)

    // Pass a different account_id in the body — the route should use what the DB returns
    await POST(makeRequest({ account_id: 'request-body-id', exchange: 'binance' }))

    expect(mockReconstruct).toHaveBeenCalledTimes(1)
    expect(mockReconstruct).toHaveBeenCalledWith('db-acc-id', 'bybit')
  })

  it('returns 500 with error message when reconstructor.reconstruct throws an Error', async () => {
    mockFrom.mockReturnValue(
      makeSingleChain({ id: 'acc-1', exchange: 'okx' })
    )
    mockReconstruct.mockRejectedValue(new Error('Reconstruction failed'))

    const res = await POST(makeRequest({ account_id: 'acc-1' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Reconstruction failed')
  })

  it('returns 500 with stringified error when reconstructor.reconstruct throws a non-Error', async () => {
    mockFrom.mockReturnValue(
      makeSingleChain({ id: 'acc-1', exchange: 'mexc' })
    )
    mockReconstruct.mockRejectedValue('something went wrong')

    const res = await POST(makeRequest({ account_id: 'acc-1' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('something went wrong')
  })
})
