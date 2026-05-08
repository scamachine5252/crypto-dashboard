// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockFromSelect = jest.fn()
const mockUpsert     = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'raw_fills') {
        return { select: mockFromSelect }
      }
      // trades
      return { upsert: mockUpsert }
    }),
  },
}))

// mock 'server-only' so bybit adapter can be imported
jest.mock('server-only', () => ({}))

import { PositionReconstructor } from '../position-reconstructor'

// Minimal raw_fill DB rows that reconstructPositions() can consume
function makeLinearFillRow(overrides: Record<string, unknown> = {}) {
  return {
    exec_time:   '2025-01-01T00:00:00.000Z',
    symbol:      'BTCUSDT',
    side:        'Buy',
    exec_qty:    0.1,
    exec_price:  50000,
    exec_pnl:    null,
    exec_fee:    0.5,
    closed_size: 0,
    raw_data:    {
      execTime:   '1735689600000',
      symbol:     'BTCUSDT',
      side:       'Buy',
      execType:   'Trade',
      execPrice:  '50000',
      execQty:    '0.1',
      execPnl:    '0',
      execFee:    '0.5',
      closedSize: '0',
      orderId:    'ord-001',
    },
    ...overrides,
  }
}

function makeSelectChain(rows: unknown[]) {
  // Simulate paginated Supabase chain: .select().eq().eq().order().range()
  const rangeFn = jest.fn().mockResolvedValue({ data: rows, error: null })
  const orderFn = jest.fn().mockReturnValue({ range: rangeFn })
  const eq2Fn   = jest.fn().mockReturnValue({ order: orderFn })
  const eq1Fn   = jest.fn().mockReturnValue({ eq: eq2Fn })
  const selectFn = jest.fn().mockReturnValue({ eq: eq1Fn })
  return { selectFn, rangeFn, orderFn, eq1Fn, eq2Fn }
}

describe('PositionReconstructor', () => {
  let reconstructor: PositionReconstructor

  beforeEach(() => {
    jest.clearAllMocks()
    reconstructor = new PositionReconstructor()
  })

  // ── empty raw_fills ───────────────────────────────────────────────────────

  it('does not upsert if raw_fills is empty', async () => {
    const { selectFn } = makeSelectChain([])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'bybit')

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── pagination ────────────────────────────────────────────────────────────

  it('fetches all pages until an empty page is returned', async () => {
    // First page: 1000 rows; second page: 0 rows (end)
    const page1 = Array.from({ length: 1000 }, (_, i) =>
      makeLinearFillRow({ exec_time: `2025-01-01T${String(i).padStart(2, '0').slice(-2)}:00:00.000Z` })
    )

    // page1 for linear[0], empty for linear[1] + all inverse pages
    const rangeFn = jest.fn()
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValue({ data: [], error: null })
    const orderFn = jest.fn().mockReturnValue({ range: rangeFn })
    const eq2Fn   = jest.fn().mockReturnValue({ order: orderFn })
    const eq1Fn   = jest.fn().mockReturnValue({ eq: eq2Fn })
    mockFromSelect.mockReturnValue({ eq: eq1Fn })

    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'bybit')

    // rangeFn called 3 times: linear page 0 (1000 rows), linear page 1 (empty), inverse page 0 (empty)
    expect(rangeFn).toHaveBeenCalledTimes(3)
    expect(rangeFn.mock.calls[0]).toEqual([0, 999])
    expect(rangeFn.mock.calls[1]).toEqual([1000, 1999])
  })

  // ── Binance reconstruct ───────────────────────────────────────────────────

  it('handles binance exchange without throwing', async () => {
    const { selectFn } = makeSelectChain([])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await expect(reconstructor.reconstruct('acc-1', 'binance')).resolves.not.toThrow()
  })

  // ── unsupported exchange ──────────────────────────────────────────────────

  it('returns without error for an unsupported exchange', async () => {
    await expect(reconstructor.reconstruct('acc-1', 'mexc')).resolves.not.toThrow()
    expect(mockFromSelect).not.toHaveBeenCalled()
  })

  // ── upsert called with correct shape ─────────────────────────────────────

  it('calls upsert on trades table with account_id and exchange', async () => {
    // A buy (open) + sell (close) pair forms one complete trade
    const openFill  = makeLinearFillRow({
      raw_data: {
        execTime: '1735689600000', symbol: 'BTCUSDT', side: 'Buy',
        execType: 'Trade', execPrice: '50000', execQty: '0.1',
        execPnl: '0', execFee: '0.5', closedSize: '0', orderId: 'ord-001',
      },
    })
    const closeFill = makeLinearFillRow({
      exec_time: '2025-01-01T01:00:00.000Z',
      raw_data: {
        execTime: '1735693200000', symbol: 'BTCUSDT', side: 'Sell',
        execType: 'Trade', execPrice: '51000', execQty: '0.1',
        execPnl: '100', execFee: '0.5', closedSize: '0.1', orderId: 'ord-002',
      },
    })

    const rangeFn = jest.fn()
      .mockResolvedValueOnce({ data: [openFill, closeFill], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    const orderFn = jest.fn().mockReturnValue({ range: rangeFn })
    const eq2Fn   = jest.fn().mockReturnValue({ order: orderFn })
    const eq1Fn   = jest.fn().mockReturnValue({ eq: eq2Fn })
    mockFromSelect.mockReturnValue({ eq: eq1Fn })

    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'bybit')

    expect(mockUpsert).toHaveBeenCalled()
    const rows = mockUpsert.mock.calls[0][0]
    expect(Array.isArray(rows)).toBe(true)
    if (rows.length > 0) {
      expect(rows[0]).toMatchObject({
        account_id: 'acc-1',
        exchange:   'bybit',
        symbol:     'BTC/USDT:USDT',  // bybitIdToSymbol('BTCUSDT', 'linear') → 'BTC/USDT:USDT'
      })
    }
  })
})
