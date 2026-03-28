import { GET } from '../route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: jest.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase/server'
const mockFrom = supabaseAdmin.from as jest.Mock

function makeChain(data: unknown, error: unknown = null) {
  const result = { data, error }
  const chain: Record<string, jest.Mock> = {}
  const methods = ['select', 'in', 'is', 'order', 'gte', 'lte', 'not', 'range']
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain)
  }
  chain['then'] = jest.fn((resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
    return Promise.resolve(result).then(resolve, reject)
  })
  return chain
}

describe('GET /api/dashboard', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 200 with funds, metrics, chartData', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'accounts') return makeChain([{ id: 'acc1', fund: 'Leonardo', exchange: 'binance', account_name: 'A' }])
      if (table === 'balances') return makeChain([{ account_id: 'acc1', usdt_balance: 100000, recorded_at: '2026-01-01T00:00:00Z' }])
      if (table === 'trades') return makeChain([
        { account_id: 'acc1', pnl: 500, fee: 10, closed_at: '2026-01-02T00:00:00Z' },
        { account_id: 'acc1', pnl: -200, fee: 5, closed_at: '2026-01-03T00:00:00Z' },
      ])
      return makeChain([])
    })
    const res = await GET(new NextRequest('http://localhost/api/dashboard?since=0'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('funds')
    expect(body).toHaveProperty('metrics')
    expect(body).toHaveProperty('chartData')
    expect(body.funds[0].fund).toBe('Leonardo')
    expect(body.funds[0].aum).toBe(100000)
    expect(body.funds[0].totalPnl).toBe(300)
    // Metrics: 1 win ($500), 1 loss (-$200)
    expect(body.metrics.totalPnl).toBe(300)
    expect(body.metrics.totalFees).toBe(15)
    expect(body.metrics.totalTrades).toBe(2)
    expect(body.metrics.winRate).toBe(50)
    expect(body.metrics.avgWin).toBe(500)
    expect(body.metrics.avgLoss).toBe(200)
  })

  it('aggregates pnl per day in chartData', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'accounts') return makeChain([{ id: 'acc1', fund: 'F', exchange: 'binance', account_name: 'A' }])
      if (table === 'balances') return makeChain([{ account_id: 'acc1', usdt_balance: 50000, recorded_at: '2026-01-01T00:00:00Z' }])
      if (table === 'trades') return makeChain([
        { account_id: 'acc1', pnl: 100, fee: 1, closed_at: '2026-01-01T10:00:00Z' },
        { account_id: 'acc1', pnl: 200, fee: 2, closed_at: '2026-01-01T15:00:00Z' },
        { account_id: 'acc1', pnl: -50, fee: 1, closed_at: '2026-01-02T09:00:00Z' },
      ])
      return makeChain([])
    })
    const res = await GET(new NextRequest('http://localhost/api/dashboard?since=0'))
    const body = await res.json()
    expect(body.chartData[0].pnl).toBe(300)
    expect(body.chartData[1].pnl).toBe(-50)
    expect(body.chartData[1].cumulativePnl).toBe(250)
  })

  it('returns empty response when no accounts', async () => {
    mockFrom.mockImplementation(() => makeChain([]))
    const res = await GET(new NextRequest('http://localhost/api/dashboard?since=0'))
    const body = await res.json()
    expect(body.funds).toHaveLength(0)
    expect(body.metrics.totalPnl).toBe(0)
    expect(body.chartData).toHaveLength(0)
  })

  it('returns 500 if accounts query fails', async () => {
    mockFrom.mockImplementation(() => makeChain(null, { message: 'DB error' }))
    const res = await GET(new NextRequest('http://localhost/api/dashboard?since=0'))
    expect(res.status).toBe(500)
  })
})
