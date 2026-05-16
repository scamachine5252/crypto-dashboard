import { GET } from '../route'
import { NextRequest } from 'next/server'

const mockRpc  = jest.fn()
const mockFrom = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc:  (...args: unknown[]) => mockRpc(...args),
  },
}))

function makeChain(data: unknown, error: unknown = null) {
  const result = { data, error }
  const chain: Record<string, jest.Mock> = {}
  const methods = ['select', 'in', 'is', 'order', 'gte', 'lte', 'not', 'neq', 'range']
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
      if (table === 'balances') return makeChain([{ account_id: 'acc1', usdt_balance: 100000, total_equity_usdt: null, recorded_at: '2026-01-01T00:00:00Z' }])
      return makeChain([])
    })
    // trade_stats_by_account_day RPC — 1 win ($500) on jan 2, 1 loss ($200) on jan 3
    mockRpc.mockResolvedValue({
      data: [
        { account_id: 'acc1', day: '2026-01-02', daily_pnl: 500, daily_fee: 10, daily_volume: 0, win_count: 1, loss_count: 0, gross_profit: 500, gross_loss: 0 },
        { account_id: 'acc1', day: '2026-01-03', daily_pnl: -200, daily_fee: 5, daily_volume: 0, win_count: 0, loss_count: 1, gross_profit: 0, gross_loss: 200 },
      ],
      error: null,
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
    // Metrics: 1 win ($500), 1 loss ($200)
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
      if (table === 'balances') return makeChain([{ account_id: 'acc1', usdt_balance: 50000, total_equity_usdt: null, recorded_at: '2026-01-01T00:00:00Z' }])
      return makeChain([])
    })
    // Two wins on jan 1 aggregated into one row, one loss on jan 2
    mockRpc.mockResolvedValue({
      data: [
        { account_id: 'acc1', day: '2026-01-01', daily_pnl: 300, daily_fee: 3, daily_volume: 0, win_count: 2, loss_count: 0, gross_profit: 300, gross_loss: 0 },
        { account_id: 'acc1', day: '2026-01-02', daily_pnl: -50, daily_fee: 1, daily_volume: 0, win_count: 0, loss_count: 1, gross_profit: 0, gross_loss: 50 },
      ],
      error: null,
    })

    const res = await GET(new NextRequest('http://localhost/api/dashboard?since=0'))
    const body = await res.json()
    expect(body.chartData[0].pnl).toBe(300)
    expect(body.chartData[1].pnl).toBe(-50)
    expect(body.chartData[1].cumulativePnl).toBe(250)
  })

  it('returns empty response when no accounts', async () => {
    mockFrom.mockImplementation(() => makeChain([]))
    mockRpc.mockResolvedValue({ data: [], error: null })
    const res = await GET(new NextRequest('http://localhost/api/dashboard?since=0'))
    const body = await res.json()
    expect(body.funds).toHaveLength(0)
    expect(body.metrics.totalPnl).toBe(0)
    expect(body.chartData).toHaveLength(0)
  })

  it('returns 500 if accounts query fails', async () => {
    mockFrom.mockImplementation(() => makeChain(null, { message: 'DB error' }))
    mockRpc.mockResolvedValue({ data: [], error: null })
    const res = await GET(new NextRequest('http://localhost/api/dashboard?since=0'))
    expect(res.status).toBe(500)
  })

  it('returns 500 if trade_stats_by_account_day RPC fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'accounts') return makeChain([{ id: 'acc1', fund: 'F', exchange: 'binance', account_name: 'A' }])
      return makeChain([])
    })
    mockRpc.mockResolvedValue({ data: null, error: { message: 'rpc error' } })
    const res = await GET(new NextRequest('http://localhost/api/dashboard?since=0'))
    expect(res.status).toBe(500)
  })
})
