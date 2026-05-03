/**
 * Unit tests for reconstructBinanceTrades() — Binance FAPI stateful position reconstruction.
 *
 * reconstructBinanceTrades() is exported from lib/adapters/binance.ts.
 * It takes all raw FAPI fill records for a single symbol (sorted by time) and emits
 * one Trade per CLOSED position, with real openedAt (position start) and closedAt (fill time).
 *
 * Supports both one-way mode (positionSide='BOTH') and hedge mode (positionSide='LONG'|'SHORT').
 * Commission is stored as negative (cost convention).
 */

import { reconstructBinanceTrades } from '../adapters/binance'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RawFapiTrade = {
  symbol: string
  side: string        // 'BUY' | 'SELL'
  price: string
  qty: string
  realizedPnl: string
  commission: string
  commissionAsset: string
  time: number
  positionSide: string  // 'BOTH' | 'LONG' | 'SHORT'
  orderId: number
  id: number
}

let _id = 1
function makeFill(overrides: Partial<RawFapiTrade> & { time: number }): RawFapiTrade {
  return {
    symbol:          'BTCUSDT',
    side:            'BUY',
    price:           '50000',
    qty:             '1',
    realizedPnl:     '0',
    commission:      '10',
    commissionAsset: 'USDT',
    positionSide:    'BOTH',
    orderId:         1,
    id:              _id++,
    ...overrides,
  }
}

beforeEach(() => { _id = 1 })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reconstructBinanceTrades', () => {

  // ── Test 1: one-way LONG happy path ────────────────────────────────────────
  it('one-way LONG: BUY pnl=0 open + SELL pnl≠0 close → 1 trade, side=long', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '1', realizedPnl: '0',   price: '50000', commission: '10', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '1', realizedPnl: '1000', price: '51000', commission: '10', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('long')
    expect(trades[0].pnl).toBe(1000)
    expect(trades[0].entryPrice).toBeCloseTo(50000, 0)
    expect(trades[0].exitPrice).toBe(51000)
  })

  // ── Test 2: one-way SHORT — SELL pnl=0 open + BUY pnl≠0 close ─────────────
  it('one-way SHORT: SELL pnl=0 open + BUY pnl≠0 close → 1 trade, side=short', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'SELL', qty: '1', realizedPnl: '0',    price: '50000', commission: '10', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'BUY',  qty: '1', realizedPnl: '500',  price: '49500', commission: '10', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('short')
    expect(trades[0].pnl).toBe(500)
  })

  // ── Test 3: hedge mode LONG ─────────────────────────────────────────────────
  it('hedge LONG: positionSide=LONG, BUY open + SELL close → 1 trade, side=long', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '2', realizedPnl: '0',   price: '40000', commission: '8',  positionSide: 'LONG' }),
      makeFill({ time: 2000, side: 'SELL', qty: '2', realizedPnl: '800', price: '40400', commission: '8',  positionSide: 'LONG' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('long')
    expect(trades[0].pnl).toBe(800)
  })

  // ── Test 4: hedge mode SHORT ────────────────────────────────────────────────
  it('hedge SHORT: positionSide=SHORT, SELL open + BUY close → 1 trade, side=short', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'SELL', qty: '2', realizedPnl: '0',    price: '40000', commission: '8', positionSide: 'SHORT' }),
      makeFill({ time: 2000, side: 'BUY',  qty: '2', realizedPnl: '400',  price: '39800', commission: '8', positionSide: 'SHORT' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    expect(trades[0].side).toBe('short')
    expect(trades[0].pnl).toBe(400)
  })

  // ── Test 5: opened_at < closed_at (regression: нет одинаковых timestamps) ──
  it('regression: opened_at < closed_at for every emitted trade', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1_000_000, side: 'BUY',  qty: '1', realizedPnl: '0',   price: '50000', positionSide: 'BOTH' }),
      makeFill({ time: 9_000_000, side: 'SELL', qty: '1', realizedPnl: '100', price: '50100', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    const openTs  = new Date(trades[0].openedAt!).getTime()
    const closeTs = new Date(trades[0].closedAt!).getTime()
    expect(openTs).toBeLessThan(closeTs)
    expect(trades[0].openedAt).not.toBe(trades[0].closedAt)
  })

  // ── Test 6: scale-in → weighted avg entry price ─────────────────────────────
  it('scale-in: two BUY pnl=0 → weighted avg entry, one SELL close', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '1', realizedPnl: '0',    price: '40000', positionSide: 'BOTH', commission: '8' }),
      makeFill({ time: 1500, side: 'BUY',  qty: '1', realizedPnl: '0',    price: '42000', positionSide: 'BOTH', commission: '8' }),
      makeFill({ time: 2000, side: 'SELL', qty: '2', realizedPnl: '2000', price: '43000', positionSide: 'BOTH', commission: '8' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    expect(trades[0].entryPrice).toBeCloseTo(41000, 0)  // (40000+42000)/2
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())
  })

  // ── Test 7: partial close → 2 trades, same opened_at ───────────────────────
  it('partial close: two SELL pnl≠0 → 2 trades, both with same opened_at', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '2', realizedPnl: '0',   price: '50000', positionSide: 'BOTH', commission: '10' }),
      makeFill({ time: 2000, side: 'SELL', qty: '1', realizedPnl: '500', price: '50500', positionSide: 'BOTH', commission: '5'  }),
      makeFill({ time: 3000, side: 'SELL', qty: '1', realizedPnl: '700', price: '50700', positionSide: 'BOTH', commission: '5'  }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(2)
    expect(trades[0].openedAt).toBe(trades[1].openedAt)
    expect(trades[0].closedAt).toBe(new Date(2000).toISOString())
    expect(trades[1].closedAt).toBe(new Date(3000).toISOString())
    expect(trades[0].quantity).toBe(1)
    expect(trades[1].quantity).toBe(1)
  })

  // ── Test 8: две последовательных позиции по одному символу ─────────────────
  it('two sequential positions: second openedAt > first closedAt', () => {
    const fills: RawFapiTrade[] = [
      // First position
      makeFill({ time: 1000, side: 'BUY',  qty: '1', realizedPnl: '0',   price: '50000', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '1', realizedPnl: '100', price: '50100', positionSide: 'BOTH' }),
      // Second position
      makeFill({ time: 3000, side: 'BUY',  qty: '1', realizedPnl: '0',   price: '50200', positionSide: 'BOTH' }),
      makeFill({ time: 4000, side: 'SELL', qty: '1', realizedPnl: '200', price: '50400', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(2)
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())
    expect(trades[0].closedAt).toBe(new Date(2000).toISOString())
    expect(trades[1].openedAt).toBe(new Date(3000).toISOString())
    expect(trades[1].closedAt).toBe(new Date(4000).toISOString())
    const open2 = new Date(trades[1].openedAt!).getTime()
    const close1 = new Date(trades[0].closedAt!).getTime()
    expect(open2).toBeGreaterThan(close1)
  })

  // ── Test 9: пустые fill'ы → [] ──────────────────────────────────────────────
  it('empty fills → empty result', () => {
    expect(reconstructBinanceTrades([], 'BTCUSDT')).toEqual([])
  })

  // ── Test 10: только открывающие fill'ы → [] ─────────────────────────────────
  it('only opening fills (pnl=0) → no trades emitted', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY', qty: '1', realizedPnl: '0', positionSide: 'BOTH' }),
      makeFill({ time: 1500, side: 'BUY', qty: '1', realizedPnl: '0', positionSide: 'BOTH' }),
    ]
    expect(reconstructBinanceTrades(fills, 'BTCUSDT')).toHaveLength(0)
  })

  // ── Test 11: комиссии открывающего fill'а включаются в fee ─────────────────
  it('opening fill commission is included in closing trade fee', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '1', realizedPnl: '0',   price: '50000', commission: '10', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '1', realizedPnl: '500', price: '50500', commission: '10', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    // fee = -(closing 10) + -(opening 10 proportional share) = -20
    expect(trades[0].fee).toBeCloseTo(-20, 4)
  })

  // ── Test 12: пропорциональное распределение комиссий открытия ──────────────
  it('opening fees split proportionally across 2 partial closes', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '2', realizedPnl: '0',   price: '50000', commission: '20', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '1', realizedPnl: '200', price: '50200', commission: '5',  positionSide: 'BOTH' }),
      makeFill({ time: 3000, side: 'SELL', qty: '1', realizedPnl: '400', price: '50400', commission: '5',  positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(2)
    // Each closing trade: closing fee (-5) + 50% of opening fee (-20/2 = -10) = -15
    expect(trades[0].fee).toBeCloseTo(-15, 4)
    expect(trades[1].fee).toBeCloseTo(-15, 4)
  })

  // ── Test 13: комиссии хранятся отрицательными (расходная конвенция) ─────────
  it('commission stored as negative value (cost convention)', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '1', realizedPnl: '0',   commission: '25', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '1', realizedPnl: '100', commission: '25', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades[0].fee).toBeLessThan(0)
  })

})

// ---------------------------------------------------------------------------
// Same-millisecond fill aggregation (SM tests)
// Large orders partially fill at identical Unix-ms timestamps.
// The unique constraint (account_id, symbol, opened_at, closed_at) collapses
// them on upsert → only 1 of N fills survives.
// Fix: after reconstruction, merge trades that share (symbol, openedAt, closedAt)
// into a single Trade (summed pnl, qty; weighted avg exitPrice; summed fee).
// ---------------------------------------------------------------------------
describe('reconstructBinanceTrades — same-millisecond fill aggregation', () => {

  // ── SM1: 2 closing fills at identical timestamp → 1 merged trade ─────────
  it('SM1: two closing fills at the same millisecond are merged into one trade', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '10', realizedPnl: '0',   price: '100', commission: '10', positionSide: 'BOTH' }),
      // Two partial closes at the SAME time
      makeFill({ time: 2000, side: 'SELL', qty: '6',  realizedPnl: '60',  price: '110', commission: '6',  positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '4',  realizedPnl: '40',  price: '110', commission: '4',  positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    expect(trades[0].pnl).toBeCloseTo(100, 4)       // 60 + 40
    expect(trades[0].quantity).toBeCloseTo(10, 4)   // 6 + 4
  })

  // ── SM2: merged trade has correct openedAt (position start, not fill time) ─
  it('SM2: merged trade preserves the correct openedAt from position start', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '4', realizedPnl: '0',   price: '100', commission: '4', positionSide: 'BOTH' }),
      makeFill({ time: 5000, side: 'SELL', qty: '2', realizedPnl: '20',  price: '110', commission: '2', positionSide: 'BOTH' }),
      makeFill({ time: 5000, side: 'SELL', qty: '2', realizedPnl: '20',  price: '110', commission: '2', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    expect(trades[0].openedAt).toBe(new Date(1000).toISOString())
    expect(trades[0].closedAt).toBe(new Date(5000).toISOString())
  })

  // ── SM3: fees summed correctly across merged fills ──────────────────────────
  it('SM3: fees from all same-ms fills are summed in the merged trade', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '6', realizedPnl: '0',   price: '100', commission: '6', positionSide: 'BOTH' }),
      makeFill({ time: 3000, side: 'SELL', qty: '3', realizedPnl: '30',  price: '110', commission: '3', positionSide: 'BOTH' }),
      makeFill({ time: 3000, side: 'SELL', qty: '3', realizedPnl: '30',  price: '110', commission: '3', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    // closing fees: -(3+3) = -6; open fee share: -6 total spread fully = -6; total = -12
    expect(trades[0].fee).toBeCloseTo(-12, 4)
  })

  // ── SM4: different timestamps → NOT merged (separate positions) ─────────────
  it('SM4: fills at different timestamps are NOT merged', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '2', realizedPnl: '0',  price: '100', commission: '2', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '1', realizedPnl: '10', price: '110', commission: '1', positionSide: 'BOTH' }),
      makeFill({ time: 3000, side: 'SELL', qty: '1', realizedPnl: '20', price: '120', commission: '1', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(2)
    expect(trades[0].closedAt).toBe(new Date(2000).toISOString())
    expect(trades[1].closedAt).toBe(new Date(3000).toISOString())
  })

  // ── SM5: 3 same-ms fills with weighted-avg exit price ──────────────────────
  it('SM5: exitPrice is the quantity-weighted average of merged fills', () => {
    const fills: RawFapiTrade[] = [
      makeFill({ time: 1000, side: 'BUY',  qty: '9', realizedPnl: '0',   price: '100', commission: '9', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '3', realizedPnl: '30',  price: '110', commission: '3', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '3', realizedPnl: '30',  price: '120', commission: '3', positionSide: 'BOTH' }),
      makeFill({ time: 2000, side: 'SELL', qty: '3', realizedPnl: '30',  price: '130', commission: '3', positionSide: 'BOTH' }),
    ]
    const trades = reconstructBinanceTrades(fills, 'BTCUSDT')
    expect(trades).toHaveLength(1)
    // weighted avg: (3×110 + 3×120 + 3×130) / 9 = (330+360+390)/9 = 1080/9 = 120
    expect(trades[0].exitPrice).toBeCloseTo(120, 4)
  })

})
