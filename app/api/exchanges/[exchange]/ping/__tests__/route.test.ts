// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockSelect  = jest.fn()
const mockEq      = jest.fn()
const mockSingle  = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({ select: mockSelect })),
  },
}))

jest.mock('@/lib/crypto/decrypt', () => ({
  decrypt: jest.fn((ciphertext: string) => `plain:${ciphertext}`),
}))

const mockBybitTestConnection    = jest.fn()
const mockBinanceTestConnection  = jest.fn()
const mockOkxTestConnection      = jest.fn()

jest.mock('@/lib/adapters/bybit', () => ({
  BybitAdapter: jest.fn().mockImplementation(() => ({
    testConnection: mockBybitTestConnection,
  })),
}))

jest.mock('@/lib/adapters/binance', () => ({
  BinanceAdapter: jest.fn().mockImplementation(() => ({
    testConnection: mockBinanceTestConnection,
  })),
}))

jest.mock('@/lib/adapters/okx', () => ({
  OkxAdapter: jest.fn().mockImplementation(() => ({
    testConnection: mockOkxTestConnection,
  })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import { NextRequest } from 'next/server'

function makePost(exchange: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/exchanges/${exchange}/ping`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function mockAccountFound(account: Record<string, unknown>) {
  mockSelect.mockReturnValue({
    eq: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: account, error: null }),
    }),
  })
}

function mockAccountNotFound() {
  mockSelect.mockReturnValue({
    eq: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  })
}

const validAccount = {
  id:           'uuid-1',
  account_name: 'Alpha Fund',
  exchange:     'bybit',
  api_key:      'enc:myapikey',
  api_secret:   'enc:myapisecret',
  passphrase:   null,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/exchanges/[exchange]/ping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBybitTestConnection.mockReset()
    mockBinanceTestConnection.mockReset()
    mockOkxTestConnection.mockReset()
  })

  it('returns 400 if exchange is invalid', async () => {
    const { POST } = await import('../route')
    const req = makePost('kraken', { account_id: 'uuid-1' })
    const res = await POST(req, { params: Promise.resolve({ exchange: 'kraken' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/exchange/i)
  })

  it('returns 404 if account not found in DB', async () => {
    mockAccountNotFound()

    const { POST } = await import('../route')
    const req = makePost('bybit', { account_id: 'nonexistent' })
    const res = await POST(req, { params: Promise.resolve({ exchange: 'bybit' }) })

    expect(res.status).toBe(404)
  })

  it('returns 200 with connected:true on successful ping', async () => {
    mockAccountFound(validAccount)
    mockBybitTestConnection.mockResolvedValue(true)

    const { POST } = await import('../route')
    const req = makePost('bybit', { account_id: 'uuid-1' })
    const res = await POST(req, { params: Promise.resolve({ exchange: 'bybit' }) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.connected).toBe(true)
    expect(json.exchange).toBe('bybit')
    expect(json.account_name).toBe('Alpha Fund')
  })

  it('returns 200 with connected:false on auth error', async () => {
    mockAccountFound(validAccount)
    mockBybitTestConnection.mockResolvedValue(false)

    const { POST } = await import('../route')
    const req = makePost('bybit', { account_id: 'uuid-1' })
    const res = await POST(req, { params: Promise.resolve({ exchange: 'bybit' }) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.connected).toBe(false)
  })

  it('decrypts api_key and api_secret before passing to adapter', async () => {
    mockAccountFound(validAccount)
    mockBybitTestConnection.mockResolvedValue(true)

    const { POST } = await import('../route')
    const { decrypt } = await import('@/lib/crypto/decrypt')
    const { BybitAdapter } = await import('@/lib/adapters/bybit')

    const req = makePost('bybit', { account_id: 'uuid-1' })
    await POST(req, { params: Promise.resolve({ exchange: 'bybit' }) })

    expect(decrypt).toHaveBeenCalledWith('enc:myapikey')
    expect(decrypt).toHaveBeenCalledWith('enc:myapisecret')

    const constructorCall = (BybitAdapter as jest.Mock).mock.calls[0][0]
    expect(constructorCall.apiKey).toBe('plain:enc:myapikey')
    expect(constructorCall.apiSecret).toBe('plain:enc:myapisecret')
  })

  it('never returns decrypted keys in response', async () => {
    mockAccountFound(validAccount)
    mockBybitTestConnection.mockResolvedValue(true)

    const { POST } = await import('../route')
    const req = makePost('bybit', { account_id: 'uuid-1' })
    const res = await POST(req, { params: Promise.resolve({ exchange: 'bybit' }) })
    const json = await res.json()

    expect(json.api_key).toBeUndefined()
    expect(json.api_secret).toBeUndefined()
    expect(json.passphrase).toBeUndefined()
    // Also must not contain decrypted plaintext
    const body = JSON.stringify(json)
    expect(body).not.toContain('plain:')
  })
})
