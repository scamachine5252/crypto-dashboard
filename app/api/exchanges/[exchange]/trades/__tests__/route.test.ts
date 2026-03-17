// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: jest.fn() },
}))

jest.mock('@/lib/crypto/decrypt', () => ({
  decrypt: jest.fn((v: string) => `plain:${v}`),
}))

const mockGetTrades = jest.fn()

jest.mock('@/lib/adapters/bybit',   () => ({ BybitAdapter:   jest.fn(() => ({ getTrades: mockGetTrades })) }))
jest.mock('@/lib/adapters/binance', () => ({ BinanceAdapter: jest.fn(() => ({ getTrades: mockGetTrades })) }))
jest.mock('@/lib/adapters/okx',     () => ({ OkxAdapter:     jest.fn(() => ({ getTrades: mockGetTrades })) }))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import { NextRequest } from 'next/server'

function makePost(exchange: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/exchanges/${exchange}/trades`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function mockDB(data: Record<string, unknown> | null) {
  const { supabaseAdmin } = require('@/lib/supabase/server')
  ;(supabaseAdmin.from as jest.Mock).mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data, error: data ? null : { message: 'not found' } }),
      }),
    }),
  })
}

const validAccount = {
  id: 'uuid-1', account_name: 'Alpha Fund', exchange: 'bybit',
  api_key: 'enc:key', api_secret: 'enc:secret', passphrase: null,
}

const fakeTrade = {
  id: 'trade-1', symbol: 'BTC/USDT', side: 'long', pnl: 120,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/exchanges/[exchange]/trades', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetTrades.mockReset()
  })

  it('returns 400 if exchange is invalid', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePost('kraken', { account_id: 'uuid-1' }), { params: Promise.resolve({ exchange: 'kraken' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/exchange/i)
  })

  it('returns 404 if account not found', async () => {
    mockDB(null)
    const { POST } = await import('../route')
    const res = await POST(makePost('bybit', { account_id: 'bad' }), { params: Promise.resolve({ exchange: 'bybit' }) })
    expect(res.status).toBe(404)
  })

  it('returns 200 with trades array on success', async () => {
    mockDB(validAccount)
    mockGetTrades.mockResolvedValue([fakeTrade])
    const { POST } = await import('../route')
    const res = await POST(makePost('bybit', { account_id: 'uuid-1' }), { params: Promise.resolve({ exchange: 'bybit' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.trades)).toBe(true)
    expect(json.trades).toHaveLength(1)
    expect(json.trades[0].id).toBe('trade-1')
    expect(json.account_name).toBe('Alpha Fund')
    expect(json.exchange).toBe('bybit')
  })

  it('returns empty array if no trades found', async () => {
    mockDB(validAccount)
    mockGetTrades.mockResolvedValue([])
    const { POST } = await import('../route')
    const res = await POST(makePost('bybit', { account_id: 'uuid-1' }), { params: Promise.resolve({ exchange: 'bybit' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).trades).toEqual([])
  })

  it('decrypts keys before passing to adapter', async () => {
    mockDB(validAccount)
    mockGetTrades.mockResolvedValue([])
    const { POST } = await import('../route')
    const { decrypt } = await import('@/lib/crypto/decrypt')
    const { BybitAdapter } = await import('@/lib/adapters/bybit')
    await POST(makePost('bybit', { account_id: 'uuid-1' }), { params: Promise.resolve({ exchange: 'bybit' }) })
    expect(decrypt).toHaveBeenCalledWith('enc:key')
    expect(decrypt).toHaveBeenCalledWith('enc:secret')
    const ctor = (BybitAdapter as jest.Mock).mock.calls[0][0]
    expect(ctor.apiKey).toBe('plain:enc:key')
    expect(ctor.apiSecret).toBe('plain:enc:secret')
  })

  it('never returns decrypted keys in response', async () => {
    mockDB(validAccount)
    mockGetTrades.mockResolvedValue([])
    const { POST } = await import('../route')
    const res = await POST(makePost('bybit', { account_id: 'uuid-1' }), { params: Promise.resolve({ exchange: 'bybit' }) })
    const json = await res.json()
    expect(json.api_key).toBeUndefined()
    expect(json.api_secret).toBeUndefined()
    expect(JSON.stringify(json)).not.toContain('plain:')
  })
})
