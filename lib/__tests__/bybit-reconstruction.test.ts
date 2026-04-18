/**
 * Unit tests for reconstructPositions() — Bybit execution-list based position reconstruction.
 *
 * reconstructPositions() is exported from lib/adapters/bybit.ts for testing purposes.
 * It takes raw RawExecution records from /v5/execution/list and emits one Trade per
 * closing fill, with real opened_at (first opening fill) and closed_at (this closing fill).
 */

import { reconstructPositions } from '../adapters/bybit'
import type { RawExecution } from '../adapters/bybit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeExec(overrides: Partial<RawExecution> & { execTime: string; execPrice: string }): RawExecution {
  return {
    execTime:   overrides.execTime,
    symbol:     overrides.symbol   ?? 'BTCUSDT',
    side:       overrides.side     ?? 'Buy',
    execType:   overrides.execType ?? 'Trade',
    execPrice:  overrides.execPrice,
    execQty:    overrides.execQty  ?? '0',
    execPnl:    overrides.execPnl  ?? '0',
    execFee:    overrides.execFee  ?? '0',
    closedSize: overrides.closedSize ?? '0',
    orderId:    overrides.orderId  ?? 'order-1',
  }
}

function makeFunding(overrides: { symbol?: string; execFee: string; execTime: string }): RawExecution {
  return {
    execTime:   overrides.execTime,
    symbol:     overrides.symbol  ?? 'BTCUSDT',
    side:       'Buy',
    execType:   'Funding',
    execPrice:  '0',
    execQty:    '0',
    execPnl:    '0',
    execFee:    overrides.execFee,
    closedSize: '0',
    orderId:    'funding-1',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('reconstructPositions', () => {

  it('simple long: single open + single close → 1 trade', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100', execPnl: '0',    execFee: '0.1' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '99.9', execFee: '0.1' }),
    ]
    const result = reconstructPositions(execs, 'linear')
    expect(result).toHaveLength(1)
    expect(result[0].side).toBe('long')
    expect(result[0].openedAt).toBe(new Date(1000).toISOString())
    expect(result[0].closedAt).toBe(new Date(2000).toISOString())
    expect(result[0].entryPrice).toBe(100)
    expect(result[0].exitPrice).toBe(110)
    expect(result[0].pnl).toBeCloseTo(99.9)
    expect(result[0].quantity).toBe(10)
  })

  it('simple short: single open + single close → 1 trade', () => {
    const execs = [
      makeExec({ side: 'Sell', execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100', execPnl: '0',    execFee: '0.1' }),
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '10', execTime: '2000', execPrice: '90',  execPnl: '99.9', execFee: '0.1' }),
    ]
    const result = reconstructPositions(execs, 'linear')
    expect(result).toHaveLength(1)
    expect(result[0].side).toBe('short')
    expect(result[0].entryPrice).toBe(100)
    expect(result[0].exitPrice).toBe(90)
    expect(result[0].openedAt).toBe(new Date(1000).toISOString())
    expect(result[0].closedAt).toBe(new Date(2000).toISOString())
  })

  it('scale-in (multiple opens): weighted avg entry price', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1500', execPrice: '120' }),
      makeExec({ side: 'Sell', execQty: '20', closedSize: '20', execTime: '2000', execPrice: '130', execPnl: '600' }),
    ]
    const result = reconstructPositions(execs, 'linear')
    expect(result).toHaveLength(1)
    expect(result[0].entryPrice).toBe(110)                               // (100×10 + 120×10) / 20
    expect(result[0].openedAt).toBe(new Date(1000).toISOString())        // first fill
  })

  it('scale-out (partial closes): emits 2 trades, both with same openedAt', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '20', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '3000', execPrice: '120', execPnl: '200' }),
    ]
    const result = reconstructPositions(execs, 'linear')
    expect(result).toHaveLength(2)
    expect(result[0].openedAt).toBe(result[1].openedAt)                  // both reference T=1000
    expect(result[0].closedAt).toBe(new Date(2000).toISOString())
    expect(result[1].closedAt).toBe(new Date(3000).toISOString())
    expect(result[0].quantity).toBe(10)
    expect(result[1].quantity).toBe(10)
  })

  it('two sequential positions on same symbol: different openedAt', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100' }),
      // second position
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '3000', execPrice: '115' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '4000', execPrice: '120', execPnl: '50'  }),
    ]
    const result = reconstructPositions(execs, 'linear')
    expect(result).toHaveLength(2)
    expect(result[0].openedAt).toBe(new Date(1000).toISOString())
    expect(result[1].openedAt).toBe(new Date(3000).toISOString())
  })

  it('empty executions → empty result', () => {
    expect(reconstructPositions([], 'linear')).toEqual([])
  })

  it('only opening fills (no closes yet) → empty result', () => {
    const execs = [
      makeExec({ side: 'Buy', execQty: '10', closedSize: '0', execTime: '1000', execPrice: '100' }),
    ]
    expect(reconstructPositions(execs, 'linear')).toHaveLength(0)
  })

  it('inverse: execPnl is in base currency → converted to USDT via execPrice', () => {
    const basePnl = 0.000131579  // BTC
    const exitPrice = 38000
    const execs = [
      makeExec({ side: 'Sell', execQty: '100', closedSize: '0',   execTime: '1000', execPrice: '40000' }),
      makeExec({ side: 'Buy',  execQty: '100', closedSize: '100', execTime: '2000', execPrice: String(exitPrice), execPnl: String(basePnl) }),
    ]
    const result = reconstructPositions(execs, 'inverse')
    expect(result).toHaveLength(1)
    expect(result[0].pnl).toBeCloseTo(basePnl * exitPrice, 2)
  })

  it('funding distribution: proportional across partial closes by closedSize', () => {
    const tradeExecs = [
      makeExec({ side: 'Buy',  execQty: '20', closedSize: '0',  execTime: '1000', execPrice: '100', execFee: '0.1' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100', execFee: '0.1' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '3000', execPrice: '120', execPnl: '200', execFee: '0.1' }),
    ]
    const fundingExecs = [
      makeFunding({ execFee: '-5', execTime: '1500' }),  // funding income −5 USDT
    ]
    const result = reconstructPositions([...tradeExecs, ...fundingExecs], 'linear')
    expect(result).toHaveLength(2)
    // Funding −5 split evenly: each close gets −2.5 funding
    expect(result[0].fee).toBeCloseTo(0.1 + (-5 * 0.5), 5)
    expect(result[1].fee).toBeCloseTo(0.1 + (-5 * 0.5), 5)
  })

  it('position flip (close + open opposite direction in same fill): emits 1 closed trade', () => {
    // Buy 10 → open long; then Sell 20 (closedSize=10, opens new short of 10)
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '20', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100' }),
    ]
    const result = reconstructPositions(execs, 'linear')
    expect(result).toHaveLength(1)                          // only the closed long emitted
    expect(result[0].side).toBe('long')
    expect(result[0].quantity).toBe(10)
  })

  it('side: Buy-to-open → trade.side = long', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '5', closedSize: '0', execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '5', closedSize: '5', execTime: '2000', execPrice: '105', execPnl: '25' }),
    ]
    expect(reconstructPositions(execs, 'linear')[0].side).toBe('long')
  })

  it('side: Sell-to-open → trade.side = short', () => {
    const execs = [
      makeExec({ side: 'Sell', execQty: '5', closedSize: '0', execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Buy',  execQty: '5', closedSize: '5', execTime: '2000', execPrice: '95', execPnl: '25' }),
    ]
    expect(reconstructPositions(execs, 'linear')[0].side).toBe('short')
  })

  it('multiple symbols: reconstructed independently', () => {
    const execs = [
      makeExec({ symbol: 'BTCUSDT', side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100' }),
      makeExec({ symbol: 'ETHUSDT', side: 'Sell', execQty: '5', closedSize: '0', execTime: '1001', execPrice: '200' }),
      makeExec({ symbol: 'BTCUSDT', side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10' }),
      makeExec({ symbol: 'ETHUSDT', side: 'Buy',  execQty: '5', closedSize: '5', execTime: '2001', execPrice: '180', execPnl: '100' }),
    ]
    const result = reconstructPositions(execs, 'linear')
    expect(result).toHaveLength(2)
    const btc = result.find(t => t.symbol.startsWith('BTC'))
    const eth = result.find(t => t.symbol.startsWith('ETH'))
    expect(btc?.side).toBe('long')
    expect(eth?.side).toBe('short')
  })

  it('tradeType is always futures', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10' }),
    ]
    expect(reconstructPositions(execs, 'linear')[0].tradeType).toBe('futures')
  })

  it('fee includes execFee from the closing fill', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100', execFee: '0' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10', execFee: '0.05' }),
    ]
    const result = reconstructPositions(execs, 'linear')
    expect(result[0].fee).toBeCloseTo(0.05)
  })

  it('pnl=0 for opening fills only — no trade emitted', () => {
    // Only opening fills, no closes → nothing to emit
    const execs = [
      makeExec({ side: 'Buy', execQty: '5', closedSize: '0', execTime: '1000', execPrice: '100', execPnl: '0' }),
      makeExec({ side: 'Buy', execQty: '5', closedSize: '0', execTime: '1500', execPrice: '105', execPnl: '0' }),
    ]
    expect(reconstructPositions(execs, 'linear')).toHaveLength(0)
  })
})
