// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockFrom  = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mockFrom } }))
jest.mock('@/lib/crypto/decrypt',  () => ({ decrypt: (v: string) => `dec:${v}` }))
jest.mock('server-only', () => ({}))

const mockGetFullTrades = jest.fn()
jest.mock('@/lib/adapters/binance', () => ({
  BinanceAdapter: jest.fn().mockImplementation(() => ({
    getFullTrades: mockGetFullTrades,
  })),
}))

import { POST } from '../route'
import { NextRequest } from 'next/server'

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/sync/binance/full', {
    method:  'POST',
    body:    JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/sync/binance/full', () => {
  beforeEach(() => jest.clearAllMocks())

  it('writes raw_fills but NOT trades (single write path contract)', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: { id: 'acc-1', api_key: 'k', api_secret: 's', instrument: 'unified' },
      error: null,
    })
    const accessedTables: string[] = []
    mockFrom.mockImplementation((table: string) => {
      accessedTables.push(table)
      if (table === 'accounts') {
        return { select: jest.fn(() => ({ eq: jest.fn(() => ({ single: singleMock })) })) }
      }
      return { upsert: jest.fn().mockResolvedValue({ error: null }) }
    })

    mockGetFullTrades.mockResolvedValue({
      trades: [{ symbol: 'BTCUSDT', openedAt: '2025-01-01T00:00:00Z', closedAt: '2025-01-05T00:00:00Z', side: 'long', entryPrice: 50000, exitPrice: 51000, quantity: 0.01, pnl: 10, fee: 0.5, tradeType: 'futures' }],
      failedSymbols: [],
      rawFills: [{ id: 1, symbol: 'BTCUSDT', side: 'BUY', price: '50000', qty: '0.01', realizedPnl: '0', commission: '0.5', commissionAsset: 'USDT', time: 1735725600000, positionSide: 'BOTH', orderId: 1 }],
    })

    const res = await POST(makeReq({ account_id: 'acc-1', symbol: 'BTCUSDT', weeks: [0, 1] }))

    expect(res.status).toBe(200)
    expect(accessedTables).toContain('raw_fills')
    expect(accessedTables).not.toContain('trades')
  })

  it('returns failedSymbols in response', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: { id: 'acc-1', api_key: 'k', api_secret: 's', instrument: 'unified' },
      error: null,
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'accounts') return { select: jest.fn(() => ({ eq: jest.fn(() => ({ single: singleMock })) })) }
      return { upsert: jest.fn().mockResolvedValue({ error: null }) }
    })
    mockGetFullTrades.mockResolvedValue({
      trades: [], failedSymbols: [{ symbol: 'BTCUSDT', error: 'rate limit' }], rawFills: [],
    })

    const res = await POST(makeReq({ account_id: 'acc-1', symbol: 'BTCUSDT', weeks: [0] }))
    const json = await res.json() as { failedSymbols: Array<{ symbol: string; error: string }> }
    expect(json.failedSymbols).toHaveLength(1)
    expect(json.failedSymbols[0].error).toBe('rate limit')
  })

  it('returns 400 when symbol is missing', async () => {
    const res = await POST(makeReq({ account_id: 'acc-1', weeks: [0] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when weeks is empty', async () => {
    const res = await POST(makeReq({ account_id: 'acc-1', symbol: 'BTCUSDT', weeks: [] }))
    expect(res.status).toBe(400)
  })
})
