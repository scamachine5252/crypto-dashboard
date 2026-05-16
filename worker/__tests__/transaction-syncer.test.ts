import 'server-only'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUpsert    = jest.fn()
const mockSelect    = jest.fn()
const mockFrom      = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}))

jest.mock('server-only', () => ({}))

const mockIsBanned      = jest.fn().mockReturnValue(false)
const mockRecordIfBanned = jest.fn().mockResolvedValue(undefined)

jest.mock('../binance-ban-guard', () => ({
  binanceBanGuard: {
    isBanned:       (...args: unknown[]) => mockIsBanned(...args),
    recordIfBanned: (...args: unknown[]) => mockRecordIfBanned(...args),
  },
}))

jest.mock('@/lib/crypto/decrypt', () => ({
  decrypt: (v: string) => v,
}))

// Mock ccxt
const mockBybitPrivateGetV5AssetDepositQueryRecord    = jest.fn()
const mockBybitPrivateGetV5AssetWithdrawQueryRecord   = jest.fn()
const mockBybitPrivateGetV5AccountTransactionLog      = jest.fn()
const mockBinanceFetchDeposits                        = jest.fn()
const mockBinanceFetchWithdrawals                     = jest.fn()
const mockBinanceSapiGetSubAccountTransferSubUserHistory = jest.fn()
const mockBinanceFapiPrivateGetIncome                 = jest.fn()
const mockBinancePapiGetUmIncome                      = jest.fn()
const mockBinancePapiGetCmIncome                      = jest.fn()

jest.mock('ccxt', () => ({
  bybit: jest.fn().mockImplementation(() => ({
    privateGetV5AssetDepositQueryRecord:   mockBybitPrivateGetV5AssetDepositQueryRecord,
    privateGetV5AssetWithdrawQueryRecord:  mockBybitPrivateGetV5AssetWithdrawQueryRecord,
    privateGetV5AccountTransactionLog:     mockBybitPrivateGetV5AccountTransactionLog,
  })),
  binance: jest.fn().mockImplementation(() => ({
    fetchDeposits:    mockBinanceFetchDeposits,
    fetchWithdrawals: mockBinanceFetchWithdrawals,
    sapiGetSubAccountTransferSubUserHistory: mockBinanceSapiGetSubAccountTransferSubUserHistory,
    fapiPrivateGetIncome: mockBinanceFapiPrivateGetIncome,
    papiGetUmIncome:  mockBinancePapiGetUmIncome,
    papiGetCmIncome:  mockBinancePapiGetCmIncome,
  })),
}))

import { TransactionSyncer } from '../transaction-syncer'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAccount(exchange: string, instrument?: string) {
  return {
    id: `acc-${exchange}`,
    exchange,
    api_key:    'key',
    api_secret: 'secret',
    passphrase: null,
    instrument: instrument ?? null,
  }
}

function setupAccountsQuery(accounts: ReturnType<typeof makeAccount>[]) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'accounts') {
      return {
        select: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnThis(),
        then:   jest.fn(),
        // Supabase fluent API resolves as promise
        [Symbol.iterator]: undefined,
      }
    }
    if (table === 'transactions') {
      return {
        upsert: mockUpsert,
      }
    }
    return {}
  })

  // Override to resolve properly
  mockFrom.mockImplementation((table: string) => {
    if (table === 'accounts') {
      const chain = {
        select: jest.fn().mockReturnThis(),
        eq:     jest.fn().mockReturnValue(Promise.resolve({ data: accounts, error: null })),
      }
      return chain
    }
    if (table === 'transactions') {
      return { upsert: mockUpsert }
    }
    return {}
  })
}

beforeEach(() => {
  jest.resetAllMocks()

  // Restore ccxt constructor implementations (reset by resetAllMocks)
  const ccxtMock = jest.requireMock('ccxt') as {
    bybit: jest.Mock
    binance: jest.Mock
  }
  ccxtMock.bybit.mockImplementation(() => ({
    privateGetV5AssetDepositQueryRecord:  mockBybitPrivateGetV5AssetDepositQueryRecord,
    privateGetV5AssetWithdrawQueryRecord: mockBybitPrivateGetV5AssetWithdrawQueryRecord,
    privateGetV5AccountTransactionLog:    mockBybitPrivateGetV5AccountTransactionLog,
  }))
  ccxtMock.binance.mockImplementation(() => ({
    fetchDeposits:    mockBinanceFetchDeposits,
    fetchWithdrawals: mockBinanceFetchWithdrawals,
    sapiGetSubAccountTransferSubUserHistory: mockBinanceSapiGetSubAccountTransferSubUserHistory,
    fapiPrivateGetIncome: mockBinanceFapiPrivateGetIncome,
    papiGetUmIncome:  mockBinancePapiGetUmIncome,
    papiGetCmIncome:  mockBinancePapiGetCmIncome,
  }))

  mockIsBanned.mockReturnValue(false)
  mockRecordIfBanned.mockResolvedValue(undefined)
  mockUpsert.mockResolvedValue({ error: null })
  // Default: no deposits/withdrawals/transfers
  mockBybitPrivateGetV5AssetDepositQueryRecord.mockResolvedValue({ result: { rows: [] } })
  mockBybitPrivateGetV5AssetWithdrawQueryRecord.mockResolvedValue({ result: { rows: [] } })
  mockBybitPrivateGetV5AccountTransactionLog.mockResolvedValue({ result: { list: [], nextPageCursor: undefined } })
  mockBinanceFetchDeposits.mockResolvedValue([])
  mockBinanceFetchWithdrawals.mockResolvedValue([])
  mockBinanceSapiGetSubAccountTransferSubUserHistory.mockResolvedValue([])
  mockBinanceFapiPrivateGetIncome.mockResolvedValue([])
  mockBinancePapiGetUmIncome.mockResolvedValue([])
  mockBinancePapiGetCmIncome.mockResolvedValue([])
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TransactionSyncer — Bybit', () => {
  it('maps TRANSFER_IN tx-log entries to deposit rows', async () => {
    setupAccountsQuery([makeAccount('bybit')])
    mockBybitPrivateGetV5AccountTransactionLog.mockResolvedValue({
      result: {
        list: [{
          type: 'TRANSFER_IN', id: 'txlog-123', currency: 'USDT',
          cashFlow: '1000', transactionTime: '1700000000000',
        }],
        nextPageCursor: undefined,
      },
    })

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const transfer = rows.find(r => r.tx_id === 'txlog_txlog-123')
    expect(transfer).toBeDefined()
    expect(transfer!.type).toBe('deposit')
    expect(transfer!.amount).toBe(1000)
    expect(transfer!.asset).toBe('USDT')
  })

  it('maps TRANSFER_OUT tx-log entries to withdrawal rows', async () => {
    setupAccountsQuery([makeAccount('bybit')])
    mockBybitPrivateGetV5AccountTransactionLog.mockResolvedValue({
      result: {
        list: [{
          type: 'TRANSFER_OUT', id: 'txlog-456', currency: 'USDT',
          cashFlow: '-500', transactionTime: '1700000001000',
        }],
        nextPageCursor: undefined,
      },
    })

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const transfer = rows.find(r => r.tx_id === 'txlog_txlog-456')
    expect(transfer!.type).toBe('withdrawal')
    expect(transfer!.amount).toBe(500)
  })

  it('maps SETTLEMENT tx-log entries to funding_fee rows with signed amount', async () => {
    setupAccountsQuery([makeAccount('bybit')])
    mockBybitPrivateGetV5AccountTransactionLog.mockResolvedValue({
      result: {
        list: [
          { type: 'SETTLEMENT', id: 'settle-1', currency: 'USDT', cashFlow: '-12.5', transactionTime: '1700000002000' },
          { type: 'SETTLEMENT', id: 'settle-2', currency: 'USDT', cashFlow: '7.3',   transactionTime: '1700000003000' },
        ],
        nextPageCursor: undefined,
      },
    })

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const paid     = rows.find(r => r.tx_id === 'funding_settle-1')
    const received = rows.find(r => r.tx_id === 'funding_settle-2')
    expect(paid!.type).toBe('funding_fee')
    expect(paid!.amount).toBe(-12.5)
    expect(received!.amount).toBe(7.3)
  })

  it('paginates tx-log until nextPageCursor is empty', async () => {
    setupAccountsQuery([makeAccount('bybit')])
    mockBybitPrivateGetV5AccountTransactionLog
      .mockResolvedValueOnce({
        result: {
          list: [{ type: 'TRANSFER_IN', id: 'p1', currency: 'USDT', cashFlow: '100', transactionTime: '1700000000000' }],
          nextPageCursor: 'cursor-abc',
        },
      })
      .mockResolvedValueOnce({
        result: {
          list: [{ type: 'TRANSFER_IN', id: 'p2', currency: 'USDT', cashFlow: '200', transactionTime: '1700000001000' }],
          nextPageCursor: '',
        },
      })

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    expect(mockBybitPrivateGetV5AccountTransactionLog).toHaveBeenCalledTimes(2)
    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows.filter(r => r.tx_id === 'txlog_p1' || r.tx_id === 'txlog_p2')).toHaveLength(2)
  })

  it('maps external deposits correctly', async () => {
    setupAccountsQuery([makeAccount('bybit')])
    mockBybitPrivateGetV5AssetDepositQueryRecord.mockResolvedValue({
      result: {
        rows: [{
          txID: 'hash-ext-001', coin: 'USDT', amount: '5000',
          depositFeeTime: '1700000000000', status: 'success',
        }],
      },
    })

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const dep = rows.find(r => r.tx_id === 'hash-ext-001')
    expect(dep!.type).toBe('deposit')
    expect(dep!.amount).toBe(5000)
  })

  it('skips rows with zero cashFlow', async () => {
    setupAccountsQuery([makeAccount('bybit')])
    mockBybitPrivateGetV5AccountTransactionLog.mockResolvedValue({
      result: {
        list: [{ type: 'SETTLEMENT', id: 'zero-1', currency: 'USDT', cashFlow: '0', transactionTime: '1700000000000' }],
        nextPageCursor: undefined,
      },
    })

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    // upsert with 0 valid rows = not called at all
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('TransactionSyncer — Binance', () => {
  it('skips all Binance calls when BinanceBanGuard is banned', async () => {
    setupAccountsQuery([makeAccount('binance')])
    mockIsBanned.mockReturnValue(true)

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    expect(mockBinanceFetchDeposits).not.toHaveBeenCalled()
    expect(mockBinanceFetchWithdrawals).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('fetches FUNDING_FEE income from fapiPrivateGetIncome for regular accounts', async () => {
    setupAccountsQuery([makeAccount('binance')])
    mockBinanceFapiPrivateGetIncome.mockResolvedValueOnce([
      { tranId: '111', asset: 'USDT', income: '-3.5', time: '1700000000000' },
      { tranId: '222', asset: 'USDT', income: '1.2',  time: '1700000001000' },
    ]).mockResolvedValueOnce([])  // second page = empty, loop exits

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const fee1 = rows.find(r => r.tx_id === 'funding_111')
    const fee2 = rows.find(r => r.tx_id === 'funding_222')
    expect(fee1!.type).toBe('funding_fee')
    expect(fee1!.amount).toBe(-3.5)
    expect(fee2!.amount).toBe(1.2)
  })

  it('uses papiGetUmIncome + papiGetCmIncome for portfolio_margin accounts', async () => {
    setupAccountsQuery([makeAccount('binance', 'portfolio_margin')])
    mockBinancePapiGetUmIncome.mockResolvedValueOnce([
      { tranId: 'um-1', asset: 'USDT', income: '-5', time: '1700000000000' },
    ]).mockResolvedValueOnce([])
    mockBinancePapiGetCmIncome.mockResolvedValueOnce([
      { tranId: 'cm-1', asset: 'BTC', income: '-0.001', time: '1700000001000' },
    ]).mockResolvedValueOnce([])

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows.find(r => r.tx_id === 'funding_um-1')).toBeDefined()
    expect(rows.find(r => r.tx_id === 'funding_cm-1')).toBeDefined()
    // fapiPrivateGetIncome should NOT be called for PM accounts
    expect(mockBinanceFapiPrivateGetIncome).not.toHaveBeenCalled()
  })

  it('paginates FUNDING_FEE income when page is full (1000 rows)', async () => {
    setupAccountsQuery([makeAccount('binance')])
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      tranId: String(i), asset: 'USDT', income: '0.1', time: String(1700000000000 + i),
    }))
    mockBinanceFapiPrivateGetIncome
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce([{ tranId: 'last', asset: 'USDT', income: '0.5', time: '1700001000000' }])

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    // Implementation breaks on result.length < 1000, so 2 calls total
    expect(mockBinanceFapiPrivateGetIncome).toHaveBeenCalledTimes(2)
    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows.filter(r => r.type === 'funding_fee')).toHaveLength(1001)
  })

  it('skips funding_fee rows with zero income', async () => {
    setupAccountsQuery([makeAccount('binance')])
    mockBinanceFapiPrivateGetIncome.mockResolvedValueOnce([
      { tranId: 'zero', asset: 'USDT', income: '0', time: '1700000000000' },
    ]).mockResolvedValueOnce([])

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('maps sub-account transfer type 1 (in from master) to deposit', async () => {
    setupAccountsQuery([makeAccount('binance')])
    mockBinanceSapiGetSubAccountTransferSubUserHistory.mockImplementation(
      ({ type }: { type: number }) => {
        if (type === 1) return Promise.resolve([{
          tranId: 'sub-1', asset: 'USDT', qty: '2000', time: '1700000000000', status: 'SUCCESS',
        }])
        return Promise.resolve([])
      }
    )

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const tx = rows.find(r => r.tx_id === 'subtransfer_sub-1')
    expect(tx!.type).toBe('deposit')
    expect(tx!.amount).toBe(2000)
  })

  it('maps sub-account transfer type 2 (out to master) to withdrawal', async () => {
    setupAccountsQuery([makeAccount('binance')])
    mockBinanceSapiGetSubAccountTransferSubUserHistory.mockImplementation(
      ({ type }: { type: number }) => {
        if (type === 2) return Promise.resolve([{
          tranId: 'sub-2', asset: 'USDT', qty: '1500', time: '1700000000000', status: 'SUCCESS',
        }])
        return Promise.resolve([])
      }
    )

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    const rows = mockUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    const tx = rows.find(r => r.tx_id === 'subtransfer_sub-2')
    expect(tx!.type).toBe('withdrawal')
  })
})

describe('TransactionSyncer — upsert deduplication', () => {
  it('calls upsert with onConflict account_id,tx_id and ignoreDuplicates', async () => {
    setupAccountsQuery([makeAccount('bybit')])
    mockBybitPrivateGetV5AssetDepositQueryRecord.mockResolvedValue({
      result: {
        rows: [{ txID: 'dup-1', coin: 'USDT', amount: '100', depositFeeTime: '1700000000000' }],
      },
    })

    const syncer = new TransactionSyncer()
    await syncer.runAll()

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.any(Array),
      { onConflict: 'account_id,tx_id', ignoreDuplicates: true }
    )
  })
})

describe('TransactionSyncer — start/stop lifecycle', () => {
  it('start() fires after startup delay and stop() cancels it', () => {
    jest.useFakeTimers()
    const syncer = new TransactionSyncer()
    const spy = jest.spyOn(syncer, 'runAll').mockResolvedValue()

    syncer.start()
    // Should NOT run before 8-minute startup delay
    jest.advanceTimersByTime(7 * 60 * 1000)
    expect(spy).not.toHaveBeenCalled()

    // Should run after 8 minutes
    jest.advanceTimersByTime(2 * 60 * 1000)
    expect(spy).toHaveBeenCalledTimes(1)

    syncer.stop()
    jest.useRealTimers()
  })

  it('stop() before startup fires prevents runAll from being called', () => {
    jest.useFakeTimers()
    const syncer = new TransactionSyncer()
    const spy = jest.spyOn(syncer, 'runAll').mockResolvedValue()

    syncer.start()
    syncer.stop()
    jest.advanceTimersByTime(10 * 60 * 1000)
    expect(spy).not.toHaveBeenCalled()

    jest.useRealTimers()
  })
})
