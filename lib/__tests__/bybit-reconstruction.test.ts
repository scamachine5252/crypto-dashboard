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
    execTime:     overrides.execTime,
    symbol:       overrides.symbol      ?? 'BTCUSDT',
    side:         overrides.side        ?? 'Buy',
    execType:     overrides.execType    ?? 'Trade',
    execPrice:    overrides.execPrice,
    execQty:      overrides.execQty     ?? '0',
    // Use 'execPnl' in overrides check so that explicit undefined passes through (simulates absent field)
    execPnl:      'execPnl' in overrides ? overrides.execPnl as string : '0',
    execFee:      overrides.execFee     ?? '0',
    closedSize:   overrides.closedSize  ?? '0',
    orderId:      overrides.orderId     ?? 'order-1',
    positionIdx:  overrides.positionIdx,  // undefined = one-way; '1' = hedge long; '2' = hedge short
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
    // After Phase-2 sign fix:
    //   closing fee:      -Number('0.1') = -0.1
    //   opening fee share: -0.1 * (10/20) = -0.05  (opening fill execFee='0.1')
    //   funding income:   -Number('-5') = +5, distributed +5*(10/20) = +2.5 each
    //   total: -0.1 + (-0.05) + 2.5 = 2.35
    expect(trades[0].fee).toBeCloseTo(2.35, 4)
    expect(trades[1].fee).toBeCloseTo(2.35, 4)
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
    // After Phase-2 sign fix: -Number('0.05') = -0.05; opening execFee='0' → openFeeShare=0
    expect(trades[0].fee).toBeCloseTo(-0.05)
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

// ---------------------------------------------------------------------------
// Phase 2: fee sign fix + accumulatedFee (opening fees) — B1-B7
// ---------------------------------------------------------------------------
describe('reconstructPositions — Phase 2 fee fixes', () => {

  // B1: positive execFee stored as negative (cost convention)
  it('B1: closing execFee=5 → trade.fee=-5 (negative = cost)', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100', execFee: '0' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10', execFee: '5' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades[0].fee).toBeCloseTo(-5, 4)
    expect(trades[0].fee).toBeLessThan(0)
  })

  // B2: negative execFee (rebate) → trade.fee positive
  it('B2: closing execFee=-2 (maker rebate) → trade.fee=+2', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100', execFee: '0' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10', execFee: '-2' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades[0].fee).toBeCloseTo(2, 4)
  })

  // B3: positive funding execFee (paid funding) → totalFunding negative → fee more negative
  it('B3: funding execFee=3 (cost) → trade.fee decremented by 3', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100', execFee: '0' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100', execFee: '1' }),
      makeFunding({ execFee: '3', execTime: '1500' }),  // paid 3 USDT in funding
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    // closing fee: -1; funding cost: -3; opening fee: 0 → total -4
    expect(trades[0].fee).toBeCloseTo(-4, 4)
  })

  // B4: opening fill fee accumulates and is added to closing trade fee
  it('B4: opening execFee=10 + closing execFee=10 → trade.fee=-20', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '1', closedSize: '0', execTime: '1000', execPrice: '100', execFee: '10' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10', execFee: '10' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(1)
    expect(trades[0].fee).toBeCloseTo(-20, 4)
  })

  // B5: opening fees split proportionally across 2 partial closes
  it('B5: opening execFee=20, qty=2; two partial closes each qty=1 → each trade.fee=-15', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '2', closedSize: '0',  execTime: '1000', execPrice: '100', execFee: '20' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '2000', execPrice: '110', execPnl: '10', execFee: '5' }),
      makeExec({ side: 'Sell', execQty: '1', closedSize: '1', execTime: '3000', execPrice: '120', execPnl: '20', execFee: '5' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(2)
    // each: closing(-5) + openFeeShare(-20*(1/2)=-10) = -15
    expect(trades[0].fee).toBeCloseTo(-15, 4)
    expect(trades[1].fee).toBeCloseTo(-15, 4)
  })

  // B6: accumulatedFee preserved in finalState across chunks
  it('B6: opening fee from chunk 1 propagates to closing trade in chunk 2', () => {
    const chunk1 = [
      makeExec({ side: 'Buy', execQty: '10', closedSize: '0', execTime: '1000', execPrice: '100', execFee: '10' }),
    ]
    const { finalState } = reconstructPositions(chunk1, 'linear')
    // accumulatedFee stored in finalState (negative = cost)
    expect(finalState['BTCUSDT'].accumulatedFee).toBeCloseTo(-10, 4)

    const chunk2 = [
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execFee: '10' }),
    ]
    const { trades } = reconstructPositions(chunk2, 'linear', finalState)
    expect(trades).toHaveLength(1)
    // fee = closing(-10) + openFeeShare(-10*(10/10)=-10) = -20
    expect(trades[0].fee).toBeCloseTo(-20, 4)
  })

  // B7: accumulatedFee survives JSON round-trip serialization (simulates HTTP body)
  it('B7: accumulatedFee preserved through JSON.parse(JSON.stringify(finalState))', () => {
    const chunk1 = [
      makeExec({ side: 'Buy', execQty: '5', closedSize: '0', execTime: '1000', execPrice: '200', execFee: '7' }),
    ]
    const { finalState } = reconstructPositions(chunk1, 'linear')
    const roundTripped = JSON.parse(JSON.stringify(finalState)) as typeof finalState

    const chunk2 = [
      makeExec({ side: 'Sell', execQty: '5', closedSize: '5', execTime: '2000', execPrice: '210', execFee: '7' }),
    ]
    const { trades } = reconstructPositions(chunk2, 'linear', roundTripped)
    // fee = closing(-7) + openFeeShare(-7) = -14
    expect(trades[0].fee).toBeCloseTo(-14, 4)
  })
})

// ---------------------------------------------------------------------------
// Phase 3: Hedge mode — positionIdx-keyed state (H1-H5)
// ---------------------------------------------------------------------------
describe('reconstructPositions — hedge mode', () => {

  // H1: one-way (no positionIdx) — existing behaviour unchanged
  it('H1: one-way (positionIdx absent): Buy open + Sell close → 1 trade, same as before', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('long')
    expect(trades[0].pnl).toBeCloseTo(100)
  })

  // H2: hedge LONG slot (positionIdx='1') — Buy opens, Sell closes → 1 trade
  it('H2: hedge positionIdx=1 (long slot): Buy open + Sell close → 1 trade', () => {
    const execs = [
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100', positionIdx: '1' }),
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '2000', execPrice: '110', execPnl: '100', positionIdx: '1' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('long')
    expect(trades[0].pnl).toBeCloseTo(100)
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())
  })

  // H3: hedge SHORT slot (positionIdx='2') — Sell opens, Buy closes → 1 trade
  it('H3: hedge positionIdx=2 (short slot): Sell open + Buy close → 1 trade', () => {
    const execs = [
      makeExec({ side: 'Sell', execQty: '5', closedSize: '0',  execTime: '1000', execPrice: '200', positionIdx: '2' }),
      makeExec({ side: 'Buy',  execQty: '5', closedSize: '5',  execTime: '2000', execPrice: '180', execPnl: '100', positionIdx: '2' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('short')
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())
  })

  // H4: KEY TEST — simultaneous LONG+SHORT on same symbol in hedge mode → 2 independent trades
  // This was the Leonardo bug: a single state per symbol caused cross-contamination.
  it('H4: simultaneous LONG+SHORT on same symbol → 2 independent trades with correct openedAt', () => {
    const execs = [
      // Open LONG at T=1000
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0', execTime: '1000', execPrice: '100', positionIdx: '1' }),
      // Open SHORT at T=1500 (simultaneous — LONG still open)
      makeExec({ side: 'Sell', execQty: '5',  closedSize: '0', execTime: '1500', execPrice: '105', positionIdx: '2' }),
      // Close SHORT at T=2000
      makeExec({ side: 'Buy',  execQty: '5',  closedSize: '5', execTime: '2000', execPrice: '95', execPnl: '50', positionIdx: '2' }),
      // Close LONG at T=3000
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '3000', execPrice: '130', execPnl: '300', positionIdx: '1' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(2)

    const longTrade  = trades.find(t => t.side === 'long')!
    const shortTrade = trades.find(t => t.side === 'short')!

    expect(longTrade).toBeDefined()
    expect(shortTrade).toBeDefined()

    // Long opened at T=1000, not T=1500 (must not be contaminated by short-slot open)
    expect(longTrade.openedAt).toBe(new Date(1000).toISOString())
    expect(longTrade.closedAt).toBe(new Date(3000).toISOString())
    expect(longTrade.pnl).toBeCloseTo(300)

    // Short opened at T=1500
    expect(shortTrade.openedAt).toBe(new Date(1500).toISOString())
    expect(shortTrade.closedAt).toBe(new Date(2000).toISOString())
    expect(shortTrade.pnl).toBeCloseTo(50)
  })

  // H5: Sell fill arrives while LONG is open in hedge mode (positionIdx='2') — must NOT close the long
  it('H5: Sell with positionIdx=2 while positionIdx=1 LONG is open → does not close the long', () => {
    const execs = [
      // Open LONG slot
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '0',  execTime: '1000', execPrice: '100', positionIdx: '1' }),
      // Open SHORT slot (different slot — must not reduce the long)
      makeExec({ side: 'Sell', execQty: '10', closedSize: '0',  execTime: '1500', execPrice: '100', positionIdx: '2' }),
      // Close SHORT slot
      makeExec({ side: 'Buy',  execQty: '10', closedSize: '10', execTime: '2000', execPrice: '90',  execPnl: '100', positionIdx: '2' }),
      // Close LONG slot — openedAt must still be T=1000
      makeExec({ side: 'Sell', execQty: '10', closedSize: '10', execTime: '3000', execPrice: '120', execPnl: '200', positionIdx: '1' }),
    ]
    const { trades } = reconstructPositions(execs, 'linear')
    expect(trades).toHaveLength(2)
    const longTrade = trades.find(t => t.side === 'long')!
    expect(longTrade.openedAt).toBe(new Date(1000).toISOString())  // not contaminated
    expect(longTrade.quantity).toBe(10)  // full 10, not reduced by short-slot sell
  })

  // H6: hedge mode state preserved across chunks with compound key
  it('H6: cross-chunk hedge state: LONG slot persists to next chunk independently of SHORT', () => {
    const chunk1 = [
      makeExec({ side: 'Buy',  execQty: '5', closedSize: '0', execTime: '1000', execPrice: '100', positionIdx: '1' }),
      makeExec({ side: 'Sell', execQty: '3', closedSize: '0', execTime: '1100', execPrice: '100', positionIdx: '2' }),
    ]
    const { finalState } = reconstructPositions(chunk1, 'linear')

    // Both slots must be tracked independently in finalState
    const longKey  = Object.keys(finalState).find(k => k.includes('1'))
    const shortKey = Object.keys(finalState).find(k => k.includes('2'))
    expect(longKey).toBeDefined()
    expect(shortKey).toBeDefined()
    expect(finalState[longKey!].size).toBe(5)
    expect(finalState[shortKey!].size).toBe(3)

    const chunk2 = [
      makeExec({ side: 'Sell', execQty: '5', closedSize: '5', execTime: '2000', execPrice: '120', execPnl: '100', positionIdx: '1' }),
    ]
    const { trades } = reconstructPositions(chunk2, 'linear', finalState)
    expect(trades).toHaveLength(1)
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())  // from chunk1 state
    expect(trades[0].side).toBe('long')
  })
})

