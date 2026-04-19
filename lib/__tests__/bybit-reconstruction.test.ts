/**
 * Unit tests for reconstructPositions() — Bybit execution-list based position reconstruction.
 *
 * reconstructPositions() is exported from lib/adapters/bybit.ts for testing purposes.
 * It takes raw RawExecution records from /v5/execution/list and emits one Trade per
 * closing fill, with real opened_at (first opening fill) and closed_at (this closing fill).
 *
 * Return type: { trades: Trade[], finalState: ReconstructionStateJson }
 * finalState carries open positions to the next chunk (stateful cross-chunk reconstruction).
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
    // Use 'execPnl' in overrides check so that explicit undefined passes through (simulates absent field)
    execPnl:    'execPnl' in overrides ? overrides.execPnl as string : '0',
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
// Core reconstruction tests
// ---------------------------------------------------------------------------
describe('reconstructPositions', () => {

  it('simple long: single open + single close → 1 trade', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100', execPnl: '0',    execFee: '0.1' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '99.9', execFee: '0.1' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('long')
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())
    expect(trades[0].closedAt).toBe(new Date(2000).toISOString())
    expect(trades[0].entryPrice).toBe(100)
    expect(trades[0].exitPrice).toBe(110)
    expect(trades[0].pnl).toBeCloseTo(99.9)
    expect(trades[0].quantity).toBe(10)
  })

  it('simple short: single open + single close → 1 trade', () => {
    const execs = [
      makeExec({ side: 'Sell', execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100', execPnl: '0',    execFee: '0.1' }),
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '10', execTime: '2000', execPrice: '90',  execPnl: '99.9', execFee: '0.1' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('short')
    expect(trades[0].entryPrice).toBe(100)
    expect(trades[0].exitPrice).toBe(90)
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())
    expect(trades[0].closedAt).toBe(new Date(2000).toISOString())
  })

  it('scale-in (multiple opens): weighted avg entry price', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1500', execPrice: '120' }),
      makeExec({ side: 'Sell', execQty: '20', closedSize: '20', execTime: '2000', execPrice: '130', execPnl: '600' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(1)
    expect(trades[0].entryPrice).toBe(110)                               // (100×10 + 120×10) / 20
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())        // first fill
  })

  it('scale-out (partial closes): emits 2 trades, both with same openedAt', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '20', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '3000', execPrice: '120', execPnl: '200' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(2)
    expect(trades[0].openedAt).toBe(trades[1].openedAt)                  // both reference T=1000
    expect(trades[0].closedAt).toBe(new Date(2000).toISOString())
    expect(trades[1].closedAt).toBe(new Date(3000).toISOString())
    expect(trades[0].quantity).toBe(10)
    expect(trades[1].quantity).toBe(10)
  })

  it('two sequential positions on same symbol: different openedAt', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100' }),
      // second position
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '3000', execPrice: '115' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '4000', execPrice: '120', execPnl: '50'  }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(2)
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())
    expect(trades[1].openedAt).toBe(new Date(3000).toISOString())
  })

  it('empty executions → empty result', () => {
    const { trades } = reconstructPositions([], 'linear')
    expect(trades).toEqual([])
  })

  it('only opening fills (no closes yet) → empty result', () => {
    const execs = [
      makeExec({ side: 'Buy', execQty: '10', closedSize: '0', execTime: '1000', execPrice: '100' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(0)
  })

  it('inverse: execPnl is in base currency → converted to USDT via execPrice', () => {
    const basePnl = 0.000131579  // BTC
    const exitPrice = 38000
    const execs = [
      makeExec({ side: 'Sell', execQty: '100', closedSize: '0',   execTime: '1000', execPrice: '40000' }),
      makeExec({ side: 'Buy',  execQty: '100', closedSize: '100', execTime: '2000', execPrice: String(exitPrice), execPnl: String(basePnl) }),
    ]
    const { trades } = reconstructPositions(execs, 'inverse')
    expect(trades).toHaveLength(1)
    expect(trades[0].pnl).toBeCloseTo(basePnl * exitPrice, 2)
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
    const { trades } = reconstructPositions([...tradeExecs, ...fundingExecs], 'linear')
    expect(trades).toHaveLength(2)
    // Funding −5 split evenly: each close gets −2.5 funding
    expect(trades[0].fee).toBeCloseTo(0.1 + (-5 * 0.5), 5)
    expect(trades[1].fee).toBeCloseTo(0.1 + (-5 * 0.5), 5)
  })

  it('position flip (long→short in same fill): closes long, opens short', () => {
    // Fill with execQty=20, closedSize=10: closes 10 long + opens 10 short simultaneously.
    // quantity of emitted trade = closedSize (10), not execQty (20).
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '20', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100' }),
    ]
    const { trades, finalState } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('long')
    expect(trades[0].quantity).toBe(10)               // closedSize — not execQty
    // The remaining 10 starts a new short (not closed yet → finalState carries it)
    expect(finalState['BTCUSDT']?.size).toBe(10)
    expect(finalState['BTCUSDT']?.openSide).toBe('short')
  })

  it('side: Buy-to-open → trade.side = long', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '5', closedSize: '0', execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '5', closedSize: '5', execTime: '2000', execPrice: '105', execPnl: '25' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades[0].side).toBe('long')
  })

  it('side: Sell-to-open → trade.side = short', () => {
    const execs = [
      makeExec({ side: 'Sell', execQty: '5', closedSize: '0', execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Buy',  execQty: '5', closedSize: '5', execTime: '2000', execPrice: '95', execPnl: '25' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades[0].side).toBe('short')
  })

  it('multiple symbols: reconstructed independently', () => {
    const execs = [
      makeExec({ symbol: 'BTCUSDT', side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100' }),
      makeExec({ symbol: 'ETHUSDT', side: 'Sell', execQty: '5', closedSize: '0', execTime: '1001', execPrice: '200' }),
      makeExec({ symbol: 'BTCUSDT', side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10' }),
      makeExec({ symbol: 'ETHUSDT', side: 'Buy',  execQty: '5', closedSize: '5', execTime: '2001', execPrice: '180', execPnl: '100' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(2)
    const btc = trades.find(t => t.symbol.startsWith('BTC'))
    const eth = trades.find(t => t.symbol.startsWith('ETH'))
    expect(btc?.side).toBe('long')
    expect(eth?.side).toBe('short')
  })

  it('tradeType is always futures', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades[0].tradeType).toBe('futures')
  })

  it('fee includes execFee from the closing fill', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100', execFee: '0' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10', execFee: '0.05' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades[0].fee).toBeCloseTo(0.05)
  })

  it('pnl=0 for opening fills only — no trade emitted', () => {
    const execs = [
      makeExec({ side: 'Buy', execQty: '5', closedSize: '0', execTime: '1000', execPrice: '100', execPnl: '0' }),
      makeExec({ side: 'Buy', execQty: '5', closedSize: '0', execTime: '1500', execPrice: '105', execPnl: '0' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// finalState tests
// ---------------------------------------------------------------------------
describe('reconstructPositions — finalState', () => {

  it('closed position not in finalState', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100' }),
    ]
    const { finalState } = reconstructPositions(execs, 'linear')
    expect(finalState['BTCUSDT']).toBeUndefined()
  })

  it('open position preserved in finalState', () => {
    const execs = [
      makeExec({ side: 'Buy', execQty: '10', closedSize: '0', execTime: '1000', execPrice: '100' }),
    ]
    const { finalState } = reconstructPositions(execs, 'linear')
    expect(finalState['BTCUSDT']).toBeDefined()
    expect(finalState['BTCUSDT'].size).toBe(10)
    expect(finalState['BTCUSDT'].avgEntry).toBe(100)
    expect(finalState['BTCUSDT'].openSide).toBe('long')
  })

  it('empty executions → empty finalState', () => {
    const { finalState } = reconstructPositions([], 'linear')
    expect(Object.keys(finalState)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Stateful cross-chunk reconstruction
// ---------------------------------------------------------------------------
describe('reconstructPositions — stateful cross-chunk', () => {

  it('position opened in chunk 1, closed in chunk 2 — openedAt and entryPrice from chunk 1', () => {
    // Chunk 1: opening fill only
    const chunk1 = [
      makeExec({ side: 'Buy', execQty: '10', closedSize: '0', execTime: '1000', execPrice: '100' }),
    ]
    const { trades: trades1, finalState } = reconstructPositions(chunk1, 'linear')
    expect(trades1).toHaveLength(0)
    expect(finalState['BTCUSDT'].size).toBe(10)
    expect(finalState['BTCUSDT'].avgEntry).toBe(100)
    expect(finalState['BTCUSDT'].openTime).toBe(new Date(1000).toISOString())

    // Chunk 2: closing fill, inheriting state from chunk 1
    const chunk2 = [
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: undefined }),
    ]
    const { trades: trades2, finalState: state2 } = reconstructPositions(chunk2, 'linear', finalState)
    expect(trades2).toHaveLength(1)
    expect(trades2[0].entryPrice).toBe(100)                               // from chunk 1 state
    expect(trades2[0].openedAt).toBe(new Date(1000).toISOString())        // from chunk 1 state
    expect(trades2[0].pnl).toBeCloseTo(100)                               // (110−100) × 10
    expect(trades2[0].quantity).toBe(10)
    // Position fully closed — not in finalState
    expect(state2['BTCUSDT']).toBeUndefined()
  })

  it('inherited state with no fills this chunk → state preserved unchanged', () => {
    const chunk1 = [
      makeExec({ symbol: 'BTCUSDT', side: 'Buy', execQty: '5', closedSize: '0', execTime: '1000', execPrice: '200' }),
    ]
    const { finalState } = reconstructPositions(chunk1, 'linear')

    // Chunk 2 has fills for a different symbol — BTC state should be preserved
    const chunk2 = [
      makeExec({ symbol: 'ETHUSDT', side: 'Buy', execQty: '10', closedSize: '0', execTime: '2000', execPrice: '3000' }),
    ]
    const { trades, finalState: state2 } = reconstructPositions(chunk2, 'linear', finalState)
    expect(trades).toHaveLength(0)
    expect(state2['BTCUSDT']?.size).toBe(5)       // preserved from chunk 1
    expect(state2['ETHUSDT']?.size).toBe(10)       // new from chunk 2
  })

  it('scale-in across chunks: avgEntry is cumulative weighted average', () => {
    // Chunk 1: buy 10 @ 100
    const chunk1 = [
      makeExec({ side: 'Buy', execQty: '10', closedSize: '0', execTime: '1000', execPrice: '100' }),
    ]
    const { finalState } = reconstructPositions(chunk1, 'linear')

    // Chunk 2: buy 10 more @ 120, then close all 20
    const chunk2 = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '2000', execPrice: '120' }),
      makeExec({ side: 'Sell', execQty: '20', closedSize: '20', execTime: '3000', execPrice: '130' }),
    ]
    const { trades } = reconstructPositions(chunk2, 'linear', finalState)
    expect(trades).toHaveLength(1)
    expect(trades[0].entryPrice).toBe(110)         // (100×10 + 120×10) / 20
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())  // from chunk 1
  })

  it('position opened before 180d window (no chunk data): openedAt stays empty string', () => {
    // Simulates a position whose opening fill is not in any chunk window.
    // finalState passed in has openTime='' (unknown).
    const inheritedState = {
      BTCUSDT: { size: 10, avgEntry: 95, openTime: '', openSide: 'long' },
    }
    const chunk = [
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110' }),
    ]
    const { trades } = reconstructPositions(chunk, 'linear', inheritedState)
    expect(trades).toHaveLength(1)
    // openedAt is '' — the sync route filters these out (openedAt unknown)
    expect(trades[0].openedAt).toBe('')
  })

  it('no initial state (first chunk) → same result as passing empty state', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '5', closedSize: '0', execTime: '1000', execPrice: '200' }),
      makeExec({ side: 'Sell', execQty: '5', closedSize: '5', execTime: '2000', execPrice: '210', execPnl: '50' }),
    ]
    const { trades: tradesA } = reconstructPositions(execs, 'linear')
    const { trades: tradesB } = reconstructPositions(execs, 'linear', {})
    expect(tradesA).toHaveLength(1)
    expect(tradesB).toHaveLength(1)
    expect(tradesA[0].pnl).toBeCloseTo(tradesB[0].pnl)
  })
})
