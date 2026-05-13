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

// mock 'server-only' so bybit/binance adapters can be imported
jest.mock('server-only', () => ({}))

import { PositionReconstructor } from '../position-reconstructor'

// ---------------------------------------------------------------------------
// Chain builder — supports any number of .eq() calls before .order().range()
// ---------------------------------------------------------------------------
function makeFlexibleSelectChain(pages: unknown[][]) {
  let callCount = 0
  const rangeFn = jest.fn().mockImplementation(() => {
    const data = pages[callCount] ?? []
    callCount++
    return Promise.resolve({ data, error: null })
  })
  const orderFn = jest.fn().mockReturnValue({ range: rangeFn })

  const makeEqResult = (): { eq: jest.Mock; order: jest.Mock } => {
    const result: { eq: jest.Mock; order: jest.Mock } = {
      eq:    jest.fn().mockImplementation(() => makeEqResult()),
      order: orderFn,
    }
    return result
  }

  const selectFn = jest.fn().mockReturnValue(makeEqResult())
  return { selectFn, rangeFn }
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

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
    raw_data: {
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

function makeBinanceFillRow(overrides: Record<string, unknown> = {}) {
  return {
    exec_time:  '2025-01-01T10:00:00.000Z',
    symbol:     'BTCUSDT',
    side:       'BUY',
    exec_qty:   0.01,
    exec_price: 50000,
    exec_pnl:   0,
    exec_fee:   0.5,
    category:   'BOTH',
    raw_data: {
      symbol:          'BTCUSDT',
      side:            'BUY',
      price:           '50000',
      qty:             '0.01',
      realizedPnl:     '0',
      commission:      '0.5',
      commissionAsset: 'USDT',
      time:            1735725600000,
      positionSide:    'BOTH',
      orderId:         123456,
      id:              789,
    },
    ...overrides,
  }
}

function makeOkxFillRow(overrides: Record<string, unknown> = {}) {
  return {
    exec_time:  '2025-01-01T10:00:00.000Z',
    symbol:     'BTC-USDT-SWAP',
    side:       'buy',
    exec_qty:   0.01,
    exec_price: 50000,
    exec_pnl:   100,
    exec_fee:   0.5,
    category:   'futures',
    exec_id:    'fill-okx-001',
    raw_data:   { fillId: 'fill-okx-001', instId: 'BTC-USDT-SWAP', pnl: '100' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PositionReconstructor', () => {
  let reconstructor: PositionReconstructor

  beforeEach(() => {
    jest.clearAllMocks()
    reconstructor = new PositionReconstructor()
  })

  // ── empty raw_fills ───────────────────────────────────────────────────────

  it('does not upsert if raw_fills is empty (bybit)', async () => {
    const { selectFn } = makeFlexibleSelectChain([[], []])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'bybit')

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── pagination ────────────────────────────────────────────────────────────

  it('fetches all pages until an empty page is returned', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) =>
      makeLinearFillRow({ exec_time: `2025-01-01T${String(i % 24).padStart(2, '0')}:00:00.000Z` })
    )
    // linear: page0=1000 rows, page1=empty; inverse: page0=empty
    const { selectFn, rangeFn } = makeFlexibleSelectChain([page1, [], []])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'bybit')

    // rangeFn called 3 times: linear[0]=1000, linear[1]=empty, inverse[0]=empty
    expect(rangeFn).toHaveBeenCalledTimes(3)
    expect(rangeFn.mock.calls[0]).toEqual([0, 999])
    expect(rangeFn.mock.calls[1]).toEqual([1000, 1999])
  })

  // ── Bybit upsert shape ────────────────────────────────────────────────────

  it('calls upsert on trades table with account_id and exchange (bybit)', async () => {
    const openFill = makeLinearFillRow({
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

    // linear: [openFill, closeFill], then empty; inverse: empty
    const { selectFn } = makeFlexibleSelectChain([[openFill, closeFill], [], []])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'bybit')

    expect(mockUpsert).toHaveBeenCalled()
    const rows = mockUpsert.mock.calls[0][0]
    expect(Array.isArray(rows)).toBe(true)
    if (rows.length > 0) {
      expect(rows[0]).toMatchObject({
        account_id: 'acc-1',
        exchange:   'bybit',
        symbol:     'BTC/USDT:USDT',
      })
    }
  })

  // ── Binance reconstruction ────────────────────────────────────────────────

  it('binance: reconstructs trades from raw_fills grouped by symbol', async () => {
    const openFill = makeBinanceFillRow({
      raw_data: {
        symbol: 'BTCUSDT', side: 'BUY', price: '50000', qty: '0.01',
        realizedPnl: '0', commission: '0.5', commissionAsset: 'USDT',
        time: 1735725600000, positionSide: 'BOTH', orderId: 1, id: 1,
      },
    })
    const closeFill = makeBinanceFillRow({
      exec_time: '2025-01-01T11:00:00.000Z',
      exec_pnl:  100,
      raw_data: {
        symbol: 'BTCUSDT', side: 'SELL', price: '51000', qty: '0.01',
        realizedPnl: '100', commission: '0.5', commissionAsset: 'USDT',
        time: 1735729200000, positionSide: 'BOTH', orderId: 2, id: 2,
      },
    })

    const { selectFn } = makeFlexibleSelectChain([[openFill, closeFill], []])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'binance')

    expect(mockUpsert).toHaveBeenCalled()
    const rows = mockUpsert.mock.calls[0][0]
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toMatchObject({
      account_id: 'acc-1',
      exchange:   'binance',
      pnl:        100,
    })
  })

  it('binance: does not upsert if raw_fills is empty', async () => {
    const { selectFn } = makeFlexibleSelectChain([[]])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'binance')

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── OKX reconstruction ────────────────────────────────────────────────────

  it('okx: maps each raw_fill to one trade row', async () => {
    const fill1 = makeOkxFillRow({ exec_id: 'fill-001', exec_pnl: 50,  exec_time: '2025-01-01T10:00:00.000Z' })
    const fill2 = makeOkxFillRow({ exec_id: 'fill-002', exec_pnl: -20, side: 'sell', exec_time: '2025-01-01T11:00:00.000Z' })

    const { selectFn } = makeFlexibleSelectChain([[fill1, fill2], []])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'okx')

    expect(mockUpsert).toHaveBeenCalled()
    const rows = mockUpsert.mock.calls[0][0]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ account_id: 'acc-1', exchange: 'okx' })
    expect(rows[1].side).toBe('sell')
  })

  it('okx: does not upsert if raw_fills is empty', async () => {
    const { selectFn } = makeFlexibleSelectChain([[]])
    mockFromSelect.mockImplementation(selectFn)
    mockUpsert.mockResolvedValue({ error: null })

    await reconstructor.reconstruct('acc-1', 'okx')

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── unsupported exchange ──────────────────────────────────────────────────

  it('returns without error for an unsupported exchange (mexc)', async () => {
    await expect(reconstructor.reconstruct('acc-1', 'mexc')).resolves.not.toThrow()
    expect(mockFromSelect).not.toHaveBeenCalled()
  })
})
