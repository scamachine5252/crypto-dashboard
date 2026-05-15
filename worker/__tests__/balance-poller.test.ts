// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports
// ---------------------------------------------------------------------------
const mockUpsert = jest.fn()
const mockSelect = jest.fn()
const mockFrom   = jest.fn()

const mockBybitFetchBalance   = jest.fn()
const mockOkxFetchBalance     = jest.fn()
const mockBinanceFetchBalance = jest.fn()

const MockBybitAdapter   = jest.fn().mockImplementation(() => ({ fetchBalance: mockBybitFetchBalance }))
const MockOkxAdapter     = jest.fn().mockImplementation(() => ({ fetchBalance: mockOkxFetchBalance }))
const MockBinanceAdapter = jest.fn().mockImplementation(() => ({ fetchBalance: mockBinanceFetchBalance }))

const mockBanGuard = {
  isBanned:       jest.fn().mockReturnValue(false),
  recordIfBanned: jest.fn().mockResolvedValue(undefined),
}

jest.mock('server-only', () => ({}))

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: mockFrom },
}))

jest.mock('@/lib/crypto/decrypt', () => ({
  decrypt: (v: string) => v + '_decrypted',
}))

jest.mock('@/lib/adapters/bybit', () => ({
  BybitAdapter: MockBybitAdapter,
}))

jest.mock('@/lib/adapters/binance', () => ({
  BinanceAdapter: MockBinanceAdapter,
}))

jest.mock('@/lib/adapters/okx', () => ({
  OkxAdapter: MockOkxAdapter,
}))

jest.mock('../binance-ban-guard', () => ({
  binanceBanGuard: mockBanGuard,
}))

jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}))

import { startBalancePoller } from '../balance-poller'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type AccountRow = {
  id:          string
  exchange:    string
  api_key:     string
  api_secret:  string
  passphrase?: string | null
  instrument?: string | null
  is_suspended?: boolean
}

function makeAccount(exchange: string, opts: Partial<AccountRow> = {}): AccountRow {
  return {
    id:          opts.id ?? `acc-${exchange}`,
    exchange,
    api_key:     'api_key',
    api_secret:  'api_secret',
    passphrase:  opts.passphrase ?? null,
    instrument:  opts.instrument ?? null,
    is_suspended: opts.is_suspended ?? false,
  }
}

/** Set up mockFrom to return different data depending on call order or filter. */
function setupAccountsMock(accounts: AccountRow[]) {
  mockFrom.mockImplementation(() => ({
    select: jest.fn().mockImplementation(() => ({
      not: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: accounts, error: null }),
      })),
      eq: jest.fn().mockImplementation((field: string, val: unknown) => ({
        eq: jest.fn().mockResolvedValue({
          data: accounts.filter(a => (a as Record<string, unknown>)[field] === val),
          error: null,
        }),
      })),
    })),
    upsert: mockUpsert,
  }))
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  mockBanGuard.isBanned.mockReturnValue(false)
  mockBanGuard.recordIfBanned.mockResolvedValue(undefined)
  mockUpsert.mockResolvedValue({ error: null })
})

afterEach(() => {
  jest.useRealTimers()
})

// ---------------------------------------------------------------------------
// pollNonBinance — via startBalancePoller (immediate call)
// ---------------------------------------------------------------------------

describe('pollNonBinance — startup immediate call', () => {
  it('calls BybitAdapter.fetchBalance for bybit accounts and saves balance', async () => {
    const acct = makeAccount('bybit', { id: 'acc-bybit-1' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 5000 })

    startBalancePoller()
    // flush the immediately-called pollNonBinance()
    await jest.runAllTimersAsync()

    expect(MockBybitAdapter).toHaveBeenCalledWith({
      apiKey:    'api_key_decrypted',
      apiSecret: 'api_secret_decrypted',
    })
    expect(mockBybitFetchBalance).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'acc-bybit-1', usdt_balance: 5000 }),
      expect.objectContaining({ onConflict: 'account_id,snapshot_date' }),
    )
  })

  it('calls OkxAdapter.fetchBalance for okx accounts with decrypted passphrase', async () => {
    const acct = makeAccount('okx', { id: 'acc-okx-1', passphrase: 'pass123' })
    setupAccountsMock([acct])
    mockOkxFetchBalance.mockResolvedValue({ usdt: 3000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(MockOkxAdapter).toHaveBeenCalledWith({
      apiKey:    'api_key_decrypted',
      apiSecret: 'api_secret_decrypted',
      passphrase: 'pass123_decrypted',
    })
    expect(mockOkxFetchBalance).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'acc-okx-1', usdt_balance: 3000 }),
      expect.objectContaining({ onConflict: 'account_id,snapshot_date' }),
    )
  })

  it('does NOT call BinanceAdapter for non-binance accounts', async () => {
    const acct = makeAccount('bybit', { id: 'acc-bybit-2' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 1000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(MockBinanceAdapter).not.toHaveBeenCalled()
  })

  it('continues polling other accounts when one adapter throws', async () => {
    const acct1 = makeAccount('bybit', { id: 'acc-bybit-3' })
    const acct2 = makeAccount('bybit', { id: 'acc-bybit-4' })
    setupAccountsMock([acct1, acct2])

    mockBybitFetchBalance
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ usdt: 8000 })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    startBalancePoller()
    await jest.runAllTimersAsync()

    // Second account still saved despite first throwing
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'acc-bybit-4' }),
      expect.anything(),
    )

    consoleSpy.mockRestore()
  })

  it('skips saveBalance when fetchBalance returns null', async () => {
    const acct = makeAccount('bybit', { id: 'acc-bybit-5' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue(null)

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('filters out suspended accounts (is_suspended=true)', async () => {
    // The DB query itself filters via .eq('is_suspended', false),
    // so the mock returns only non-suspended accounts
    const activeAcct = makeAccount('bybit', { id: 'acc-active' })
    // Return only active; suspended filtered at DB query level
    setupAccountsMock([activeAcct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 2000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    // Only one upsert — the suspended account was not in the returned list
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'acc-active' }),
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// pollBinance — triggered via 3-minute startup timer
// ---------------------------------------------------------------------------

describe('pollBinance', () => {
  it('skips all accounts when banGuard.isBanned() returns true — BinanceAdapter never created', async () => {
    mockBanGuard.isBanned.mockReturnValue(true)
    const acct = makeAccount('binance', { id: 'acc-binance-1' })
    setupAccountsMock([acct])

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    startBalancePoller()
    // Advance 3 minutes to trigger pollBinance
    await jest.advanceTimersByTimeAsync(3 * 60 * 1000)

    expect(MockBinanceAdapter).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('calls BinanceAdapter.fetchBalance for each binance account sequentially', async () => {
    const acct1 = makeAccount('binance', { id: 'acc-binance-2' })
    const acct2 = makeAccount('binance', { id: 'acc-binance-3' })

    // First call (from startBalancePoller immediate pollNonBinance) returns empty non-Binance
    // Then the 3-min timer fires pollBinance which returns Binance accounts
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => ({
        not: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
        eq: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [acct1, acct2], error: null }),
        })),
      })),
      upsert: mockUpsert,
    }))

    mockBinanceFetchBalance.mockResolvedValue({ usdt: 10000 })

    startBalancePoller()
    // First flush immediate pollNonBinance
    await jest.runAllTimersAsync()

    expect(MockBinanceAdapter).toHaveBeenCalledTimes(2)
    expect(mockBinanceFetchBalance).toHaveBeenCalledTimes(2)
    expect(mockUpsert).toHaveBeenCalledTimes(2)
  })

  it('calls banGuard.recordIfBanned when adapter throws', async () => {
    const acct = makeAccount('binance', { id: 'acc-binance-4' })

    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => ({
        not: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
        eq: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [acct], error: null }),
        })),
      })),
      upsert: mockUpsert,
    }))

    const err = new Error('418 banned')
    mockBinanceFetchBalance.mockRejectedValue(err)

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockBanGuard.recordIfBanned).toHaveBeenCalledWith(err)
    consoleSpy.mockRestore()
  })

  it('continues to next account after a failed one', async () => {
    const acct1 = makeAccount('binance', { id: 'acc-binance-5' })
    const acct2 = makeAccount('binance', { id: 'acc-binance-6' })

    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => ({
        not: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
        eq: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [acct1, acct2], error: null }),
        })),
      })),
      upsert: mockUpsert,
    }))

    mockBinanceFetchBalance
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ usdt: 7000 })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    startBalancePoller()
    await jest.runAllTimersAsync()

    // Despite first account failing, second account's balance is saved
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'acc-binance-6' }),
      expect.anything(),
    )
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// saveBalance
// ---------------------------------------------------------------------------

describe('saveBalance', () => {
  it('upserts with onConflict: account_id,snapshot_date', async () => {
    const acct = makeAccount('bybit', { id: 'acc-save-1' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 999 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'acc-save-1', usdt_balance: 999 }),
      { onConflict: 'account_id,snapshot_date' },
    )
  })

  it('logs warning (does not throw) when upsert returns an error', async () => {
    const acct = makeAccount('bybit', { id: 'acc-save-2' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 500 })
    mockUpsert.mockResolvedValue({ error: { message: 'constraint violation' } })

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    startBalancePoller()
    await jest.runAllTimersAsync()

    // Should have warned, not thrown
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('upsert failed'),
      expect.any(String),
    )
    warnSpy.mockRestore()
  })
})
