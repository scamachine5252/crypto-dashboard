// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockStore      = jest.fn()
const mockStoreBatch = jest.fn()

jest.mock('../fill-processor', () => ({
  FillProcessor: jest.fn().mockImplementation(() => ({
    store:      mockStore,
    storeBatch: mockStoreBatch,
  })),
}))

import { OkxConnector } from '../connectors/okx-connector'
import type { FillProcessor, RawFill } from '../fill-processor'

beforeEach(() => jest.clearAllMocks())

const CREDS = { apiKey: 'okey', apiSecret: 'osec', passphrase: 'pass', accountId: 'acc-o' }

function makeFp(): FillProcessor {
  return { store: mockStore, storeBatch: mockStoreBatch } as unknown as FillProcessor
}

// ── Auth payload ─────────────────────────────────────────────────────────────

describe('OkxConnector — auth payload', () => {
  it('contains op=login with apiKey, passphrase, timestamp, sign', () => {
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp() })
    const payload = conn.buildAuthPayload()
    expect(payload.op).toBe('login')
    expect(Array.isArray(payload.args)).toBe(true)
    const arg = payload.args[0] as Record<string, string>
    expect(arg.apiKey).toBe('okey')
    expect(arg.passphrase).toBe('pass')
    expect(typeof arg.timestamp).toBe('string')
    expect(typeof arg.sign).toBe('string')
    // timestamp should be seconds (not ms)
    expect(Number(arg.timestamp)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 2)
  })
})

// ── Subscribe payload ─────────────────────────────────────────────────────────

describe('OkxConnector — subscribe payload', () => {
  it('subscribes to fills channel with instType ANY', () => {
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp() })
    const payload = conn.buildSubscribePayload()
    expect(payload.op).toBe('subscribe')
    expect(payload.args[0]).toMatchObject({ channel: 'fills', instType: 'ANY' })
  })
})

// ── exec_id ──────────────────────────────────────────────────────────────────

describe('OkxConnector — exec_id', () => {
  it('uses fillId as exec_id', () => {
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp() })
    expect(conn.buildExecId('fill-abc-123')).toBe('fill-abc-123')
  })
})

// ── handleMessage ─────────────────────────────────────────────────────────────

describe('OkxConnector — handleMessage', () => {
  it('calls store for fills event data', async () => {
    mockStore.mockResolvedValue(undefined)
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp() })

    await conn.handleMessage({
      event: 'fills',
      data: [{
        fillId:  'fill-001',
        instId:  'BTC-USDT-SWAP',
        ts:      '1735689600000',
        side:    'buy',
        fillSz:  '0.1',
        fillPx:  '50000',
        pnl:     '100',
        fee:     '-0.5',
      }],
    })

    expect(mockStore).toHaveBeenCalledTimes(1)
    const fill = mockStore.mock.calls[0][0]
    expect(fill.exec_id).toBe('fill-001')
    expect(fill.exchange).toBe('okx')
    expect(fill.account_id).toBe('acc-o')
    expect(fill.exec_pnl).toBe(100)
    expect(fill.exec_fee).toBe(0.5)  // abs of -0.5
    expect(fill.source).toBe('ws')
  })

  it('ignores non-fills events', async () => {
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp() })

    await conn.handleMessage({ event: 'login', code: '0' })
    await conn.handleMessage({ event: 'subscribe', arg: { channel: 'fills' } })

    expect(mockStore).not.toHaveBeenCalled()
  })

  it('uses abs value for fee (handles negative commission)', async () => {
    mockStore.mockResolvedValue(undefined)
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp() })

    await conn.handleMessage({
      arg: { channel: 'fills' },
      data: [{
        fillId: 'f2', instId: 'ETH-USDT', ts: '100', side: 'sell',
        fillSz: '1', fillPx: '3000', pnl: '0', fee: '-1.5',
      }],
    })

    const fill = mockStore.mock.calls[0][0]
    expect(fill.exec_fee).toBe(1.5)
  })

  it('updates lastFillTime when a fill is received via WS', async () => {
    mockStore.mockResolvedValue(undefined)
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp(), lastFillTime: 0 })

    await conn.handleMessage({
      arg: { channel: 'fills' },
      data: [{
        fillId: 'f3', instId: 'BTC-USDT-SWAP', ts: '1735689600000',
        side: 'buy', fillSz: '0.1', fillPx: '50000', pnl: '100', fee: '-0.5',
      }],
    })

    expect((conn as unknown as { lastFillTime: number }).lastFillTime).toBe(1735689600000)
  })
})

// ── Startup gap fill ─────────────────────────────────────────────────────────

describe('OkxConnector — startup gap fill', () => {
  it('runs gap fill before first connectOnce', async () => {
    const callOrder: string[] = []
    const mockGapFills = jest.fn().mockImplementation(async () => {
      callOrder.push('gapFill')
      return []
    })
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp(), fetchGapFills: mockGapFills })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(conn as any, 'connectOnce')
      .mockImplementation(async () => { callOrder.push('connectOnce'); conn.disconnect() })

    await conn.connect()

    expect(callOrder[0]).toBe('gapFill')
    expect(callOrder[1]).toBe('connectOnce')
  })
})

// ── runGapFill updates lastFillTime ──────────────────────────────────────────

describe('OkxConnector — runGapFill updates lastFillTime', () => {
  it('advances lastFillTime to max exec_time of fetched fills', async () => {
    const ts = 1735689600000
    const mockFill: RawFill = {
      account_id: 'acc', exchange: 'okx', exec_id: 'x', symbol: 'BTC-USDT',
      exec_time: new Date(ts), side: 'buy', exec_qty: 1, exec_price: 50000,
      raw_data: {}, source: 'rest',
    }
    const mockGapFills = jest.fn().mockResolvedValue([mockFill])
    const conn = new OkxConnector({ ...CREDS, fillProcessor: makeFp(), fetchGapFills: mockGapFills })
    mockStoreBatch.mockResolvedValue(undefined)

    await conn.runGapFill(0, ts + 1000)

    expect((conn as unknown as { lastFillTime: number }).lastFillTime).toBe(ts)
  })
})
