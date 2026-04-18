/**
 * BybitAdapter — execution-list based trade fetching tests.
 *
 * Covers:
 *  - getTrades calls privateGetV5ExecutionList for both linear and inverse
 *  - Pagination: follows nextPageCursor until empty
 *  - Spot trades still use fetchMyTrades
 *  - reconstructPositions is tested separately in lib/__tests__/bybit-reconstruction.test.ts
 */

import { BybitAdapter } from '../bybit'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildAdapter() {
  const adapter = new BybitAdapter({ apiKey: 'k', apiSecret: 's' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ex = (adapter as any).exchange as Record<string, unknown>

  const fns = {
    privateGetV5ExecutionList: jest.fn(),
    fetchMyTrades:  jest.fn().mockResolvedValue([]),
    fetchBalance:   jest.fn().mockResolvedValue({ total: {} }),
    fetchPositions: jest.fn().mockResolvedValue([]),
  }
  Object.assign(ex, fns)
  return { adapter, fns }
}

function emptyExecResponse(category?: string) {
  return (_params: Record<string, unknown>) =>
    Promise.resolve({ result: { list: [], nextPageCursor: '' } })
}

function singleExecResponse(rows: Array<Record<string, string>>) {
  return (_params: Record<string, unknown>) =>
    Promise.resolve({ result: { list: rows, nextPageCursor: '' } })
}

function makeOpeningExec(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    execTime:   '1000000',
    symbol:     'BTCUSDT',
    side:       'Buy',
    execType:   'Trade',
    execPrice:  '50000',
    execQty:    '0.1',
    execPnl:    '0',
    execFee:    '0.1',
    closedSize: '0',
    orderId:    'ord-open',
    ...overrides,
  }
}

function makeClosingExec(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    execTime:   '2000000',
    symbol:     'BTCUSDT',
    side:       'Sell',
    execType:   'Trade',
    execPrice:  '51000',
    execQty:    '0.1',
    execPnl:    '95',
    execFee:    '0.1',
    closedSize: '0.1',
    orderId:    'ord-close',
    ...overrides,
  }
}

// ─── Routing ──────────────────────────────────────────────────────────────────

describe('BybitAdapter getTrades routing', () => {
  it('calls privateGetV5ExecutionList for both linear and inverse categories', async () => {
    const { adapter, fns } = buildAdapter()
    fns.privateGetV5ExecutionList.mockImplementation(emptyExecResponse())

    await adapter.getTrades('acc', { start: '', end: '' })

    const categories = fns.privateGetV5ExecutionList.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>).category
    )
    expect(categories).toContain('linear')
    expect(categories).toContain('inverse')
  })

  it('still calls fetchMyTrades for spot', async () => {
    const { adapter, fns } = buildAdapter()
    fns.privateGetV5ExecutionList.mockImplementation(emptyExecResponse())

    await adapter.getTrades('acc', { start: '', end: '' })

    expect(fns.fetchMyTrades).toHaveBeenCalledWith(
      undefined, undefined, 100, expect.objectContaining({ category: 'spot' })
    )
  })

  it('passes since and until as startTime and endTime', async () => {
    const { adapter, fns } = buildAdapter()
    fns.privateGetV5ExecutionList.mockImplementation(emptyExecResponse())

    await adapter.getTrades('acc', { start: '', end: '' }, 1000, 100, 2000)

    const calls = fns.privateGetV5ExecutionList.mock.calls as Array<[Record<string, unknown>]>
    for (const [params] of calls) {
      expect(params.startTime).toBe(1000)
      expect(params.endTime).toBe(2000)
    }
  })
})

// ─── Pagination ───────────────────────────────────────────────────────────────

describe('BybitAdapter fetchBybitExecutions pagination', () => {
  it('follows nextPageCursor until empty', async () => {
    const { adapter, fns } = buildAdapter()

    let callCount = 0
    fns.privateGetV5ExecutionList.mockImplementation(
      (params: Record<string, unknown>) => {
        if (params.category !== 'linear') {
          return Promise.resolve({ result: { list: [], nextPageCursor: '' } })
        }
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            result: { list: [makeOpeningExec()], nextPageCursor: 'cursor-page-2' },
          })
        }
        return Promise.resolve({
          result: { list: [makeClosingExec()], nextPageCursor: '' },
        })
      }
    )

    const trades = await adapter.getTrades('acc', { start: '', end: '' })

    // Should have followed the cursor and fetched page 2
    const linearCalls = fns.privateGetV5ExecutionList.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown>).category === 'linear'
    )
    expect(linearCalls.length).toBe(2)
    expect((linearCalls[1][0] as Record<string, unknown>).cursor).toBe('cursor-page-2')

    // One completed round-trip position → 1 futures trade
    const futures = trades.filter(t => t.tradeType === 'futures')
    expect(futures).toHaveLength(1)
  })
})

// ─── End-to-end: executions → Trade ──────────────────────────────────────────

describe('BybitAdapter getTrades executions → Trade mapping', () => {
  it('linear long: correct side, entryPrice, exitPrice, pnl', async () => {
    const { adapter, fns } = buildAdapter()
    fns.privateGetV5ExecutionList.mockImplementation(
      (params: Record<string, unknown>) =>
        params.category === 'linear'
          ? singleExecResponse([makeOpeningExec(), makeClosingExec()])(params)
          : emptyExecResponse()(params)
    )

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find(t => t.tradeType === 'futures')!

    expect(t.side).toBe('long')
    expect(t.entryPrice).toBe(50000)
    expect(t.exitPrice).toBe(51000)
    expect(t.pnl).toBeCloseTo(95)
    expect(t.quantity).toBe(0.1)
  })

  it('linear short: side=short when opened with Sell', async () => {
    const { adapter, fns } = buildAdapter()
    fns.privateGetV5ExecutionList.mockImplementation(
      (params: Record<string, unknown>) =>
        params.category === 'linear'
          ? singleExecResponse([
              makeOpeningExec({ side: 'Sell', closedSize: '0' }),
              makeClosingExec({ side: 'Buy', execPrice: '49000', execPnl: '95' }),
            ])(params)
          : emptyExecResponse()(params)
    )

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    expect(trades.find(t => t.tradeType === 'futures')?.side).toBe('short')
  })

  it('inverse: pnl converted from base currency to USDT', async () => {
    const basePnl   = '0.000131579'
    const exitPrice = '38000'
    const { adapter, fns } = buildAdapter()
    fns.privateGetV5ExecutionList.mockImplementation(
      (params: Record<string, unknown>) =>
        params.category === 'inverse'
          ? singleExecResponse([
              makeOpeningExec({ symbol: 'BTCUSD', side: 'Sell', execPrice: '40000', closedSize: '0' }),
              makeClosingExec({ symbol: 'BTCUSD', side: 'Buy',  execPrice: exitPrice, execPnl: basePnl }),
            ])(params)
          : emptyExecResponse()(params)
    )

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find(t => t.tradeType === 'futures')!
    expect(t.pnl).toBeCloseTo(Number(basePnl) * Number(exitPrice), 2)
  })

  it('openedAt is earlier than closedAt', async () => {
    const { adapter, fns } = buildAdapter()
    fns.privateGetV5ExecutionList.mockImplementation(
      (params: Record<string, unknown>) =>
        params.category === 'linear'
          ? singleExecResponse([makeOpeningExec({ execTime: '1000000' }), makeClosingExec({ execTime: '9000000' })])(params)
          : emptyExecResponse()(params)
    )

    const trades = await adapter.getTrades('acc', { start: '', end: '' })
    const t = trades.find(t => t.tradeType === 'futures')!
    expect(new Date(t.openedAt).getTime()).toBeLessThan(new Date(t.closedAt).getTime())
  })
})
