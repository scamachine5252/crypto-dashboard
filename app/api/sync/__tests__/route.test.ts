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
const mockGetTrades = jest.fn()

jest.mock('@/lib/adapters/bybit',   () => ({ BybitAdapter:   jest.fn(() => ({ fetchBalance: mockFetchBalance, getTrades: mockGetTrades })) }))
jest.mock('@/lib/adapters/binance', () => ({ BinanceAdapter: jest.fn(() => ({ fetchBalance: mockFetchBalance, getTrades: mockGetTrades })) }))
jest.mock('@/lib/adapters/okx',     () => ({ OkxAdapter:     jest.fn(() => ({ fetchBalance: mockFetchBalance, getTrades: mockGetTrades })) }))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
import { NextRequest } from 'next/server'

function makePost(): NextRequest {
  return new NextRequest('http://localhost/api/sync', { method: 'POST' })
}

const account1 = {
  id: 'uuid-1',
  account_name: 'Alpha Fund',
  exchange: 'bybit',
  api_key: 'enc:key1',
  api_secret: 'enc:secret1',
  passphrase: null,
}

const account2 = {
  id: 'uuid-2',
  account_name: 'Beta Fund',
  exchange: 'binance',
  api_key: 'enc:key2',
  api_secret: 'enc:secret2',
  passphrase: null,
}

const sampleTrade = {
  id: 'trade-1',
  symbol: 'BTC/USDT',
  side: 'long',
  entryPrice: 50000,
  exitPrice: 51000,
  quantity: 0.1,
  pnl: 100,
  fee: 5,
  openedAt: '2025-01-01T10:00:00.000Z',
  closedAt: '2025-01-01T11:00:00.000Z',
  tradeType: 'spot',
  leverage: 1,
  fundingCost: 0,
  isOvernight: false,
  exchange: 'bybit',
  subAccountId: 'uuid-1',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/sync', () => {
  let mockAccountsSelect: jest.Mock
  let mockBalancesInsert: jest.Mock
  let mockTradesUpsert: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchBalance.mockReset()
    mockGetTrades.mockReset()

    mockAccountsSelect = jest.fn().mockResolvedValue({ data: [account1, account2], error: null })
    mockBalancesInsert = jest.fn().mockResolvedValue({ error: null })
    mockTradesUpsert   = jest.fn().mockResolvedValue({ error: null })

    const { supabaseAdmin } = require('@/lib/supabase/server')
    ;(supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'accounts') return { select: mockAccountsSelect }
      if (table === 'balances') return { insert: mockBalancesInsert }
      if (table === 'trades')   return { upsert: mockTradesUpsert }
      return {}
    })

    mockFetchBalance.mockResolvedValue({ usdt: 1000, tokens: { BTC: 0.1 } })
    mockGetTrades.mockResolvedValue([sampleTrade])
  })

  it('returns 200 with sync summary on success', async () => {
    const { POST } = await import('../route')
    const res = await POST(makePost())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.synced).toBe(2)
    expect(json.errors).toBe(0)
    expect(Array.isArray(json.accounts)).toBe(true)
  })

  it('fetches all accounts from Supabase', async () => {
    const { POST } = await import('../route')
    await POST(makePost())
    expect(mockAccountsSelect).toHaveBeenCalled()
  })

  it('calls fetchBalance once per account (Binance uses single futures adapter)', async () => {
    const { POST } = await import('../route')
    await POST(makePost())
    // 1 call for Bybit + 1 call for Binance (single futures adapter) = 2
    expect(mockFetchBalance).toHaveBeenCalledTimes(2)
  })

  it('calls getTrades once per account (Binance futures-only adapter)', async () => {
    const { POST } = await import('../route')
    await POST(makePost())
    // 1 call for Bybit + 1 call for Binance (single futures adapter) = 2
    expect(mockGetTrades).toHaveBeenCalledTimes(2)
  })

  it('saves balances to Supabase balances table using usdt_balance column', async () => {
    const { POST } = await import('../route')
    await POST(makePost())
    // 2 accounts × (1 USDT row + 1 BTC token row) = 4 inserts
    expect(mockBalancesInsert).toHaveBeenCalledTimes(4)
    const usdtRow = mockBalancesInsert.mock.calls[0][0]
    expect(usdtRow.account_id).toBe('uuid-1')
    expect(usdtRow.usdt_balance).toBe(1000)
    expect(usdtRow.usdt).toBeUndefined()
    expect(usdtRow.tokens).toBeUndefined()
    expect(usdtRow.recorded_at).toBeDefined()
  })

  it('inserts separate row per token with token_symbol and token_balance', async () => {
    const { POST } = await import('../route')
    await POST(makePost())
    const tokenRow = mockBalancesInsert.mock.calls[1][0]
    expect(tokenRow.account_id).toBe('uuid-1')
    expect(tokenRow.usdt_balance).toBe(0)
    expect(tokenRow.token_symbol).toBe('BTC')
    expect(tokenRow.token_balance).toBe(0.1)
    expect(tokenRow.recorded_at).toBeDefined()
  })

  it('saves trades to Supabase trades table', async () => {
    const { POST } = await import('../route')
    await POST(makePost())
    expect(mockTradesUpsert).toHaveBeenCalledTimes(2)
    const firstCall = mockTradesUpsert.mock.calls[0][0]
    expect(Array.isArray(firstCall)).toBe(true)
    expect(firstCall[0].account_id).toBe('uuid-1')
    expect(firstCall[0].symbol).toBe('BTC/USDT')
  })

  it('maps trade side long→buy and short→sell', async () => {
    mockGetTrades.mockResolvedValue([
      { ...sampleTrade, side: 'long' },
      { ...sampleTrade, side: 'short', openedAt: '2025-01-02T10:00:00.000Z' },
    ])
    const { POST } = await import('../route')
    await POST(makePost())
    const rows = mockTradesUpsert.mock.calls[0][0]
    expect(rows[0].side).toBe('buy')
    expect(rows[1].side).toBe('sell')
  })

  it('stores original direction (long/short) in direction column', async () => {
    mockGetTrades.mockResolvedValue([
      { ...sampleTrade, side: 'long' },
      { ...sampleTrade, side: 'short', openedAt: '2025-01-02T10:00:00.000Z' },
    ])
    const { POST } = await import('../route')
    await POST(makePost())
    const rows = mockTradesUpsert.mock.calls[0][0]
    expect(rows[0].direction).toBe('long')
    expect(rows[1].direction).toBe('short')
  })

  it('does not include leverage, funding_cost, or is_overnight in trades insert', async () => {
    const { POST } = await import('../route')
    await POST(makePost())
    const row = mockTradesUpsert.mock.calls[0][0][0]
    expect(row.leverage).toBeUndefined()
    expect(row.funding_cost).toBeUndefined()
    expect(row.is_overnight).toBeUndefined()
  })

  it('skips account if adapter throws and continues with others', async () => {
    mockFetchBalance
      .mockRejectedValueOnce(new Error('Exchange error'))
      .mockResolvedValueOnce({ usdt: 2000, tokens: {} })
    const { POST } = await import('../route')
    const res = await POST(makePost())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.synced).toBe(1)
    expect(json.errors).toBe(1)
  })

  it('returns count of synced accounts and errors', async () => {
    mockFetchBalance
      .mockRejectedValueOnce(new Error('Exchange error'))
      .mockResolvedValueOnce({ usdt: 2000, tokens: {} })
    mockGetTrades.mockResolvedValue([])
    const { POST } = await import('../route')
    const res = await POST(makePost())
    const json = await res.json()
    expect(json.synced).toBe(1)
    expect(json.errors).toBe(1)
    expect(json.accounts).toHaveLength(1)
    expect(json.accounts[0]).toBe('Beta Fund')
  })
})
