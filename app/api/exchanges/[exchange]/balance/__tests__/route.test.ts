// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: jest.fn() },
}))

jest.mock('@/lib/crypto/decrypt', () => ({
  decrypt: jest.fn((v: string) => `plain:${v}`),
}))

const mockFetchBalance = jest.fn()

jest.mock('@/lib/adapters/bybit',   () => ({ BybitAdapter:   jest.fn(() => ({ fetchBalance: mockFetchBalance })) }))
jest.mock('@/lib/adapters/binance', () => ({ BinanceAdapter: jest.fn(() => ({ fetchBalance: mockFetchBalance })) }))
jest.mock('@/lib/adapters/okx',     () => ({ OkxAdapter:     jest.fn(() => ({ fetchBalance: mockFetchBalance })) }))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import { NextRequest } from 'next/server'

function makePost(exchange: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/exchanges/${exchange}/balance`, {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/exchanges/[exchange]/balance', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchBalance.mockReset()
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

  it('returns 200 with { usdt, tokens } on success', async () => {
    mockDB(validAccount)
    mockFetchBalance.mockResolvedValue({ usdt: 5000, tokens: { BTC: 0.25 } })
    const { POST } = await import('../route')
    const res = await POST(makePost('bybit', { account_id: 'uuid-1' }), { params: Promise.resolve({ exchange: 'bybit' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.usdt).toBe(5000)
    expect(json.tokens).toEqual({ BTC: 0.25 })
    expect(json.account_name).toBe('Alpha Fund')
    expect(json.exchange).toBe('bybit')
  })

  it('decrypts keys before passing to adapter', async () => {
    mockDB(validAccount)
    mockFetchBalance.mockResolvedValue({ usdt: 0, tokens: {} })
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
    mockFetchBalance.mockResolvedValue({ usdt: 0, tokens: {} })
    const { POST } = await import('../route')
    const res = await POST(makePost('bybit', { account_id: 'uuid-1' }), { params: Promise.resolve({ exchange: 'bybit' }) })
    const json = await res.json()
    expect(json.api_key).toBeUndefined()
    expect(json.api_secret).toBeUndefined()
    expect(JSON.stringify(json)).not.toContain('plain:')
  })

  it('returns 500 with error message if adapter throws', async () => {
    mockDB(validAccount)
    mockFetchBalance.mockRejectedValue(new Error('ExchangeError: rate limit'))
    const { POST } = await import('../route')
    const res = await POST(makePost('bybit', { account_id: 'uuid-1' }), { params: Promise.resolve({ exchange: 'bybit' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBeDefined()
  })
})
