import { mergeData } from '@/components/charts/BalanceLineChart'
import {
  groupByDay,
  extractBybitTransfers,
  extractUsdtFromSnapshot,
  mergeBinanceBalances,
} from '@/lib/backfill-utils'

// ---------------------------------------------------------------------------
// groupByDay (Bybit transaction-log)
// ---------------------------------------------------------------------------

describe('groupByDay (Bybit transaction-log)', () => {
  it('takes the last cashBalance for the day', () => {
    const t1 = new Date('2026-01-01T10:00:00Z').getTime()
    const t2 = new Date('2026-01-01T22:00:00Z').getTime()
    const rows = [
      { transactionTime: String(t1), cashBalance: '100' },
      { transactionTime: String(t2), cashBalance: '200' },
    ]
    const result = groupByDay(rows)
    expect(Object.keys(result)).toHaveLength(1)
    expect(result['2026-01-01']).toBe(200)
  })

  it('multiple days produce multiple keys', () => {
    const rows = [
      { transactionTime: String(new Date('2026-01-01T10:00:00Z').getTime()), cashBalance: '1000' },
      { transactionTime: String(new Date('2026-01-02T10:00:00Z').getTime()), cashBalance: '1100' },
      { transactionTime: String(new Date('2026-01-02T12:00:00Z').getTime()), cashBalance: '1150' },
    ]
    const result = groupByDay(rows)
    expect(result['2026-01-01']).toBe(1000)
    expect(result['2026-01-02']).toBe(1150)
  })

  it('empty input returns empty object', () => {
    expect(groupByDay([])).toEqual({})
  })

  it('single row produces single key', () => {
    const rows = [{ transactionTime: String(new Date('2026-03-15T00:00:00Z').getTime()), cashBalance: '50000' }]
    const result = groupByDay(rows)
    expect(result['2026-03-15']).toBe(50000)
  })
})

// ---------------------------------------------------------------------------
// mergeData (BalanceLineChart fix)
// ---------------------------------------------------------------------------

describe('mergeData (BalanceLineChart)', () => {
  it('empty input returns empty array', () => {
    expect(mergeData([])).toEqual([])
  })

  it('single account, single date', () => {
    const series = [{ subAccountId: 'a', data: [{ date: '2026-01-01', value: 100 }] }]
    const merged = mergeData(series)
    expect(merged).toHaveLength(1)
    expect(merged[0].date).toBe('2026-01-01')
    expect(merged[0].a).toBe(100)
  })

  it('two accounts with identical dates — no value misalignment', () => {
    const series = [
      { subAccountId: 'a', data: [{ date: '2026-01-01', value: 100 }, { date: '2026-01-02', value: 110 }] },
      { subAccountId: 'b', data: [{ date: '2026-01-01', value: 200 }, { date: '2026-01-02', value: 210 }] },
    ]
    const merged = mergeData(series)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ date: '2026-01-01', a: 100, b: 200 })
    expect(merged[1]).toMatchObject({ date: '2026-01-02', a: 110, b: 210 })
  })

  it('different date sets — no value misalignment', () => {
    const series = [
      { subAccountId: 'a', data: [{ date: '2026-01-01', value: 100 }, { date: '2026-01-03', value: 110 }] },
      { subAccountId: 'b', data: [{ date: '2026-01-02', value: 200 }] },
    ]
    const merged = mergeData(series)
    expect(merged).toHaveLength(3)

    const day1 = merged.find(r => r.date === '2026-01-01')!
    const day2 = merged.find(r => r.date === '2026-01-02')!
    const day3 = merged.find(r => r.date === '2026-01-03')!

    expect(day1.a).toBe(100)
    expect(day1.b).toBe(0) // b has no data yet

    expect(day2.a).toBe(100) // carry-forward from 01-01
    expect(day2.b).toBe(200)

    expect(day3.a).toBe(110) // new value
    expect(day3.b).toBe(200) // carry-forward
  })

  it('carry-forward propagates value to all later dates', () => {
    const series = [
      { subAccountId: 'a', data: [{ date: '2026-01-01', value: 500 }] },
      { subAccountId: 'b', data: [
        { date: '2026-01-01', value: 100 },
        { date: '2026-01-05', value: 200 },
      ]},
    ]
    const merged = mergeData(series)
    const day5 = merged.find(r => r.date === '2026-01-05')!
    expect(day5.a).toBe(500) // carry-forward from 01-01
    expect(day5.b).toBe(200)
  })

  it('output dates are sorted ascending', () => {
    const series = [
      { subAccountId: 'a', data: [
        { date: '2026-03-01', value: 300 },
        { date: '2026-01-01', value: 100 },
        { date: '2026-02-01', value: 200 },
      ]},
    ]
    const merged = mergeData(series)
    expect(merged[0].date).toBe('2026-01-01')
    expect(merged[1].date).toBe('2026-02-01')
    expect(merged[2].date).toBe('2026-03-01')
  })
})

// ---------------------------------------------------------------------------
// extractBybitTransfers
// ---------------------------------------------------------------------------

describe('extractBybitTransfers', () => {
  const ACC = 'acc-123'

  it('TRANSFER_IN maps to deposit record', () => {
    const rows = [{ type: 'TRANSFER_IN', id: 'tx1', currency: 'USDT', cashFlow: '100000', transactionTime: '1700000000000' }]
    const result = extractBybitTransfers(rows, ACC)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('deposit')
    expect(result[0].amount).toBe(100000)
    expect(result[0].tx_id).toBe('txlog_tx1')
    expect(result[0].asset).toBe('USDT')
    expect(result[0].account_id).toBe(ACC)
  })

  it('TRANSFER_OUT maps to withdrawal record with positive amount', () => {
    const rows = [{ type: 'TRANSFER_OUT', id: 'tx2', currency: 'USDT', cashFlow: '-50000', transactionTime: '1700000000000' }]
    const result = extractBybitTransfers(rows, ACC)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('withdrawal')
    expect(result[0].amount).toBe(50000)
  })

  it('TRADE entries are ignored', () => {
    const rows = [{ type: 'TRADE', id: 'tx3', cashFlow: '100' }]
    expect(extractBybitTransfers(rows, ACC)).toHaveLength(0)
  })

  it('FUNDING entries are ignored', () => {
    const rows = [{ type: 'FUNDING', id: 'tx4', cashFlow: '-5' }]
    expect(extractBybitTransfers(rows, ACC)).toHaveLength(0)
  })

  it('missing id is skipped', () => {
    const rows = [{ type: 'TRANSFER_IN', id: '', cashFlow: '1000' }]
    expect(extractBybitTransfers(rows, ACC)).toHaveLength(0)
  })

  it('cashFlow = 0 is skipped', () => {
    const rows = [{ type: 'TRANSFER_IN', id: 'tx5', cashFlow: '0' }]
    expect(extractBybitTransfers(rows, ACC)).toHaveLength(0)
  })

  it('falls back to change field when cashFlow absent', () => {
    const rows = [{ type: 'TRANSFER_IN', id: 'tx6', change: '25000', transactionTime: '1700000000000' }]
    const result = extractBybitTransfers(rows, ACC)
    expect(result[0].amount).toBe(25000)
  })

  it('defaults asset to USDT when currency absent', () => {
    const rows = [{ type: 'TRANSFER_IN', id: 'tx7', cashFlow: '1000', transactionTime: '1700000000000' }]
    expect(extractBybitTransfers(rows, ACC)[0].asset).toBe('USDT')
  })

  it('empty input → empty result', () => {
    expect(extractBybitTransfers([], ACC)).toHaveLength(0)
  })

  it('mixed rows: only transfers extracted', () => {
    const rows = [
      { type: 'TRADE',       id: 'a', cashFlow: '100' },
      { type: 'TRANSFER_IN', id: 'b', cashFlow: '5000', transactionTime: '1700000000000' },
      { type: 'FUNDING',     id: 'c', cashFlow: '-10' },
      { type: 'TRANSFER_OUT',id: 'd', cashFlow: '-200', transactionTime: '1700000000001' },
    ]
    const result = extractBybitTransfers(rows, ACC)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('deposit')
    expect(result[1].type).toBe('withdrawal')
  })
})

// ---------------------------------------------------------------------------
// extractUsdtFromSnapshot
// ---------------------------------------------------------------------------

describe('extractUsdtFromSnapshot', () => {
  it('FUTURES structure (assets[].walletBalance)', () => {
    const data = { assets: [{ asset: 'USDT', walletBalance: '22963.5', free: '0' }] }
    expect(extractUsdtFromSnapshot(data)).toBeCloseTo(22963.5)
  })

  it('MARGIN structure (userAssets[].free)', () => {
    const data = { userAssets: [{ asset: 'BTC', free: '1.5' }, { asset: 'USDT', free: '50000' }] }
    expect(extractUsdtFromSnapshot(data)).toBe(50000)
  })

  it('no USDT in assets returns 0', () => {
    const data = { userAssets: [{ asset: 'BTC', free: '1.5' }] }
    expect(extractUsdtFromSnapshot(data)).toBe(0)
  })

  it('empty data returns 0', () => {
    expect(extractUsdtFromSnapshot({})).toBe(0)
  })

  it('prefers userAssets over assets', () => {
    const data = {
      userAssets: [{ asset: 'USDT', free: '9000' }],
      assets:     [{ asset: 'USDT', walletBalance: '1000' }],
    }
    expect(extractUsdtFromSnapshot(data)).toBe(9000)
  })
})

// ---------------------------------------------------------------------------
// mergeBinanceBalances
// ---------------------------------------------------------------------------

describe('mergeBinanceBalances', () => {
  it('portfolio_margin: sums FUTURES and MARGIN per date', () => {
    const futures = { '2026-04-01': 22963 }
    const margin  = { '2026-04-01': 6494 }
    const merged  = mergeBinanceBalances(futures, margin, true)
    expect(merged['2026-04-01']).toBeCloseTo(29457)
  })

  it('portfolio_margin: FUTURES=$0 + MARGIN=$50K sums to $50K', () => {
    const futures = { '2026-04-20': 0 }
    const margin  = { '2026-04-20': 50000 }
    const merged  = mergeBinanceBalances(futures, margin, true)
    expect(merged['2026-04-20']).toBe(50000)
  })

  it('portfolio_margin: date only in FUTURES uses futures amount', () => {
    const futures = { '2026-04-01': 1000 }
    const margin:  Record<string, number> = {}
    const merged  = mergeBinanceBalances(futures, margin, true)
    expect(merged['2026-04-01']).toBe(1000)
  })

  it('portfolio_margin: date only in MARGIN uses margin amount', () => {
    const futures: Record<string, number> = {}
    const margin  = { '2026-04-01': 5000 }
    const merged  = mergeBinanceBalances(futures, margin, true)
    expect(merged['2026-04-01']).toBe(5000)
  })

  it('unified: both maps show $50K — uses FUTURES, not double-counted', () => {
    const futures = { '2026-04-20': 50000 }
    const margin  = { '2026-04-20': 50000 }
    const merged  = mergeBinanceBalances(futures, margin, false)
    expect(merged['2026-04-20']).toBe(50000)
  })

  it('unified: falls back to MARGIN when FUTURES is 0', () => {
    const futures = { '2026-04-01': 0 }
    const margin  = { '2026-04-01': 30000 }
    const merged  = mergeBinanceBalances(futures, margin, false)
    expect(merged['2026-04-01']).toBe(30000)
  })

  it('unified: uses FUTURES when it has a non-zero value', () => {
    const futures = { '2026-04-01': 45000 }
    const margin  = { '2026-04-01': 45000 }
    const merged  = mergeBinanceBalances(futures, margin, false)
    expect(merged['2026-04-01']).toBe(45000)
  })

  it('union of dates from both maps appears in result', () => {
    const futures = { '2026-04-01': 1000, '2026-04-02': 1100 }
    const margin  = { '2026-04-02': 500,  '2026-04-03': 600 }
    const merged  = mergeBinanceBalances(futures, margin, true)
    expect(Object.keys(merged)).toHaveLength(3)
    expect(merged['2026-04-01']).toBe(1000)
    expect(merged['2026-04-02']).toBe(1600)
    expect(merged['2026-04-03']).toBe(600)
  })

  it('empty inputs return empty result', () => {
    expect(mergeBinanceBalances({}, {}, true)).toEqual({})
    expect(mergeBinanceBalances({}, {}, false)).toEqual({})
  })
})
