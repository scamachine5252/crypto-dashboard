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

// Mock node-fetch / global fetch used for listenKey management
const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

import { BinanceConnector } from '../connectors/binance-connector'
import type { FillProcessor, RawFill } from '../fill-processor'

beforeEach(() => jest.clearAllMocks())

const CREDS = { apiKey: 'bkey', apiSecret: 'bsec', accountId: 'acc-b' }

function makeFp(): FillProcessor {
  return { store: mockStore, storeBatch: mockStoreBatch } as unknown as FillProcessor
}

// ── listenKey URL ────────────────────────────────────────────────────────────

describe('BinanceConnector — listenKey URL', () => {
  it('uses FAPI endpoint for non-PM accounts', () => {
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp() })
    expect(conn.listenKeyUrl()).toBe('https://fapi.binance.com/fapi/v1/listenKey')
  })

  it('uses PAPI endpoint for portfolio-margin accounts', () => {
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: true, fillProcessor: makeFp() })
    expect(conn.listenKeyUrl()).toBe('https://papi.binance.com/papi/v1/listenKey')
  })
})

// ── WebSocket URL ─────────────────────────────────────────────────────────────

describe('BinanceConnector — WS URL', () => {
  it('uses fstream URL for non-PM (listenKey prefix ws/)', () => {
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp() })
    expect(conn.wsUrl('abc123')).toBe('wss://fstream.binance.com/ws/abc123')
  })

  it('uses fstream PM URL for portfolio-margin (prefix pm/)', () => {
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: true, fillProcessor: makeFp() })
    expect(conn.wsUrl('abc123')).toBe('wss://fstream.binance.com/pm/abc123')
  })
})

// ── exec_id ──────────────────────────────────────────────────────────────────

describe('BinanceConnector — exec_id', () => {
  it('uses tradeId (o.t) as exec_id', () => {
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp() })
    expect(conn.buildExecId(987654321)).toBe('987654321')
  })
})

// ── handleMessage ─────────────────────────────────────────────────────────────

describe('BinanceConnector — handleMessage', () => {
  it('calls store for ORDER_TRADE_UPDATE with x=TRADE', async () => {
    mockStore.mockResolvedValue(undefined)
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp() })

    await conn.handleMessage({
      e: 'ORDER_TRADE_UPDATE',
      o: {
        t: 999,
        s: 'BTCUSDT',
        T: 1735689600000,
        S: 'BUY',
        l: '0.1',
        L: '50000',
        rp: '100',
        n: '0.5',
        ps: 'LONG',
        x: 'TRADE',
      },
    })

    expect(mockStore).toHaveBeenCalledTimes(1)
    const fill = mockStore.mock.calls[0][0]
    expect(fill.exec_id).toBe('999')
    expect(fill.exchange).toBe('binance')
    expect(fill.account_id).toBe('acc-b')
    expect(fill.exec_qty).toBe(0.1)
    expect(fill.exec_pnl).toBe(100)
    expect(fill.source).toBe('ws')
  })

  it('ignores ORDER_TRADE_UPDATE with x != TRADE', async () => {
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp() })

    await conn.handleMessage({
      e: 'ORDER_TRADE_UPDATE',
      o: { t: 1, s: 'X', T: 0, S: 'BUY', l: '0', L: '0', rp: '0', n: '0', ps: 'BOTH', x: 'NEW' },
    })

    expect(mockStore).not.toHaveBeenCalled()
  })

  it('ignores non ORDER_TRADE_UPDATE events', async () => {
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp() })

    await conn.handleMessage({ e: 'ACCOUNT_UPDATE', a: {} })
    expect(mockStore).not.toHaveBeenCalled()
  })

  it('uses Math.abs for exec_fee (handles negative rebates)', async () => {
    mockStore.mockResolvedValue(undefined)
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp() })

    await conn.handleMessage({
      e: 'ORDER_TRADE_UPDATE',
      o: { t: 1, s: 'BTCUSDT', T: 0, S: 'SELL', l: '0.1', L: '50000', rp: '0', n: '-0.25', ps: 'SHORT', x: 'TRADE' },
    })

    const fill = mockStore.mock.calls[0][0]
    expect(fill.exec_fee).toBe(0.25)  // abs of -0.25
  })
})

// ── Startup gap fill ─────────────────────────────────────────────────────────

describe('BinanceConnector — startup gap fill', () => {
  it('runs gap fill before first connectOnce', async () => {
    const callOrder: string[] = []
    const mockGapFills = jest.fn().mockImplementation(async () => {
      callOrder.push('gapFill')
      return []
    })
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp(), fetchGapFills: mockGapFills })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(conn as any, 'connectOnce')
      .mockImplementation(async () => { callOrder.push('connectOnce'); conn.disconnect() })
    // createListenKey must not throw so the loop proceeds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(conn as any, 'createListenKey')
      .mockResolvedValue('test-key')

    await conn.connect()

    expect(callOrder[0]).toBe('gapFill')
    expect(callOrder[1]).toBe('connectOnce')
  })
})

// ── runGapFill updates lastFillTime ──────────────────────────────────────────

describe('BinanceConnector — runGapFill updates lastFillTime', () => {
  it('advances lastFillTime to max exec_time of fetched fills', async () => {
    const ts = 1735689600000
    const mockFill: RawFill = {
      account_id: 'acc', exchange: 'binance', exec_id: 'x', symbol: 'BTC',
      exec_time: new Date(ts), side: 'buy', exec_qty: 1, exec_price: 50000,
      raw_data: {}, source: 'rest',
    }
    const mockGapFills = jest.fn().mockResolvedValue([mockFill])
    const conn = new BinanceConnector({ ...CREDS, portfolioMargin: false, fillProcessor: makeFp(), fetchGapFills: mockGapFills })
    mockStoreBatch.mockResolvedValue(undefined)

    await conn.runGapFill(0, ts + 1000)

    expect((conn as unknown as { lastFillTime: number }).lastFillTime).toBe(ts)
  })
})
