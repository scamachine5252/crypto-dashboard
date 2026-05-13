const mockFrom = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mockFrom } }))
jest.mock('@/lib/crypto/decrypt',  () => ({ decrypt: (v: string) => `dec:${v}` }))
jest.mock('server-only', () => ({}))

const mockGetTradesForChunk = jest.fn()
jest.mock('@/lib/adapters/bybit', () => ({
  BybitAdapter: jest.fn().mockImplementation(() => ({
    getTradesForChunk: mockGetTradesForChunk,
  })),
}))

import { POST } from '../route'
import { NextRequest } from 'next/server'

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/sync/bybit/full', {
    method:  'POST',
    body:    JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/sync/bybit/full', () => {
  beforeEach(() => jest.clearAllMocks())

  it('writes raw_fills but NOT trades; returns final_state for next chunk', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: { id: 'acc-1', api_key: 'k', api_secret: 's' },
      error: null,
    })
    const accessedTables: string[] = []
    mockFrom.mockImplementation((table: string) => {
      accessedTables.push(table)
      if (table === 'accounts') return { select: jest.fn(() => ({ eq: jest.fn(() => ({ single: singleMock })) })) }
      return { upsert: jest.fn().mockResolvedValue({ error: null }) }
    })

    mockGetTradesForChunk.mockResolvedValue({
      trades: [],
      finalState: { BTCUSDT: { size: 0, avgEntry: 0, openTime: null, openSide: 'long', accumulatedFee: 0 } },
      rawExecutions: [{
        category: 'linear',
        executions: [{ orderId: 'ord1', execTime: '1735689600000', execQty: '0.1', symbol: 'BTCUSDT', side: 'Buy', execPrice: '50000', execPnl: '0', execFee: '0.5', closedSize: '0' }],
      }],
    })

    const res = await POST(makeReq({ account_id: 'acc-1', chunk_index: 0 }))

    expect(res.status).toBe(200)
    expect(accessedTables).toContain('raw_fills')
    expect(accessedTables).not.toContain('trades')
    const json = await res.json() as { final_state: unknown; fills: number }
    expect(json.final_state).toBeDefined()
    expect(typeof json.fills).toBe('number')
  })

  it('returns 400 when chunk_index is missing', async () => {
    const res = await POST(makeReq({ account_id: 'acc-1' }))
    expect(res.status).toBe(400)
  })
})
