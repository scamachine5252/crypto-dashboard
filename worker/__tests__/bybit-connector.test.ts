// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockFillProcessorStore   = jest.fn()
const mockFillProcessorBatch   = jest.fn()

jest.mock('../fill-processor', () => ({
  FillProcessor: jest.fn().mockImplementation(() => ({
    store:      mockFillProcessorStore,
    storeBatch: mockFillProcessorBatch,
  })),
}))

// WebSocket mock
type WsEventMap = Record<string, ((...args: unknown[]) => void)[]>
class MockWebSocket {
  static OPEN = 1
  readyState = MockWebSocket.OPEN
  private listeners: WsEventMap = {}

  send     = jest.fn()
  close    = jest.fn()

  on(event: string, cb: (...args: unknown[]) => void) {
    ;(this.listeners[event] ??= []).push(cb)
    return this
  }

  emit(event: string, ...args: unknown[]) {
    for (const cb of this.listeners[event] ?? []) cb(...args)
  }
}

let wsInstance: MockWebSocket
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => {
    wsInstance = new MockWebSocket()
    return wsInstance
  })
})

import { BybitConnector } from '../connectors/bybit-connector'
import type { FillProcessor, RawFill } from '../fill-processor'

beforeEach(() => jest.clearAllMocks())

const CREDS = { apiKey: 'test-key', apiSecret: 'test-secret', accountId: 'acc-1' }

function makeConnector(lastFillTime = 0) {
  const fp = { store: mockFillProcessorStore, storeBatch: mockFillProcessorBatch } as unknown as FillProcessor
  return new BybitConnector({ ...CREDS, lastFillTime, fillProcessor: fp })
}

// ── exec_id composite key ────────────────────────────────────────────────────

describe('BybitConnector — exec_id', () => {
  it('builds composite exec_id as orderId_execTime_execQty', () => {
    const connector = makeConnector()
    const id = connector.buildExecId({ orderId: 'ord-123', execTime: '1735689600000', execQty: '0.1' })
    expect(id).toBe('ord-123_1735689600000_0.1')
  })

  it('handles string execQty with many decimals', () => {
    const connector = makeConnector()
    const id = connector.buildExecId({ orderId: 'o1', execTime: '111', execQty: '0.001234567' })
    expect(id).toBe('o1_111_0.001234567')
  })
})

// ── Funding fill exec_id ─────────────────────────────────────────────────────

describe('BybitConnector — funding fill mapping', () => {
  it('builds funding exec_id as funding_{symbol}_{execTime}', () => {
    const connector = makeConnector()
    const id = connector.buildFundingExecId({ symbol: 'BTCUSDT', execTime: '1735689600000' })
    expect(id).toBe('funding_BTCUSDT_1735689600000')
  })
})

// ── Auth payload ─────────────────────────────────────────────────────────────

describe('BybitConnector — auth payload', () => {
  it('contains op=auth with [apiKey, expires, sign]', () => {
    const connector = makeConnector()
    const payload = connector.buildAuthPayload()
    expect(payload.op).toBe('auth')
    expect(Array.isArray(payload.args)).toBe(true)
    expect(payload.args[0]).toBe('test-key')
    expect(typeof payload.args[1]).toBe('number')   // expires
    expect(typeof payload.args[2]).toBe('string')   // HMAC sign
    expect(payload.args[1]).toBeGreaterThan(Date.now())  // expires in future
  })

  it('expires is ~5s in the future', () => {
    const before = Date.now()
    const connector = makeConnector()
    const payload = connector.buildAuthPayload()
    const after  = Date.now()
    expect(payload.args[1]).toBeGreaterThanOrEqual(before + 4500)
    expect(payload.args[1]).toBeLessThanOrEqual(after  + 5500)
  })
})

// ── Subscribe payload ────────────────────────────────────────────────────────

describe('BybitConnector — subscribe payload', () => {
  it('subscribes to execution.linear, execution.inverse, execution.spot', () => {
    const connector = makeConnector()
    const payload = connector.buildSubscribePayload()
    expect(payload.op).toBe('subscribe')
    expect(payload.args).toContain('execution.linear')
    expect(payload.args).toContain('execution.inverse')
    expect(payload.args).toContain('execution.spot')
  })
})

// ── Message handling ─────────────────────────────────────────────────────────

describe('BybitConnector — handleMessage', () => {
  it('calls fillProcessor.store for execution topic with execType=Trade', async () => {
    const connector = makeConnector()
    mockFillProcessorStore.mockResolvedValue(undefined)

    await connector.handleMessage({
      topic: 'execution.linear',
      data: [{
        orderId:    'ord-1',
        execTime:   '1735689600000',
        execQty:    '0.1',
        symbol:     'BTCUSDT',
        side:       'Buy',
        execType:   'Trade',
        execPrice:  '50000',
        execPnl:    '0',
        execFee:    '0.5',
        closedSize: '0',
      }],
    })

    expect(mockFillProcessorStore).toHaveBeenCalledTimes(1)
    const fill = mockFillProcessorStore.mock.calls[0][0]
    expect(fill.exec_id).toBe('ord-1_1735689600000_0.1')
    expect(fill.exchange).toBe('bybit')
    expect(fill.account_id).toBe('acc-1')
    expect(fill.source).toBe('ws')
    expect(fill.category).toBe('linear')
  })

  it('ignores messages without data or with non-execution topic', async () => {
    const connector = makeConnector()

    await connector.handleMessage({ op: 'pong' })
    await connector.handleMessage({ topic: 'order', data: [{}] as unknown[] })

    expect(mockFillProcessorStore).not.toHaveBeenCalled()
  })

  it('maps Funding execType with funding exec_id format', async () => {
    const connector = makeConnector()
    mockFillProcessorStore.mockResolvedValue(undefined)

    await connector.handleMessage({
      topic: 'execution.linear',
      data: [{
        orderId:   'funding-ord',
        execTime:  '1735689600000',
        execQty:   '0',
        symbol:    'BTCUSDT',
        side:      'Buy',
        execType:  'Funding',
        execPrice: '0',
        execPnl:   '0',
        execFee:   '-0.25',
        closedSize: '0',
      }],
    })

    expect(mockFillProcessorStore).toHaveBeenCalledTimes(1)
    const fill = mockFillProcessorStore.mock.calls[0][0]
    expect(fill.exec_id).toBe('funding_BTCUSDT_1735689600000')
  })

  it('ignores execType other than Trade or Funding', async () => {
    const connector = makeConnector()

    await connector.handleMessage({
      topic: 'execution.linear',
      data: [{ execType: 'AdlTrade', orderId: 'x', execTime: '1', execQty: '0.1', symbol: 'X' }] as unknown[],
    })

    expect(mockFillProcessorStore).not.toHaveBeenCalled()
  })
})

// ── Startup gap fill ─────────────────────────────────────────────────────────

describe('BybitConnector — startup gap fill', () => {
  it('runs gap fill before first connectOnce', async () => {
    const callOrder: string[] = []
    const mockGapFills = jest.fn().mockImplementation(async () => {
      callOrder.push('gapFill')
      return []
    })
    const fp = { store: mockFillProcessorStore, storeBatch: mockFillProcessorBatch } as unknown as FillProcessor
    const conn = new BybitConnector({ ...CREDS, fillProcessor: fp, fetchGapFills: mockGapFills })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(conn as any, 'connectOnce')
      .mockImplementation(async () => { callOrder.push('connectOnce'); conn.disconnect() })

    await conn.connect()

    expect(callOrder[0]).toBe('gapFill')
    expect(callOrder[1]).toBe('connectOnce')
  })
})

// ── runGapFill updates lastFillTime ──────────────────────────────────────────

describe('BybitConnector — runGapFill updates lastFillTime', () => {
  it('advances lastFillTime to max exec_time of fetched fills', async () => {
    const ts = 1735689600000
    const mockFill: RawFill = {
      account_id: 'acc', exchange: 'bybit', exec_id: 'x', symbol: 'BTC',
      exec_time: new Date(ts), side: 'buy', exec_qty: 1, exec_price: 50000,
      raw_data: {}, source: 'rest',
    }
    const mockGapFills = jest.fn().mockResolvedValue([mockFill])
    const fp = { store: mockFillProcessorStore, storeBatch: mockFillProcessorBatch } as unknown as FillProcessor
    const conn = new BybitConnector({ ...CREDS, fillProcessor: fp, fetchGapFills: mockGapFills })
    mockFillProcessorBatch.mockResolvedValue(undefined)

    await conn.runGapFill(0, ts + 1000)

    expect((conn as unknown as { lastFillTime: number }).lastFillTime).toBe(ts)
  })
})

// ── Gap fill on reconnect ────────────────────────────────────────────────────

describe('BybitConnector — gap fill', () => {
  it('calls storeBatch with fills fetched since lastFillTime', async () => {
    const fetchGapFills = jest.fn().mockResolvedValue([
      {
        account_id: 'acc-1', exchange: 'bybit', exec_id: 'gap-fill-1',
        symbol: 'BTCUSDT', exec_time: new Date(), side: 'Buy',
        exec_qty: 0.1, exec_price: 50000, raw_data: {}, source: 'rest' as const,
      },
    ])
    mockFillProcessorBatch.mockResolvedValue(1)

    const fp = { store: mockFillProcessorStore, storeBatch: mockFillProcessorBatch } as unknown as FillProcessor
    const connector = new BybitConnector({ ...CREDS, lastFillTime: 1000, fillProcessor: fp, fetchGapFills })

    await connector.runGapFill(1000, Date.now())

    expect(fetchGapFills).toHaveBeenCalledWith(1000, expect.any(Number))
    expect(mockFillProcessorBatch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ exec_id: 'gap-fill-1' }),
    ]))
  })
})
