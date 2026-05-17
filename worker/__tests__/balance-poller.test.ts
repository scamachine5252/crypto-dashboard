// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports
// ---------------------------------------------------------------------------
const mockRpc    = jest.fn()
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
  supabaseAdmin: {
    from: mockFrom,
    rpc:  mockRpc,
  },
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

/** Set up mockFrom to return accounts based on query filters. */
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
  }))
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  mockBanGuard.isBanned.mockReturnValue(false)
  mockBanGuard.recordIfBanned.mockResolvedValue(undefined)
  mockRpc.mockResolvedValue({ error: null })
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
    await jest.runAllTimersAsync()

    expect(MockBybitAdapter).toHaveBeenCalledWith({
      apiKey:    'api_key_decrypted',
      apiSecret: 'api_secret_decrypted',
    })
    expect(mockBybitFetchBalance).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id:        'acc-bybit-1',
      p_usdt_balance:      5000,
      p_total_equity_usdt: null,
    }))
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
    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id:   'acc-okx-1',
      p_usdt_balance: 3000,
    }))
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
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id: 'acc-bybit-4',
    }))

    consoleSpy.mockRestore()
  })

  it('skips saveBalance when fetchBalance returns null', async () => {
    const acct = makeAccount('bybit', { id: 'acc-bybit-5' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue(null)

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('filters out suspended accounts (is_suspended=true)', async () => {
    // The DB query itself filters via .eq('is_suspended', false),
    // so the mock returns only non-suspended accounts
    const activeAcct = makeAccount('bybit', { id: 'acc-active' })
    setupAccountsMock([activeAcct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 2000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    // Only one RPC call — the suspended account was not in the returned list
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id: 'acc-active',
    }))
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
    await jest.advanceTimersByTimeAsync(3 * 60 * 1000)

    expect(MockBinanceAdapter).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('calls BinanceAdapter.fetchBalance for each binance account sequentially', async () => {
    const acct1 = makeAccount('binance', { id: 'acc-binance-2' })
    const acct2 = makeAccount('binance', { id: 'acc-binance-3' })

    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => ({
        not: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
        eq: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [acct1, acct2], error: null }),
        })),
      })),
    }))

    mockBinanceFetchBalance.mockResolvedValue({ usdt: 10000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(MockBinanceAdapter).toHaveBeenCalledTimes(2)
    expect(mockBinanceFetchBalance).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenCalledTimes(2)
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
    }))

    mockBinanceFetchBalance
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ usdt: 7000 })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    startBalancePoller()
    await jest.runAllTimersAsync()

    // Despite first account failing, second account's balance is saved
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id: 'acc-binance-6',
    }))
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// saveBalance — RPC-based upsert
// ---------------------------------------------------------------------------

describe('saveBalance', () => {
  it('calls upsert_main_balance RPC with correct params', async () => {
    const acct = makeAccount('bybit', { id: 'acc-save-1' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 999 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id:        'acc-save-1',
      p_usdt_balance:      999,
      p_total_equity_usdt: null,
      p_recorded_at:       expect.any(String),
    }))
  })

  it('logs warning (does not throw) when RPC returns an error', async () => {
    const acct = makeAccount('bybit', { id: 'acc-save-2' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 500 })
    mockRpc.mockResolvedValue({ error: { message: 'function not found' } })

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('save failed'),
      expect.any(String),
    )
    warnSpy.mockRestore()
  })

  it('writes p_total_equity_usdt when adapter returns totalEquityUsdt (Bybit)', async () => {
    const acct = makeAccount('bybit', { id: 'acc-equity-bybit' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 1000, totalEquityUsdt: 85000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id:        'acc-equity-bybit',
      p_usdt_balance:      1000,
      p_total_equity_usdt: 85000,
    }))
  })

  it('writes p_total_equity_usdt: null when adapter returns no totalEquityUsdt', async () => {
    const acct = makeAccount('bybit', { id: 'acc-equity-null' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 5000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id:        'acc-equity-null',
      p_usdt_balance:      5000,
      p_total_equity_usdt: null,
    }))
  })

  it('writes p_total_equity_usdt when Binance adapter returns totalEquityUsdt', async () => {
    const acct = makeAccount('binance', { id: 'acc-equity-binance' })
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockImplementation(() => ({
        not: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
        eq: jest.fn().mockImplementation(() => ({
          eq: jest.fn().mockResolvedValue({ data: [acct], error: null }),
        })),
      })),
    }))
    mockBinanceFetchBalance.mockResolvedValue({ usdt: 200, totalEquityUsdt: 95000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_account_id:        'acc-equity-binance',
      p_usdt_balance:      200,
      p_total_equity_usdt: 95000,
    }))
  })
})

// ---------------------------------------------------------------------------
// Equity drop guard
// ---------------------------------------------------------------------------

describe('equity drop guard', () => {
  // Helper: re-apply mocks needed after jest.clearAllMocks() within a test
  function resetMocks(accounts: ReturnType<typeof makeAccount>[]) {
    mockRpc.mockResolvedValue({ error: null })
    mockBanGuard.isBanned.mockReturnValue(false)
    mockBanGuard.recordIfBanned.mockResolvedValue(undefined)
    setupAccountsMock(accounts)
  }

  it('allows first write when no prior cache entry exists', async () => {
    const acct = makeAccount('bybit', { id: 'acc-guard-first-write' })
    setupAccountsMock([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 500, totalEquityUsdt: 5000 })

    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_total_equity_usdt: 5000,
    }))
  })

  it('blocks anomalous drop (equity falls to <20% of cached value)', async () => {
    const acct = makeAccount('bybit', { id: 'acc-guard-drop-blocked' })
    setupAccountsMock([acct])
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // Phase 1: normal write — warms cache at 100_000
    mockBybitFetchBalance.mockResolvedValueOnce({ usdt: 500, totalEquityUsdt: 100_000 })
    startBalancePoller()
    await jest.runAllTimersAsync()
    expect(mockRpc).toHaveBeenCalledTimes(1)

    // Phase 2: adapter returns anomalous sub-wallet (1.5% of cached — clearly PM bug)
    jest.clearAllMocks()
    resetMocks([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 1500, totalEquityUsdt: 1500 })
    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('anomalous equity drop'))
    warnSpy.mockRestore()
  })

  it('allows zero through (real account closure / full withdrawal)', async () => {
    const acct = makeAccount('bybit', { id: 'acc-guard-closure' })
    setupAccountsMock([acct])

    // Phase 1: normal write — warms cache at 50_000
    mockBybitFetchBalance.mockResolvedValueOnce({ usdt: 50_000, totalEquityUsdt: 50_000 })
    startBalancePoller()
    await jest.runAllTimersAsync()

    // Phase 2: account emptied (legitimate withdrawal) — must write
    jest.clearAllMocks()
    resetMocks([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 0, totalEquityUsdt: 0 })
    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_usdt_balance:      0,
      p_total_equity_usdt: 0,
    }))
  })

  it('allows dramatic equity increase (e.g. large unrealized PnL)', async () => {
    const acct = makeAccount('bybit', { id: 'acc-guard-spike' })
    setupAccountsMock([acct])

    // Phase 1: warms cache at 50_000
    mockBybitFetchBalance.mockResolvedValueOnce({ usdt: 50_000, totalEquityUsdt: 50_000 })
    startBalancePoller()
    await jest.runAllTimersAsync()

    // Phase 2: 10x equity (large leveraged position in profit — valid data)
    jest.clearAllMocks()
    resetMocks([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 50_000, totalEquityUsdt: 500_000 })
    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_total_equity_usdt: 500_000,
    }))
  })

  it('allows drops above the 20% threshold (moderate loss is fine)', async () => {
    const acct = makeAccount('bybit', { id: 'acc-guard-mild-drop' })
    setupAccountsMock([acct])

    // Phase 1: warms cache at 100_000
    mockBybitFetchBalance.mockResolvedValueOnce({ usdt: 100_000, totalEquityUsdt: 100_000 })
    startBalancePoller()
    await jest.runAllTimersAsync()

    // Phase 2: drops to 25% of cached — above 20% threshold, should pass
    jest.clearAllMocks()
    resetMocks([acct])
    mockBybitFetchBalance.mockResolvedValue({ usdt: 25_000, totalEquityUsdt: 25_000 })
    startBalancePoller()
    await jest.runAllTimersAsync()

    expect(mockRpc).toHaveBeenCalledWith('upsert_main_balance', expect.objectContaining({
      p_total_equity_usdt: 25_000,
    }))
  })
})
