/**
 * BinanceAdapter — Portfolio Margin (PAPI) unit tests
 *
 * These tests verify that when portfolioMargin=true, all FAPI direct calls
 * are routed to the correct PAPI endpoints (papiGetUm-x/papiGetCm-x).
 */

import { BinanceAdapter } from '../binance'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIncome(symbol: string, time = Date.now()) {
  return { symbol, time, income: '10', incomeType: 'REALIZED_PNL', asset: 'USDT', info: '', tranId: '1', tradeId: '1' }
}

function makeFill(overrides: Partial<{
  symbol: string; side: string; price: string; qty: string
  realizedPnl: string; commission: string; commissionAsset: string
  time: number; positionSide: string; orderId: number; id: number
}> = {}) {
  return {
    symbol: 'BTCUSDT', side: 'BUY', price: '50000', qty: '0.01',
    realizedPnl: '0', commission: '0.05', commissionAsset: 'USDT',
    time: Date.now(), positionSide: 'BOTH', orderId: 1, id: 1,
    ...overrides,
  }
}

function makeRawPmPosition(overrides: Partial<{
  symbol: string; positionAmt: string; entryPrice: string; markPrice: string
  unRealizedProfit: string; liquidationPrice: string; leverage: string
  notionalValue: string; initialMargin: string; positionSide: string; updateTime: number
}> = {}) {
  return {
    symbol: 'BTCUSDT', positionAmt: '0.5', entryPrice: '50000', markPrice: '51000',
    unRealizedProfit: '500', liquidationPrice: '40000', leverage: '10',
    notionalValue: '25500', initialMargin: '2550', positionSide: 'BOTH',
    updateTime: Date.now(),
    ...overrides,
  }
}

/** Build a BinanceAdapter and inject mock PAPI/FAPI methods onto its private exchange instance. */
function buildAdapter(portfolioMargin: boolean) {
  const adapter = new BinanceAdapter({ apiKey: 'k', apiSecret: 's', portfolioMargin })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ex = (adapter as any).exchange as Record<string, unknown>

  const fns = {
    fapiPrivateGetIncome:     jest.fn().mockResolvedValue([]),
    fapiPrivateGetUserTrades: jest.fn().mockResolvedValue([]),
    papiGetUmIncome:          jest.fn().mockResolvedValue([]),
    papiGetCmIncome:          jest.fn().mockResolvedValue([]),
    papiGetUmUserTrades:      jest.fn().mockResolvedValue([]),
    papiGetCmUserTrades:      jest.fn().mockResolvedValue([]),
    papiGetUmPositionRisk:    jest.fn().mockResolvedValue([]),
    papiGetCmPositionRisk:    jest.fn().mockResolvedValue([]),
  }

  Object.assign(ex, fns)
  return { adapter, fns }
}

// ─── discoverTradedSymbols() ──────────────────────────────────────────────────

describe('BinanceAdapter.discoverTradedSymbols()', () => {
  it('calls papiGetUmIncome + papiGetCmIncome when PM=true', async () => {
    const { adapter, fns } = buildAdapter(true)
    fns.papiGetUmIncome.mockResolvedValue([makeIncome('BTCUSDT')])
    fns.papiGetCmIncome.mockResolvedValue([makeIncome('BTCUSD_PERP')])

    const result = await adapter.discoverTradedSymbols()

    // 180 daily windows × 2 (UM + CM) = 360 calls total
    expect(fns.papiGetUmIncome).toHaveBeenCalledTimes(180)
    expect(fns.papiGetCmIncome).toHaveBeenCalledTimes(180)
    expect(fns.fapiPrivateGetIncome).not.toHaveBeenCalled()
    expect(result.map((r) => r.rawSymbol)).toEqual(expect.arrayContaining(['BTCUSDT', 'BTCUSD_PERP']))
  })

  it('calls fapiPrivateGetIncome when PM=false', async () => {
    const { adapter, fns } = buildAdapter(false)
    fns.fapiPrivateGetIncome.mockResolvedValue([makeIncome('ETHUSDT')])

    const result = await adapter.discoverTradedSymbols()

    expect(fns.fapiPrivateGetIncome).toHaveBeenCalledTimes(1)
    expect(fns.papiGetUmIncome).not.toHaveBeenCalled()
    expect(fns.papiGetCmIncome).not.toHaveBeenCalled()
    expect(result[0].rawSymbol).toBe('ETHUSDT')
  })

  it('returns empty array if both UM and CM PAPI calls fail (PM mode)', async () => {
    const { adapter, fns } = buildAdapter(true)
    fns.papiGetUmIncome.mockRejectedValue(new Error('unauthorized'))
    fns.papiGetCmIncome.mockRejectedValue(new Error('unauthorized'))

    const result = await adapter.discoverTradedSymbols()
    expect(result).toEqual([])
  })
})

// ─── getFullTrades() ──────────────────────────────────────────────────────────

describe('BinanceAdapter.getFullTrades()', () => {
  it('uses papiGetUmUserTrades for USDT-M symbol when PM=true', async () => {
    const { adapter, fns } = buildAdapter(true)
    fns.papiGetUmUserTrades.mockResolvedValue([makeFill({ symbol: 'BTCUSDT', id: 1 })])

    const result = await adapter.getFullTrades('BTCUSDT', [0])

    expect(fns.papiGetUmUserTrades).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTCUSDT' }))
    expect(fns.papiGetCmUserTrades).not.toHaveBeenCalled()
    expect(fns.fapiPrivateGetUserTrades).not.toHaveBeenCalled()
    expect(result.trades).toHaveLength(1)
  })

  it('uses papiGetCmUserTrades for Coin-M symbol when PM=true', async () => {
    const { adapter, fns } = buildAdapter(true)
    fns.papiGetCmUserTrades.mockResolvedValue([makeFill({ symbol: 'BTCUSD_PERP', id: 2 })])

    await adapter.getFullTrades('BTCUSD_PERP', [0])

    expect(fns.papiGetCmUserTrades).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTCUSD_PERP' }))
    expect(fns.papiGetUmUserTrades).not.toHaveBeenCalled()
  })

  it('uses fapiPrivateGetUserTrades when PM=false', async () => {
    const { adapter, fns } = buildAdapter(false)
    fns.fapiPrivateGetUserTrades.mockResolvedValue([makeFill({ id: 3 })])

    await adapter.getFullTrades('BTCUSDT', [0])

    expect(fns.fapiPrivateGetUserTrades).toHaveBeenCalledTimes(1)
    expect(fns.papiGetUmUserTrades).not.toHaveBeenCalled()
  })

  it('queries each provided weekIndex window', async () => {
    const { adapter, fns } = buildAdapter(false)
    fns.fapiPrivateGetUserTrades.mockResolvedValue([])

    await adapter.getFullTrades('ETHUSDT', [0, 5, 12])

    expect(fns.fapiPrivateGetUserTrades).toHaveBeenCalledTimes(3)
  })
})

// ─── fetchPositions() ─────────────────────────────────────────────────────────

describe('BinanceAdapter.fetchPositions()', () => {
  it('fetches both UM and CM positions when PM=true', async () => {
    const { adapter, fns } = buildAdapter(true)
    fns.papiGetUmPositionRisk.mockResolvedValue([makeRawPmPosition({ symbol: 'BTCUSDT', positionAmt: '0.5' })])
    fns.papiGetCmPositionRisk.mockResolvedValue([makeRawPmPosition({ symbol: 'BTCUSD_PERP', positionAmt: '1' })])

    const result = await adapter.fetchPositions()

    expect(fns.papiGetUmPositionRisk).toHaveBeenCalledTimes(1)
    expect(fns.papiGetCmPositionRisk).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(2)
    expect(result[0].symbol).toBe('BTC/USDT')
    expect(result[1].symbol).toBe('BTC/USD')
  })

  it('returns empty array if both UM and CM PAPI position calls fail (PM mode)', async () => {
    const { adapter, fns } = buildAdapter(true)
    fns.papiGetUmPositionRisk.mockRejectedValue(new Error('timeout'))
    fns.papiGetCmPositionRisk.mockRejectedValue(new Error('timeout'))

    const result = await adapter.fetchPositions()
    expect(result).toEqual([])
  })

  it('filters zero-size positions in PM mode', async () => {
    const { adapter, fns } = buildAdapter(true)
    fns.papiGetUmPositionRisk.mockResolvedValue([
      makeRawPmPosition({ positionAmt: '0' }),        // zero — should be filtered
      makeRawPmPosition({ positionAmt: '0.5' }),      // non-zero — keep
    ])
    fns.papiGetCmPositionRisk.mockResolvedValue([])

    const result = await adapter.fetchPositions()
    expect(result).toHaveLength(1)
    expect(result[0].size).toBe(0.5)
  })
})

// ─── getTrades() (quick sync) ─────────────────────────────────────────────────

describe('BinanceAdapter.getTrades() quick sync', () => {
  it('uses PAPI income + PAPI userTrades when PM=true', async () => {
    const { adapter, fns } = buildAdapter(true)
    fns.papiGetUmIncome.mockResolvedValue([makeIncome('BTCUSDT')])
    fns.papiGetCmIncome.mockResolvedValue([])
    fns.papiGetUmUserTrades.mockResolvedValue([makeFill({ id: 10 })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' }, Date.now() - 48 * 3600 * 1000)

    expect(fns.papiGetUmIncome).toHaveBeenCalledTimes(1)
    expect(fns.fapiPrivateGetIncome).not.toHaveBeenCalled()
    expect(fns.papiGetUmUserTrades).toHaveBeenCalledTimes(1)
    expect(fns.fapiPrivateGetUserTrades).not.toHaveBeenCalled()
    expect(trades).toHaveLength(1)
  })

  it('uses FAPI income + FAPI userTrades when PM=false', async () => {
    const { adapter, fns } = buildAdapter(false)
    fns.fapiPrivateGetIncome.mockResolvedValue([makeIncome('ETHUSDT')])
    fns.fapiPrivateGetUserTrades.mockResolvedValue([makeFill({ symbol: 'ETHUSDT', id: 20 })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })

    expect(fns.fapiPrivateGetIncome).toHaveBeenCalledTimes(1)
    expect(fns.papiGetUmIncome).not.toHaveBeenCalled()
    expect(trades).toHaveLength(1)
  })
})
