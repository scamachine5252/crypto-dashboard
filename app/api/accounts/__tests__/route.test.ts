// Mock supabase server client
const mockInsert = jest.fn()
const mockSelect = jest.fn()
const mockDelete = jest.fn()
const mockEq = jest.fn()
const mockSingle = jest.fn()
const mockMaybeSingle = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      insert: mockInsert,
      select: mockSelect,
      delete: mockDelete,
    })),
  },
}))

// Mock encrypt — deterministic output for assertions
jest.mock('@/lib/crypto/encrypt', () => ({
  encrypt: jest.fn((text: string) => `enc:${text}`),
}))

// Mock decrypt — needed because accounts route now decrypts keys for Binance detection
jest.mock('@/lib/crypto/decrypt', () => ({
  decrypt: jest.fn((text: string) => text.replace(/^enc:/, '')),
}))

// Mock auto-detect — prevents real ccxt calls in unit tests
jest.mock('@/lib/adapters/binance-detect', () => ({
  detectBinanceInstrument: jest.fn().mockResolvedValue('unified'),
}))

import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers to build mock Request objects
// ---------------------------------------------------------------------------
function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeGet(): NextRequest {
  return new NextRequest('http://localhost/api/accounts', { method: 'GET' })
}

// ---------------------------------------------------------------------------
// POST /api/accounts
// ---------------------------------------------------------------------------
describe('POST /api/accounts', () => {
  const validBody = {
    fund: 'Cicada Foundation',
    exchange: 'binance',
    account_name: 'Alpha Fund',
    instrument: 'spot',
    api_key: 'myapikey',
    api_secret: 'myapisecret',
  }

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 400 if required fields are missing', async () => {
    const { POST } = await import('../route')
    const req = makePost({ fund: 'Cicada Foundation' }) // missing many fields
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBeDefined()
  })

  it('returns 400 if exchange is not binance/bybit/okx', async () => {
    const { POST } = await import('../route')
    const req = makePost({ ...validBody, exchange: 'kraken' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/exchange/i)
  })

  it('encrypts api_key and api_secret before saving to Supabase', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 'uuid-1', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot' },
          error: null,
        }),
      }),
    })

    const { POST } = await import('../route')
    const { encrypt } = await import('@/lib/crypto/encrypt')
    const req = makePost(validBody)
    await POST(req)

    expect(encrypt).toHaveBeenCalledWith('myapikey')
    expect(encrypt).toHaveBeenCalledWith('myapisecret')

    const insertCall = mockInsert.mock.calls[0][0]
    expect(insertCall.api_key).toBe('enc:myapikey')
    expect(insertCall.api_secret).toBe('enc:myapisecret')
  })

  it('never returns api_key or api_secret in response', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 'uuid-1', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot' },
          error: null,
        }),
      }),
    })

    const { POST } = await import('../route')
    const req = makePost(validBody)
    const res = await POST(req)
    const json = await res.json()

    expect(json.api_key).toBeUndefined()
    expect(json.api_secret).toBeUndefined()
    expect(json.passphrase).toBeUndefined()
  })

  it('returns 201 with account id on success', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 'uuid-1', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot' },
          error: null,
        }),
      }),
    })

    const { POST } = await import('../route')
    const req = makePost(validBody)
    const res = await POST(req)

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.id).toBe('uuid-1')
  })

  it('saves account_id_memo when provided', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 'uuid-2', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot', account_id_memo: 'memo-123' },
          error: null,
        }),
      }),
    })

    const { POST } = await import('../route')
    const req = makePost({ ...validBody, account_id_memo: 'memo-123' })
    await POST(req)

    const insertCall = mockInsert.mock.calls[0][0]
    expect(insertCall.account_id_memo).toBe('memo-123')
  })

  it('does not include account_id_memo in insert when not provided', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 'uuid-3', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot' },
          error: null,
        }),
      }),
    })

    const { POST } = await import('../route')
    const req = makePost(validBody) // no account_id_memo
    await POST(req)

    const insertCall = mockInsert.mock.calls[0][0]
    expect(insertCall.account_id_memo).toBeUndefined()
  })

  it('accepts unified as a valid instrument', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 'uuid-4', fund: 'Test Fund', exchange: 'bybit', account_name: 'Test Account', instrument: 'unified' },
          error: null,
        }),
      }),
    })

    const { POST } = await import('../route')
    const response = await POST(makePost({
      fund: 'Test Fund',
      exchange: 'bybit',
      account_name: 'Test Account',
      instrument: 'unified',
      api_key: 'key123',
      api_secret: 'secret123',
    }))
    expect(response.status).toBe(201)
  })

  it('uses unified as default when instrument is omitted', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 'uuid-5', fund: 'Test Fund', exchange: 'bybit', account_name: 'Test Account', instrument: 'unified' },
          error: null,
        }),
      }),
    })

    const { POST } = await import('../route')
    const response = await POST(makePost({
      fund: 'Test Fund',
      exchange: 'bybit',
      account_name: 'Test Account',
      api_key: 'key123',
      api_secret: 'secret123',
    }))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.instrument).toBe('unified')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ instrument: 'unified' })
    )
  })
})

// ---------------------------------------------------------------------------
// GET /api/accounts
// ---------------------------------------------------------------------------
describe('GET /api/accounts', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns list of accounts without api_key and api_secret fields', async () => {
    mockSelect.mockResolvedValue({
      data: [
        { id: 'uuid-1', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot', api_key: 'enc:secret', api_secret: 'enc:secret2' },
        { id: 'uuid-2', fund: 'Cicada Foundation', exchange: 'bybit', account_name: 'Beta Fund', instrument: 'futures', api_key: 'enc:key', api_secret: 'enc:sec' },
      ],
      error: null,
    })

    const { GET } = await import('../route')
    const req = makeGet()
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
    expect(json).toHaveLength(2)
    json.forEach((account: Record<string, unknown>) => {
      expect(account.api_key).toBeUndefined()
      expect(account.api_secret).toBeUndefined()
      expect(account.passphrase).toBeUndefined()
    })
  })

  it('returns account_id_memo in response', async () => {
    mockSelect.mockResolvedValue({
      data: [
        { id: 'uuid-1', fund: 'Cicada Foundation', exchange: 'binance', account_name: 'Alpha Fund', instrument: 'spot', account_id_memo: 'memo-abc', api_key: 'enc:key', api_secret: 'enc:sec' },
      ],
      error: null,
    })

    const { GET } = await import('../route')
    const req = makeGet()
    const res = await GET(req)
    const json = await res.json()

    expect(json[0].account_id_memo).toBe('memo-abc')
  })

  it('returns empty array when no accounts exist', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null })

    const { GET } = await import('../route')
    const req = makeGet()
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/accounts/[id]
// ---------------------------------------------------------------------------
describe('DELETE /api/accounts/[id]', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 404 if account not found', async () => {
    const mockFrom = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      })),
    }))

    const { supabaseAdmin } = await import('@/lib/supabase/server')
    ;(supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom)

    const { DELETE } = await import('../[id]/route')
    const req = new NextRequest('http://localhost/api/accounts/nonexistent', { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'nonexistent' }) })

    expect(res.status).toBe(404)
  })

  it('returns 200 on successful deletion', async () => {
    const mockFrom = jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
        })),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({ error: null }),
      })),
    }))

    const { supabaseAdmin } = await import('@/lib/supabase/server')
    ;(supabaseAdmin.from as jest.Mock).mockImplementation(mockFrom)

    const { DELETE } = await import('../[id]/route')
    const req = new NextRequest('http://localhost/api/accounts/uuid-1', { method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ id: 'uuid-1' }) })

    expect(res.status).toBe(200)
  })
})
