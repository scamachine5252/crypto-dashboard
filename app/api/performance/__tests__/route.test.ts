// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------
const mockFrom = jest.fn()

jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: mockFrom },
}))

import { NextRequest } from 'next/server'
import { GET } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(params: Record<string, string> = {}): NextRequest {
  const qs = new URLSearchParams(params).toString()
  return new NextRequest(`http://localhost/api/performance${qs ? '?' + qs : ''}`)
}

type AccRow = { id: string; account_name: string; exchange: string; fund: string; initial_aum?: number | null; instrument?: string }
type BalRow = { account_id: string; usdt_balance: number; total_equity_usdt: number | null; recorded_at: string }
type TradeRow = {
  id: string; account_id: string; exchange: string; symbol: string
  direction: string | null; trade_type: string; entry_price: string | null
  exit_price: string | null; quantity: string | null; pnl: string | null
  fee: string | null; opened_at: string | null; closed_at: string
}

function makeAcc(overrides: Partial<AccRow> = {}): AccRow {
  return { id: 'acc-1', account_name: 'Alpha', exchange: 'bybit', fund: 'Fund A', initial_aum: null, instrument: 'unified', ...overrides }
}

function makeBal(overrides: Partial<BalRow> = {}): BalRow {
  return { account_id: 'acc-1', usdt_balance: 10000, total_equity_usdt: 10500, recorded_at: '2025-01-01T00:00:00.000Z', ...overrides }
}

function makeTrade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 't1', account_id: 'acc-1', exchange: 'bybit', symbol: 'BTC/USDT',
    direction: 'long', trade_type: 'futures',
    entry_price: '50000', exit_price: '51000', quantity: '0.1',
    pnl: '100', fee: '-5',
    opened_at: '2025-06-01T10:00:00.000Z', closed_at: '2025-06-01T12:00:00.000Z',
    ...overrides,
  }
}

/**
 * Wire up the three from() call sequences the route makes:
 *   1. accounts → select(...)
 *   2. balances → select(...).in(...).is(...).lte(...).order(...)
 *   3. trades   → select(...).in(...).gte(...).lte(...).not(...).neq(...).order(...).order(...).range(...)
 */
function setupMocks({
  accounts = [makeAcc()],
  balances = [] as BalRow[],
  trades   = [] as TradeRow[],
  accError = null as unknown,
  tradesError = null as unknown,
}: {
  accounts?: AccRow[]
  balances?: BalRow[]
  trades?: TradeRow[]
  accError?: unknown
  tradesError?: unknown
} = {}) {
  const tradesRange = jest.fn().mockResolvedValue({ data: tradesError ? null : trades, error: tradesError })
  const tradesChain = {
    in:    jest.fn().mockReturnThis(),
    gte:   jest.fn().mockReturnThis(),
    lte:   jest.fn().mockReturnThis(),
    not:   jest.fn().mockReturnThis(),
    neq:   jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: tradesRange,
  }

  const balsChain = {
    in:    jest.fn().mockReturnThis(),
    is:    jest.fn().mockReturnThis(),
    lte:   jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: balances, error: null }),
  }

  mockFrom.mockImplementation((table: string) => {
    if (table === 'accounts') return { select: jest.fn().mockResolvedValue({ data: accounts, error: accError }) }
    if (table === 'balances') return { select: jest.fn().mockReturnValue(balsChain) }
    if (table === 'trades')   return { select: jest.fn().mockReturnValue(tradesChain) }
    return {}
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/performance', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── Basic shape ────────────────────────────────────────────────────────────

  it('returns 200 with empty accounts and trades when no accounts exist', async () => {
    setupMocks({ accounts: [] })
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ accounts: [], trades: [] })
  })

  it('returns 500 when accounts query fails', async () => {
    setupMocks({ accError: { message: 'DB down' } })
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
  })

  it('returns 200 with accounts enriched with exchange/fund fields', async () => {
    setupMocks({ accounts: [makeAcc({ id: 'acc-1', exchange: 'binance', fund: 'Fund B' })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.accounts[0]).toMatchObject({ id: 'acc-1', exchange: 'binance', fund: 'Fund B' })
  })

  // ── initialCapital priority ────────────────────────────────────────────────

  it('IC priority 1: uses last balance snapshot before period start (total_equity_usdt)', async () => {
    const since = new Date('2025-06-01T00:00:00.000Z').getTime()
    const bal = makeBal({ recorded_at: '2025-05-31T12:00:00.000Z', total_equity_usdt: 9800, usdt_balance: 9500 })
    setupMocks({ balances: [bal] })
    const res = await GET(makeReq({ since: String(since) }))
    const body = await res.json()
    // Non-PM account: uses total_equity_usdt = 9800
    expect(body.accounts[0].initialCapital).toBe(9800)
  })

  it('IC priority 1: PM account uses total_equity_usdt (same as non-PM)', async () => {
    const since = new Date('2025-06-01T00:00:00.000Z').getTime()
    const acc = makeAcc({ instrument: 'portfolio_margin' })
    const bal = makeBal({ recorded_at: '2025-05-31T12:00:00.000Z', total_equity_usdt: 9800, usdt_balance: 9500 })
    setupMocks({ accounts: [acc], balances: [bal] })
    const res = await GET(makeReq({ since: String(since) }))
    const body = await res.json()
    // PM accounts now use total_equity_usdt (includes BTC collateral) — same as non-PM
    expect(body.accounts[0].initialCapital).toBe(9800)
  })

  it('IC priority 2: uses first in-period balance when no before-period snapshot exists', async () => {
    const since = new Date('2025-06-01T00:00:00.000Z').getTime()
    // Balance recorded after period start
    const bal = makeBal({ recorded_at: '2025-06-03T00:00:00.000Z', total_equity_usdt: 10200, usdt_balance: 10000 })
    setupMocks({ balances: [bal] })
    const res = await GET(makeReq({ since: String(since) }))
    const body = await res.json()
    expect(body.accounts[0].initialCapital).toBe(10200)
  })

  it('IC priority 3: uses manual initial_aum when no balance snapshots at all', async () => {
    const acc = makeAcc({ initial_aum: 25000 })
    setupMocks({ accounts: [acc], balances: [] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.accounts[0].initialCapital).toBe(25000)
  })

  it('IC is null when no balances and initial_aum is 0', async () => {
    const acc = makeAcc({ initial_aum: 0 })
    setupMocks({ accounts: [acc], balances: [] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.accounts[0].initialCapital).toBeNull()
  })

  it('IC is null when no balances and initial_aum is null', async () => {
    setupMocks({ accounts: [makeAcc({ initial_aum: null })], balances: [] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.accounts[0].initialCapital).toBeNull()
  })

  // ── Trade field mapping ────────────────────────────────────────────────────

  it('maps trade fields correctly: pnl, entryPrice, exitPrice, quantity', async () => {
    setupMocks({ trades: [makeTrade({ entry_price: '50000', exit_price: '51000', quantity: '0.1', pnl: '100' })] })
    const res = await GET(makeReq())
    const body = await res.json()
    const t = body.trades[0]
    expect(t.entryPrice).toBe(50000)
    expect(t.exitPrice).toBe(51000)
    expect(t.quantity).toBe(0.1)
    expect(t.pnl).toBe(100)
  })

  it('pnlPercent = pnl / (entryPrice * quantity) * 100', async () => {
    // 100 / (50000 * 0.1) * 100 = 100 / 5000 * 100 = 2%
    setupMocks({ trades: [makeTrade({ entry_price: '50000', quantity: '0.1', pnl: '100' })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].pnlPercent).toBeCloseTo(2, 5)
  })

  it('pnlPercent is 0 when entryPrice * quantity = 0', async () => {
    setupMocks({ trades: [makeTrade({ entry_price: '0', quantity: '1', pnl: '100' })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].pnlPercent).toBe(0)
  })

  it('isOvernight=true when opened_at and closed_at are on different UTC days', async () => {
    setupMocks({ trades: [makeTrade({
      opened_at: '2025-06-01T23:00:00.000Z',
      closed_at: '2025-06-02T01:00:00.000Z',
    })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].isOvernight).toBe(true)
  })

  it('isOvernight=false when opened_at and closed_at are on the same UTC day', async () => {
    setupMocks({ trades: [makeTrade({
      opened_at: '2025-06-01T10:00:00.000Z',
      closed_at: '2025-06-01T12:00:00.000Z',
    })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].isOvernight).toBe(false)
  })

  it('isOvernight=false when opened_at is null', async () => {
    setupMocks({ trades: [makeTrade({ opened_at: null })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].isOvernight).toBe(false)
  })

  it('durationMin=0 when opened_at is null', async () => {
    setupMocks({ trades: [makeTrade({ opened_at: null, closed_at: '2025-06-01T12:00:00.000Z' })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].durationMin).toBe(0)
  })

  it('durationMin is correctly calculated in minutes', async () => {
    setupMocks({ trades: [makeTrade({
      opened_at: '2025-06-01T10:00:00.000Z',
      closed_at: '2025-06-01T12:30:00.000Z',  // 150 minutes later
    })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].durationMin).toBe(150)
  })

  it('direction defaults to "long" when direction is null', async () => {
    setupMocks({ trades: [makeTrade({ direction: null })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].side).toBe('long')
  })

  it('side is "short" when direction is "short"', async () => {
    setupMocks({ trades: [makeTrade({ direction: 'short' })] })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.trades[0].side).toBe('short')
  })

  it('returns 500 when trades pagination query fails', async () => {
    setupMocks({ tradesError: { message: 'query timeout' } })
    const res = await GET(makeReq())
    expect(res.status).toBe(500)
  })

  it('total_equity_usdt falls back to usdt_balance when null', async () => {
    const since = new Date('2025-06-01T00:00:00.000Z').getTime()
    const bal = makeBal({ recorded_at: '2025-05-31T12:00:00.000Z', total_equity_usdt: null, usdt_balance: 9500 })
    setupMocks({ balances: [bal] })
    const res = await GET(makeReq({ since: String(since) }))
    const body = await res.json()
    expect(body.accounts[0].initialCapital).toBe(9500)
  })
})
