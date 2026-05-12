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
  it('calls papiGetUmIncome + papiGetCmIncome when PM=true (single paginated fetch)', async () => {
    const { adapter, fns } = buildAdapter(true)
    // Returns < 1000 rows → no pagination needed → exactly 1 call per endpoint
    fns.papiGetUmIncome.mockResolvedValue([makeIncome('BTCUSDT')])
    fns.papiGetCmIncome.mockResolvedValue([makeIncome('BTCUSD_PERP')])

    const result = await adapter.discoverTradedSymbols()

    // Exactly 1 call per endpoint (not 26 or 180)
    expect(fns.papiGetUmIncome).toHaveBeenCalledTimes(1)
    expect(fns.papiGetCmIncome).toHaveBeenCalledTimes(1)
    expect(fns.fapiPrivateGetIncome).not.toHaveBeenCalled()
    expect(result.map((r) => r.rawSymbol)).toEqual(expect.arrayContaining(['BTCUSDT', 'BTCUSD_PERP']))
  })

  it('paginates UM income when first page returns exactly 1000 rows (PM=true)', async () => {
    const { adapter, fns } = buildAdapter(true)
    const page1 = Array.from({ length: 1000 }, (_, i) => makeIncome('BTCUSDT', Date.now() - 1000 + i))
    const page2 = [makeIncome('ETHUSDT', Date.now())]
    fns.papiGetUmIncome
      .mockResolvedValueOnce(page1)  // first page — exactly 1000 → need next
      .mockResolvedValueOnce(page2)  // second page — < 1000 → stop
    fns.papiGetCmIncome.mockResolvedValue([])

    const result = await adapter.discoverTradedSymbols()

    expect(fns.papiGetUmIncome).toHaveBeenCalledTimes(2)
    expect(result.map((r) => r.rawSymbol)).toContain('ETHUSDT')
  })

  it('calls fapiPrivateGetIncome when PM=false', async () => {
    const { adapter, fns } = buildAdapter(false)
    fns.fapiPrivateGetIncome.mockResolvedValue([makeIncome('ETHUSDT')])

    const result = await adapter.discoverTradedSymbols()

    // 6 × 30-day windows replace the old single 180-day call
    expect(fns.fapiPrivateGetIncome).toHaveBeenCalledTimes(6)
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
    // Complete position (open + close) required for reconstructBinanceTrades to emit a trade
    fns.papiGetUmUserTrades.mockResolvedValue([
      makeFill({ symbol: 'BTCUSDT', id: 0, side: 'BUY',  realizedPnl: '0',   time: Date.now() - 2000 }),
      makeFill({ symbol: 'BTCUSDT', id: 1, side: 'SELL', realizedPnl: '100', time: Date.now() - 1000 }),
    ])

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
    // Quick sync uses mapRawFapiTrade; pnl must be non-zero to emit a trade
    fns.papiGetUmUserTrades.mockResolvedValue([makeFill({ id: 10, realizedPnl: '100' })])

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
    // Quick sync uses mapRawFapiTrade; pnl must be non-zero to emit a trade
    fns.fapiPrivateGetUserTrades.mockResolvedValue([makeFill({ symbol: 'ETHUSDT', id: 20, realizedPnl: '100' })])

    const trades = await adapter.getTrades('acc', { start: '', end: '' })

    expect(fns.fapiPrivateGetIncome).toHaveBeenCalledTimes(1)
    expect(fns.papiGetUmIncome).not.toHaveBeenCalled()
    expect(trades).toHaveLength(1)
  })
})

// ─── fetchBalance() — PM equity ───────────────────────────────────────────────

function mockFetchBalance(
  ex: Record<string, unknown>,
  info: Array<{
    asset: string
    totalWalletBalance: string
    umUnrealizedPNL?: string
    cmUnrealizedPNL?: string
    [k: string]: unknown
  }>,
) {
  ex.fetchBalance = jest.fn().mockResolvedValue({ total: {}, free: {}, info })
}

describe('BinanceAdapter.fetchBalance() PM equity', () => {
  it('cross-margin account (Continum): reads totalWalletBalance when umWalletBalance=0', async () => {
    // Continum: all 50k USDT in crossMarginAsset, umWalletBalance=0
    // Current bug: CCXT raw.total['USDT']=0 → fetchPmBalance returns 0
    const { adapter } = buildAdapter(true)
    const ex = (adapter as any).exchange as Record<string, unknown>
    mockFetchBalance(ex, [
      {
        asset: 'USDT',
        totalWalletBalance: '50000.0',
        crossMarginAsset: '50000.0',
        crossMarginFree: '50000.0',
        umWalletBalance: '0.0',
        umUnrealizedPNL: '0.0',
        cmUnrealizedPNL: '0.0',
      },
    ])

    const result = await adapter.fetchBalance()

    expect(result.usdt).toBeCloseTo(50000, 2)
    expect(result.tokens).toEqual({})
  })

  it('UM-only account (DFI): totalWalletBalance + umUnrealizedPNL', async () => {
    // DFI: umWalletBalance=2506, umUnrealizedPNL=843 → equity=3349
    const { adapter } = buildAdapter(true)
    const ex = (adapter as any).exchange as Record<string, unknown>
    mockFetchBalance(ex, [
      {
        asset: 'USDT',
        totalWalletBalance: '2506.30037185',
        umWalletBalance: '2506.30037185',
        umUnrealizedPNL: '843.41233207',
        cmUnrealizedPNL: '0.0',
      },
    ])

    const result = await adapter.fetchBalance()

    expect(result.usdt).toBeCloseTo(3349.71, 1)
  })

  it('mixed account (Filimonov): totalWalletBalance includes both UM and cross portions', async () => {
    // Filimonov: umWalletBalance=21937, crossMarginAsset=6494, totalWalletBalance=28432
    // Current bug: CCXT only returns umWalletBalance+unrealized=22036, missing cross portion
    const { adapter } = buildAdapter(true)
    const ex = (adapter as any).exchange as Record<string, unknown>
    mockFetchBalance(ex, [
      {
        asset: 'USDT',
        totalWalletBalance: '28432.58087007',
        crossMarginAsset: '6494.85143073',
        umWalletBalance: '21937.72943934',
        umUnrealizedPNL: '98.46490639',
        cmUnrealizedPNL: '0.0',
      },
    ])

    const result = await adapter.fetchBalance()

    // equity = 28432.58 + 98.46 = 28531.04
    expect(result.usdt).toBeCloseTo(28531.04, 1)
  })

  it('non-USDT collateral assets (BTC) appear in tokens', async () => {
    const { adapter } = buildAdapter(true)
    const ex = (adapter as any).exchange as Record<string, unknown>
    mockFetchBalance(ex, [
      {
        asset: 'BTC',
        totalWalletBalance: '1.49510178',
        umUnrealizedPNL: '0.0',
        cmUnrealizedPNL: '0.0',
      },
      {
        asset: 'USDT',
        totalWalletBalance: '1000.0',
        umUnrealizedPNL: '0.0',
        cmUnrealizedPNL: '0.0',
      },
    ])

    const result = await adapter.fetchBalance()

    expect(result.usdt).toBeCloseTo(1000, 2)
    expect(result.tokens['BTC']).toBeCloseTo(1.495, 3)
  })

  it('zero-equity assets are excluded', async () => {
    const { adapter } = buildAdapter(true)
    const ex = (adapter as any).exchange as Record<string, unknown>
    mockFetchBalance(ex, [
      { asset: 'USDT', totalWalletBalance: '5000.0', umUnrealizedPNL: '0.0', cmUnrealizedPNL: '0.0' },
      { asset: 'BNB',  totalWalletBalance: '0.0',    umUnrealizedPNL: '0.0', cmUnrealizedPNL: '0.0' },
    ])

    const result = await adapter.fetchBalance()

    expect(result.tokens['BNB']).toBeUndefined()
  })

  it('falls back to raw.total when info array is empty', async () => {
    const { adapter } = buildAdapter(true)
    const ex = (adapter as any).exchange as Record<string, unknown>
    ex.fetchBalance = jest.fn().mockResolvedValue({
      total: { USDT: 9999 },
      free:  { USDT: 9999 },
      info:  [],
    })

    const result = await adapter.fetchBalance()

    expect(result.usdt).toBe(9999)
  })
})
