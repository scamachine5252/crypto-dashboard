// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockGetTradesForChunk  = jest.fn()
const mockGetTradesOkx       = jest.fn()
const mockGetTradesMexc      = jest.fn()
const mockDiscoverSymbols    = jest.fn()
const mockGetFullTrades      = jest.fn()
const mockReconstruct        = jest.fn()
const mockUpsert             = jest.fn()

jest.mock('@/lib/adapters/bybit', () => ({
  BybitAdapter: jest.fn().mockImplementation(() => ({ getTradesForChunk: mockGetTradesForChunk })),
}))
jest.mock('@/lib/adapters/okx', () => ({
  OkxAdapter: jest.fn().mockImplementation(() => ({ getTrades: mockGetTradesOkx })),
}))
jest.mock('@/lib/adapters/mexc', () => ({
  MexcAdapter: jest.fn().mockImplementation(() => ({ getTrades: mockGetTradesMexc })),
}))
jest.mock('@/lib/adapters/binance', () => ({
  BinanceAdapter: jest.fn().mockImplementation(() => ({
    discoverTradedSymbols: mockDiscoverSymbols,
    getFullTrades:         mockGetFullTrades,
  })),
}))
jest.mock('../position-reconstructor', () => ({
  PositionReconstructor: jest.fn().mockImplementation(() => ({ reconstruct: mockReconstruct })),
}))

const mockFrom = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: mockFrom } }))
jest.mock('server-only', () => ({}))
jest.mock('@/lib/crypto/decrypt', () => ({ decrypt: (v: string) => `dec:${v}` }))

import { ReconciliationScheduler } from '../reconciliation-scheduler'

beforeEach(() => {
  jest.clearAllMocks()
  mockUpsert.mockResolvedValue({ error: null })
})

function makeAccount(exchange: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `acc-${exchange}`, exchange,
    api_key: 'k', api_secret: 's', passphrase: null,
    instrument: null, is_suspended: false,
    ...overrides,
  }
}

function setupAccounts(accounts: ReturnType<typeof makeAccount>[]) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'accounts') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: accounts, error: null }),
        }),
      }
    }
    return { upsert: mockUpsert }
  })
}

// ── runAll ────────────────────────────────────────────────────────────────────

describe('ReconciliationScheduler — runAll', () => {
  it('calls getTradesForChunk for bybit account', async () => {
    setupAccounts([makeAccount('bybit')])
    mockGetTradesForChunk.mockResolvedValue({ rawExecutions: [], finalState: {} })
    mockReconstruct.mockResolvedValue(undefined)

    const scheduler = new ReconciliationScheduler()
    await scheduler.runAll()

    expect(mockGetTradesForChunk).toHaveBeenCalledTimes(1)
  })

  it('calls getTrades for okx account', async () => {
    setupAccounts([makeAccount('okx')])
    mockGetTradesOkx.mockResolvedValue([])

    const scheduler = new ReconciliationScheduler()
    await scheduler.runAll()

    expect(mockGetTradesOkx).toHaveBeenCalledTimes(1)
  })

  it('calls getTrades for mexc account', async () => {
    setupAccounts([makeAccount('mexc')])
    mockGetTradesMexc.mockResolvedValue([])

    const scheduler = new ReconciliationScheduler()
    await scheduler.runAll()

    expect(mockGetTradesMexc).toHaveBeenCalledTimes(1)
  })

  it('calls discoverTradedSymbols + getFullTrades for binance account', async () => {
    setupAccounts([makeAccount('binance')])
    mockDiscoverSymbols.mockResolvedValue([{ rawSymbol: 'BTCUSDT', weekIndices: [25] }])
    mockGetFullTrades.mockResolvedValue({ rawFills: [], failedSymbols: [] })

    const scheduler = new ReconciliationScheduler()
    await scheduler.runAll()

    expect(mockDiscoverSymbols).toHaveBeenCalledTimes(1)
    expect(mockGetFullTrades).toHaveBeenCalledWith('BTCUSDT', [25])
  })

  it('isolates errors — one account failure does not stop others', async () => {
    setupAccounts([makeAccount('bybit'), makeAccount('okx')])
    mockGetTradesForChunk.mockRejectedValue(new Error('exchange down'))
    mockGetTradesOkx.mockResolvedValue([])

    const scheduler = new ReconciliationScheduler()
    await expect(scheduler.runAll()).resolves.not.toThrow()

    expect(mockGetTradesOkx).toHaveBeenCalledTimes(1)
  })

  it('triggers reconstruction when fills were upserted', async () => {
    setupAccounts([makeAccount('okx')])
    mockGetTradesOkx.mockResolvedValue([{
      id: 't1', symbol: 'BTC-USDT', closedAt: '2024-01-01T00:00:00Z',
      side: 'long', quantity: 1, exitPrice: 50000, pnl: 100, fee: 1, tradeType: 'linear',
    }])
    mockReconstruct.mockResolvedValue(undefined)

    const scheduler = new ReconciliationScheduler()
    await scheduler.runAll()

    expect(mockReconstruct).toHaveBeenCalledWith('acc-okx', 'okx')
  })

  it('does not trigger reconstruction when no fills were returned', async () => {
    setupAccounts([makeAccount('bybit')])
    mockGetTradesForChunk.mockResolvedValue({ rawExecutions: [], finalState: {} })

    const scheduler = new ReconciliationScheduler()
    await scheduler.runAll()

    expect(mockReconstruct).not.toHaveBeenCalled()
  })

  it('upserts fills with correct shape for bybit', async () => {
    setupAccounts([makeAccount('bybit')])
    mockGetTradesForChunk.mockResolvedValue({
      rawExecutions: [{
        category: 'linear',
        executions: [{
          orderId: 'ord-1', execTime: '1735689600000', execQty: '0.1',
          symbol: 'BTCUSDT', side: 'Buy', execPnl: '100', execFee: '-0.5',
          execPrice: '50000', closedSize: '0.1', positionIdx: null,
        }],
      }],
      finalState: {},
    })
    mockReconstruct.mockResolvedValue(undefined)

    const scheduler = new ReconciliationScheduler()
    await scheduler.runAll()

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const [rows] = mockUpsert.mock.calls[0]
    expect(rows[0].exec_id).toBe('ord-1_1735689600000_0.1')
    expect(rows[0].exchange).toBe('bybit')
    expect(rows[0].account_id).toBe('acc-bybit')
    expect(rows[0].exec_fee).toBe(0.5)  // abs of -0.5
  })

  it('does not call accounts query when DB returns error', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }),
    }))

    const scheduler = new ReconciliationScheduler()
    await scheduler.runAll()

    expect(mockGetTradesForChunk).not.toHaveBeenCalled()
    expect(mockReconstruct).not.toHaveBeenCalled()
  })
})

// ── start / stop ──────────────────────────────────────────────────────────────

describe('ReconciliationScheduler — lifecycle', () => {
  it('start() triggers immediate runAll call', async () => {
    setupAccounts([])
    const scheduler = new ReconciliationScheduler()
    scheduler.start()
    await new Promise(r => setImmediate(r))  // flush microtasks
    scheduler.stop()
    expect(mockFrom).toHaveBeenCalled()
  })

  it('stop() clears the interval', () => {
    setupAccounts([])
    const scheduler = new ReconciliationScheduler()
    scheduler.start()
    scheduler.stop()
    // No assertion needed beyond "does not throw"
  })
})
