// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports
// ---------------------------------------------------------------------------
const mockRpc    = jest.fn()
const mockFrom   = jest.fn()
const mockRedis  = { set: jest.fn(), del: jest.fn(), disconnect: jest.fn() }
const mockConnectorDisconnect = jest.fn()

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => mockRedis)
)

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: mockFrom,
    rpc:  mockRpc,
  },
}))

jest.mock('server-only', () => ({}))

// Stub all connector classes — we only care about manager behaviour
jest.mock('../connectors/bybit-connector',   () => ({ BybitConnector:   jest.fn().mockImplementation(() => ({ connect: jest.fn().mockResolvedValue(undefined), disconnect: mockConnectorDisconnect })) }))
jest.mock('../connectors/binance-connector', () => ({ BinanceConnector: jest.fn().mockImplementation(() => ({ connect: jest.fn().mockResolvedValue(undefined), disconnect: mockConnectorDisconnect })) }))
jest.mock('../connectors/okx-connector',     () => ({ OkxConnector:     jest.fn().mockImplementation(() => ({ connect: jest.fn().mockResolvedValue(undefined), disconnect: mockConnectorDisconnect })) }))
jest.mock('../connectors/mexc-connector',    () => ({ MexcConnector:    jest.fn().mockImplementation(() => ({ connect: jest.fn().mockResolvedValue(undefined), disconnect: mockConnectorDisconnect })) }))

jest.mock('../fill-processor',              () => ({ FillProcessor: jest.fn().mockImplementation(() => ({})) }))
jest.mock('../position-reconstructor',      () => ({ PositionReconstructor: jest.fn().mockImplementation(() => ({ reconstruct: jest.fn() })) }))
jest.mock('@/lib/crypto/decrypt',           () => ({ decrypt: (v: string) => v + '_decrypted' }))
jest.mock('@/lib/adapters/bybit',           () => ({ BybitAdapter: jest.fn().mockImplementation(() => ({})) }))
jest.mock('@/lib/adapters/okx',             () => ({ OkxAdapter:   jest.fn().mockImplementation(() => ({})) }))
jest.mock('@/lib/adapters/mexc',            () => ({ MexcAdapter:  jest.fn().mockImplementation(() => ({})) }))

import { ConnectorManager } from '../connector-manager'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAccount(exchange: string, id = `acc-${exchange}`, suspended = false) {
  return { id, exchange, api_key: 'key', api_secret: 'secret', passphrase: null, instrument: null, is_suspended: suspended }
}

function setupAccountsMock(accounts: ReturnType<typeof makeAccount>[]) {
  mockFrom.mockReturnValue({
    select: jest.fn().mockResolvedValue({ data: accounts, error: null }),
  })
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks()
  // Default: RPC succeeds with empty result (no fills yet)
  mockRpc.mockResolvedValue({ data: [], error: null })
})

// ---------------------------------------------------------------------------
// RPC batch query
// ---------------------------------------------------------------------------

describe('start() — lastFillTime batch RPC', () => {
  it('calls latest_fill_per_account once with all account IDs (not N per-account queries)', async () => {
    setupAccountsMock([makeAccount('bybit', 'acc-1'), makeAccount('bybit', 'acc-2')])

    const manager = new ConnectorManager('redis://localhost')
    await manager.start()

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('latest_fill_per_account', {
      account_ids: ['acc-1', 'acc-2'],
    })
  })

  it('uses lastFillTime from RPC when available', async () => {
    const fillTime = '2025-01-15T10:00:00.000Z'
    setupAccountsMock([makeAccount('bybit', 'acc-1')])
    mockRpc.mockResolvedValue({
      data: [{ account_id: 'acc-1', exec_time: fillTime }],
      error: null,
    })
    const { BybitConnector } = jest.requireMock('../connectors/bybit-connector')

    const manager = new ConnectorManager('redis://localhost')
    await manager.start()

    const callArgs = BybitConnector.mock.calls[0][0]
    expect(callArgs.lastFillTime).toBe(new Date(fillTime).getTime())
  })

  it('defaults lastFillTime to 0 when account has no fills in RPC result', async () => {
    setupAccountsMock([makeAccount('bybit', 'acc-1')])
    mockRpc.mockResolvedValue({ data: [], error: null })  // no fills
    const { BybitConnector } = jest.requireMock('../connectors/bybit-connector')

    const manager = new ConnectorManager('redis://localhost')
    await manager.start()

    const callArgs = BybitConnector.mock.calls[0][0]
    expect(callArgs.lastFillTime).toBe(0)
  })

  it('logs an error and continues when RPC fails (migration not applied)', async () => {
    setupAccountsMock([makeAccount('bybit', 'acc-1')])
    mockRpc.mockResolvedValue({
      data:  null,
      error: { message: 'Could not find the function public.latest_fill_per_account(account_ids) in the schema cache' },
    })
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { BybitConnector } = jest.requireMock('../connectors/bybit-connector')

    const manager = new ConnectorManager('redis://localhost')
    await manager.start()   // should not throw

    // Must log a clear error (not silently fall through)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('latest_fill_per_account RPC failed'),
      expect.any(String),
    )
    // Connector still starts (best-effort), just with lastFillTime=0
    expect(BybitConnector).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('skips RPC call when there are no active accounts', async () => {
    setupAccountsMock([])

    const manager = new ConnectorManager('redis://localhost')
    await manager.start()

    expect(mockRpc).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Suspended accounts
// ---------------------------------------------------------------------------

describe('start() — suspended account filtering', () => {
  it('does not start a connector for suspended accounts', async () => {
    setupAccountsMock([
      makeAccount('bybit', 'active-1', false),
      makeAccount('bybit', 'suspended-1', true),
    ])
    const { BybitConnector } = jest.requireMock('../connectors/bybit-connector')

    const manager = new ConnectorManager('redis://localhost')
    await manager.start()

    // Only one connector started, not two
    expect(BybitConnector).toHaveBeenCalledTimes(1)
    expect(BybitConnector.mock.calls[0][0].accountId).toBe('active-1')
  })

  it('does not include suspended accounts in the RPC batch', async () => {
    setupAccountsMock([
      makeAccount('bybit', 'active-1', false),
      makeAccount('bybit', 'suspended-1', true),
    ])

    const manager = new ConnectorManager('redis://localhost')
    await manager.start()

    expect(mockRpc).toHaveBeenCalledWith('latest_fill_per_account', {
      account_ids: ['active-1'],   // suspended-1 excluded
    })
  })
})

// ---------------------------------------------------------------------------
// stopAndWait drain
// ---------------------------------------------------------------------------

describe('stopAndWait() — drain counter', () => {
  it('resolves immediately when no gap fills are in flight', async () => {
    setupAccountsMock([])
    const manager = new ConnectorManager('redis://localhost')
    await manager.start()

    const start = Date.now()
    await manager.stopAndWait(5_000)
    expect(Date.now() - start).toBeLessThan(200)
  })
})
