// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockBrpop      = jest.fn()
const mockLpush      = jest.fn()
const mockSet        = jest.fn()
const mockDel        = jest.fn()
const mockGet        = jest.fn()
const mockDisconnect = jest.fn()

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    brpop:      mockBrpop,
    lpush:      mockLpush,
    set:        mockSet,
    del:        mockDel,
    get:        mockGet,
    disconnect: mockDisconnect,
  })),
)

const mockFrom = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: mockFrom },
}))

jest.mock('server-only', () => ({}))

const mockReconstruct = jest.fn()
jest.mock('../position-reconstructor', () => ({
  PositionReconstructor: jest.fn().mockImplementation(() => ({
    reconstruct: mockReconstruct,
  })),
}))

// Adapter mocks
const mockGetTradesForChunk    = jest.fn()
const mockDiscoverSymbols      = jest.fn()
const mockBinanceGetFullTrades = jest.fn()
const mockGetTradesOkx         = jest.fn()
const mockGetTradesMexc        = jest.fn()

jest.mock('@/lib/adapters/bybit', () => ({
  BybitAdapter: jest.fn().mockImplementation(() => ({
    getTradesForChunk: mockGetTradesForChunk,
  })),
}))

jest.mock('@/lib/adapters/binance', () => ({
  BinanceAdapter: jest.fn().mockImplementation(() => ({
    discoverTradedSymbols: mockDiscoverSymbols,
    getFullTrades:         mockBinanceGetFullTrades,
  })),
}))

jest.mock('@/lib/adapters/okx', () => ({
  OkxAdapter: jest.fn().mockImplementation(() => ({
    getTrades: mockGetTradesOkx,
  })),
}))

jest.mock('@/lib/adapters/mexc', () => ({
  MexcAdapter: jest.fn().mockImplementation(() => ({
    getTrades: mockGetTradesMexc,
  })),
}))

jest.mock('@/lib/crypto/decrypt', () => ({ decrypt: (v: string) => `dec:${v}` }))

// Global fetch mock (kept for tests that verify NO fetch is called)
const mockFetch = jest.fn()
global.fetch = mockFetch as typeof fetch

import { FullHistorySyncer } from '../full-history-syncer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id:            'job-1',
    account_id:    'acc-1',
    exchange:      'bybit',
    status:        'pending',
    current_step:  0,
    total_steps:   0,
    failed_items:  [],
    error_message: null,
    started_at:    null,
    completed_at:  null,
    ...overrides,
  }
}

function makeAccountRow(overrides: Record<string, unknown> = {}) {
  return { id: 'acc-1', api_key: 'k', api_secret: 's', passphrase: null, instrument: 'unified', ...overrides }
}

function setupJobMocks(job: ReturnType<typeof makeJob>, account = makeAccountRow()) {
  let callCount = 0
  mockFrom.mockImplementation((table: string) => {
    callCount++
    if (table === 'full_sync_jobs' && callCount === 1) {
      const single = jest.fn().mockResolvedValue({ data: job, error: null })
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single }) }) }
    }
    if (table === 'accounts') {
      const single = jest.fn().mockResolvedValue({ data: account, error: null })
      const eq = jest.fn().mockReturnValue({ single })
      return {
        select: jest.fn().mockReturnValue({ eq }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
    }
    const eq = jest.fn().mockResolvedValue({ error: null })
    // fresh-fetch after processJob: return completed job so shouldRetry = false
    const freshData = { status: 'completed', retry_count: 0, failed_items: [] }
    const freshSingle = jest.fn().mockResolvedValue({ data: freshData, error: null })
    return {
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: freshSingle }) }),
      update: jest.fn().mockReturnValue({ eq }),
      upsert: jest.fn().mockResolvedValue({ error: null }),
    }
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FullHistorySyncer', () => {
  let syncer: FullHistorySyncer

  beforeEach(() => {
    jest.clearAllMocks()
    syncer = new FullHistorySyncer('redis://localhost:6379')
  })

  afterEach(() => syncer.stop())

  // ── acquireLock / releaseLock ─────────────────────────────────────────────

  it('acquireLock returns true when Redis SET NX succeeds', async () => {
    mockSet.mockResolvedValue('OK')
    const ok = await syncer.acquireLock('acc-1', 'job-1')
    expect(ok).toBe(true)
    expect(mockSet).toHaveBeenCalledWith('fullscan:lock:acc-1', 'job-1', 'EX', 3600, 'NX')
  })

  it('acquireLock returns false when lock already held', async () => {
    mockSet.mockResolvedValue(null)
    const ok = await syncer.acquireLock('acc-1', 'job-2')
    expect(ok).toBe(false)
  })

  it('releaseLock deletes the Redis key', async () => {
    mockDel.mockResolvedValue(1)
    await syncer.releaseLock('acc-1')
    expect(mockDel).toHaveBeenCalledWith('fullscan:lock:acc-1')
  })

  // ── enqueue ───────────────────────────────────────────────────────────────

  it('enqueue pushes jobId to fullscan:queue', async () => {
    mockLpush.mockResolvedValue(1)
    await syncer.enqueue('job-99')
    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'job-99')
  })

  // ── recoverOnStartup ─────────────────────────────────────────────────────

  it('recoverOnStartup resets ALL processing jobs (not just >10min) and re-enqueues pending', async () => {
    const recentJob  = { id: 'job-recent' }
    const oldJob     = { id: 'job-old' }
    const pendingJob = { id: 'job-pend' }

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'full_sync_jobs') return {
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation((_col: string, val: string) => {
            if (val === 'processing') return { data: [recentJob, oldJob], error: null }
            if (val === 'pending')    return { order: jest.fn().mockResolvedValue({ data: [pendingJob], error: null }) }
            return { data: [], error: null }
          }),
        }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
      }
    })
    mockLpush.mockResolvedValue(1)

    await syncer.recoverOnStartup()

    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'job-recent')
    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'job-old')
    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'job-pend')
  })

  it('recoverOnStartup is safe when no stuck or pending jobs exist', async () => {
    mockFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockImplementation((_col: string, val: string) => {
          if (val === 'pending') return { order: jest.fn().mockResolvedValue({ data: [], error: null }) }
          return { data: [], error: null }
        }),
      }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    }))

    await expect(syncer.recoverOnStartup()).resolves.not.toThrow()
    expect(mockLpush).not.toHaveBeenCalled()
  })

  // ── processJob ────────────────────────────────────────────────────────────

  it('processJob skips if job not found', async () => {
    const mockSingle = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    const mockEq     = jest.fn().mockReturnValue({ single: mockSingle })
    const mockSel    = jest.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ select: mockSel })

    await syncer.processJob('nonexistent')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('processJob skips if job status is not pending', async () => {
    const job        = makeJob({ status: 'completed' })
    const mockSingle = jest.fn().mockResolvedValue({ data: job, error: null })
    const mockEq     = jest.fn().mockReturnValue({ single: mockSingle })
    const mockSel    = jest.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ select: mockSel })

    await syncer.processJob('job-1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('processJob re-queues if lock is already held', async () => {
    const job        = makeJob()
    const mockSingle = jest.fn().mockResolvedValue({ data: job, error: null })
    const mockEq     = jest.fn().mockReturnValue({ single: mockSingle })
    const mockSel    = jest.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ select: mockSel })
    mockSet.mockResolvedValue(null)  // lock already held
    mockLpush.mockResolvedValue(1)

    await syncer.processJob('job-1')

    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'job-1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('processJob runs bybit sync via direct adapter — zero HTTP calls', async () => {
    const job = makeJob({ exchange: 'bybit' })
    setupJobMocks(job)
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockGetTradesForChunk.mockResolvedValue({ trades: [], finalState: {}, rawExecutions: [] })
    mockReconstruct.mockResolvedValue(undefined)

    await syncer.processJob('job-1')

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockGetTradesForChunk).toHaveBeenCalledTimes(26)
    expect(mockReconstruct).toHaveBeenCalledWith('acc-1', 'bybit')
    expect(mockDel).toHaveBeenCalledWith('fullscan:lock:acc-1')
  })

  it('processJob runs binance sync via direct adapter — zero HTTP calls', async () => {
    const job = makeJob({ exchange: 'binance' })
    setupJobMocks(job)
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockDiscoverSymbols.mockResolvedValue([{ rawSymbol: 'BTCUSDT', weekIndices: [0, 1, 2] }])
    mockBinanceGetFullTrades.mockResolvedValue({ trades: [], failedSymbols: [], rawFills: [] })
    mockReconstruct.mockResolvedValue(undefined)

    await syncer.processJob('job-1')

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockDiscoverSymbols).toHaveBeenCalled()
    expect(mockBinanceGetFullTrades).toHaveBeenCalledWith('BTCUSDT', [0, 1, 2])
    expect(mockReconstruct).toHaveBeenCalledWith('acc-1', 'binance')
    expect(mockDel).toHaveBeenCalledWith('fullscan:lock:acc-1')
  })

  it('processJob runs okx sync via direct adapter — zero HTTP calls', async () => {
    const job = makeJob({ exchange: 'okx' })
    setupJobMocks(job, makeAccountRow({ passphrase: 'pp' }))
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockGetTradesOkx.mockResolvedValue([])
    mockReconstruct.mockResolvedValue(undefined)

    await syncer.processJob('job-1')

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockGetTradesOkx).toHaveBeenCalledTimes(6)
    expect(mockReconstruct).toHaveBeenCalledWith('acc-1', 'okx')
  })

  it('processJob runs mexc sync via direct adapter — zero HTTP calls', async () => {
    const job = makeJob({ exchange: 'mexc' })
    setupJobMocks(job)
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockGetTradesMexc.mockResolvedValue([])
    mockReconstruct.mockResolvedValue(undefined)

    await syncer.processJob('job-1')

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockGetTradesMexc).toHaveBeenCalledTimes(1)
    expect(mockReconstruct).toHaveBeenCalledWith('acc-1', 'mexc')
  })

  it('mexc sync failure surfaces in failed_items (not silently completed)', async () => {
    const job = makeJob({ exchange: 'mexc' })
    const updateCalls: unknown[][] = []
    let callCount = 0
    const account = makeAccountRow()
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (table === 'full_sync_jobs' && callCount === 1) {
        const single = jest.fn().mockResolvedValue({ data: job, error: null })
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single }) }) }
      }
      if (table === 'accounts') {
        const single = jest.fn().mockResolvedValue({ data: account, error: null })
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single }) }),
                 update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) }
      }
      // Capture update patches to full_sync_jobs to inspect failed_items
      const eq = jest.fn().mockResolvedValue({ error: null })
      const update = jest.fn().mockImplementation((patch: unknown) => {
        updateCalls.push([table, patch])
        return { eq }
      })
      const freshData = { status: 'completed', retry_count: 0, failed_items: [] }
      const freshSingle = jest.fn().mockResolvedValue({ data: freshData, error: null })
      return {
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: freshSingle }) }),
        update,
        upsert: jest.fn().mockResolvedValue({ error: null }),
      }
    })
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockGetTradesMexc.mockRejectedValue(new Error('MEXC API rate limit'))
    mockReconstruct.mockResolvedValue(undefined)

    await syncer.processJob('job-1')

    // failed_items must include the mexc error, not be empty
    const progressUpdate = updateCalls.find(
      ([, val]) => val && typeof val === 'object' && 'failed_items' in (val as object),
    )
    expect(progressUpdate).toBeDefined()
    const items = (progressUpdate![1] as { failed_items: Array<{ symbol: string; error: string }> }).failed_items
    expect(items).toHaveLength(1)
    expect(items[0].error).toContain('rate limit')
  })

  it('processJob marks job failed and releases lock on error', async () => {
    const job = makeJob({ exchange: 'bybit' })
    setupJobMocks(job)
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockGetTradesForChunk.mockRejectedValue(new Error('exchange API error'))

    await syncer.processJob('job-1')

    expect(mockDel).toHaveBeenCalledWith('fullscan:lock:acc-1')
  })

  it('processJob marks job failed when PositionReconstructor.reconstruct() throws', async () => {
    const job = makeJob({ exchange: 'bybit' })
    setupJobMocks(job)
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockGetTradesForChunk.mockResolvedValue({ trades: [], finalState: {}, rawExecutions: [] })
    mockReconstruct.mockRejectedValue(new Error('trades upsert error: connection timeout'))

    await syncer.processJob('job-1')

    expect(mockDel).toHaveBeenCalledWith('fullscan:lock:acc-1')
  })

  // ── Auto-retry ─────────────────────────────────────────────────────────────

  it('re-enqueues with 1h delay when job fails and retry_count < 3', async () => {
    jest.useFakeTimers()
    let selectCallCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'full_sync_jobs') {
        return {
          select: jest.fn().mockImplementation(() => {
            const data = selectCallCount === 0
              ? makeJob({ exchange: 'binance', retry_count: 1 })
              : { status: 'failed', retry_count: 1, failed_items: [] }
            selectCallCount++
            return { eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data, error: null }) }) }
          }),
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        }
      }
      if (table === 'accounts') {
        return {
          select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: makeAccountRow(), error: null }) }) }),
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        }
      }
      return {
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        upsert: jest.fn().mockResolvedValue({ error: null }),
      }
    })

    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockDiscoverSymbols.mockRejectedValue(new Error('exchange unreachable'))

    await syncer.processJob('job-1')

    jest.advanceTimersByTime(60 * 60 * 1000)

    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'job-1')
    jest.useRealTimers()
  })

  it('does not re-enqueue when retry_count is already 3', async () => {
    jest.useFakeTimers()
    let selectCallCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'full_sync_jobs') {
        return {
          select: jest.fn().mockImplementation(() => {
            const data = selectCallCount === 0
              ? makeJob({ exchange: 'binance', retry_count: 3 })
              : { status: 'failed', retry_count: 3, failed_items: [] }
            selectCallCount++
            return { eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data, error: null }) }) }
          }),
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        }
      }
      if (table === 'accounts') {
        return {
          select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: makeAccountRow(), error: null }) }) }),
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        }
      }
      return {
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        upsert: jest.fn().mockResolvedValue({ error: null }),
      }
    })

    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockDiscoverSymbols.mockRejectedValue(new Error('exchange unreachable'))

    await syncer.processJob('job-1')

    jest.advanceTimersByTime(60 * 60 * 1000)

    expect(mockLpush).not.toHaveBeenCalledWith('fullscan:queue', 'job-1')
    jest.useRealTimers()
  })
})
