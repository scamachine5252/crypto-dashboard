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

// Global fetch mock
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FullHistorySyncer', () => {
  let syncer: FullHistorySyncer

  beforeEach(() => {
    jest.clearAllMocks()
    syncer = new FullHistorySyncer('redis://localhost:6379', 'http://localhost:3000')
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

  // ── recoverStuckJobs ──────────────────────────────────────────────────────

  it('recoverStuckJobs resets stuck processing jobs and re-queues them', async () => {
    const mockEq  = jest.fn().mockReturnValue({ data: null, error: null })
    const mockLt  = jest.fn().mockResolvedValue({ data: [{ id: 'stuck-1' }, { id: 'stuck-2' }], error: null })
    const mockEq2 = jest.fn().mockReturnValue({ lt: mockLt })
    const mockSel = jest.fn().mockReturnValue({ eq: mockEq2 })
    const mockUpd = jest.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockImplementation((table: string) =>
      table === 'full_sync_jobs' ? { select: mockSel, update: mockUpd } : { select: mockSel },
    )
    mockLpush.mockResolvedValue(1)

    const count = await syncer.recoverStuckJobs()

    expect(count).toBe(2)
    expect(mockLpush).toHaveBeenCalledTimes(2)
    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'stuck-1')
    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'stuck-2')
  })

  it('recoverStuckJobs returns 0 when no stuck jobs', async () => {
    const mockLt  = jest.fn().mockResolvedValue({ data: [], error: null })
    const mockEq  = jest.fn().mockReturnValue({ lt: mockLt })
    const mockSel = jest.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ select: mockSel })

    const count = await syncer.recoverStuckJobs()
    expect(count).toBe(0)
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

  it('processJob runs bybit sync via HTTP and marks job completed', async () => {
    const job = makeJob({ exchange: 'bybit' })

    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        const single = jest.fn().mockResolvedValue({ data: job, error: null })
        const eq     = jest.fn().mockReturnValue({ single })
        return { select: jest.fn().mockReturnValue({ eq }) }
      }
      const eq  = jest.fn().mockResolvedValue({ error: null })
      return { update: jest.fn().mockReturnValue({ eq }) }
    })

    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockReconstruct.mockResolvedValue(undefined)

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ totalChunks: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ synced: 1, failedCategories: [], final_state: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })

    await syncer.processJob('job-1')

    const urls = (mockFetch.mock.calls as unknown[][]).map((c) => c[0] as string)
    expect(urls).toContain('http://localhost:3000/api/sync/bybit/chunks')
    expect(urls.every((u: string) => !u.includes('reconstruct'))).toBe(true)
    expect(mockReconstruct).toHaveBeenCalledWith('acc-1', 'bybit')
    expect(mockDel).toHaveBeenCalledWith('fullscan:lock:acc-1')
  })

  it('processJob marks job failed and releases lock on error', async () => {
    const job = makeJob({ exchange: 'bybit' })

    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        const single = jest.fn().mockResolvedValue({ data: job, error: null })
        const eq     = jest.fn().mockReturnValue({ single })
        return { select: jest.fn().mockReturnValue({ eq }) }
      }
      const eq  = jest.fn().mockResolvedValue({ error: null })
      return { update: jest.fn().mockReturnValue({ eq }) }
    })
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'DB error' }) })

    await syncer.processJob('job-1')

    expect(mockDel).toHaveBeenCalledWith('fullscan:lock:acc-1')
  })

  it('processJob runs binance sync: discover → full per symbol → PATCH → reconstruct', async () => {
    const job = makeJob({ exchange: 'binance' })

    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        const single = jest.fn().mockResolvedValue({ data: job, error: null })
        const eq     = jest.fn().mockReturnValue({ single })
        return { select: jest.fn().mockReturnValue({ eq }) }
      }
      const eq  = jest.fn().mockResolvedValue({ error: null })
      return { update: jest.fn().mockReturnValue({ eq }) }
    })
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockReconstruct.mockResolvedValue(undefined)

    mockFetch
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ symbols: [{ rawSymbol: 'BTCUSDT', weekIndices: [0, 1] }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ synced: 2, failedSymbols: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })

    await syncer.processJob('job-1')

    const urls = (mockFetch.mock.calls as unknown[][]).map((c) => c[0] as string)
    expect(urls).toContain('http://localhost:3000/api/sync/binance/discover')
    expect(urls).toContain('http://localhost:3000/api/sync/binance/full')
    expect(urls.every((u) => !u.includes('reconstruct'))).toBe(true)
    expect(mockReconstruct).toHaveBeenCalledWith('acc-1', 'binance')
  })

  it('processJob marks job failed when PositionReconstructor.reconstruct() throws', async () => {
    const job = makeJob({ exchange: 'bybit' })
    let fromCallCount = 0
    mockFrom.mockImplementation(() => {
      fromCallCount++
      if (fromCallCount === 1) {
        const single = jest.fn().mockResolvedValue({ data: job, error: null })
        const eq = jest.fn().mockReturnValue({ single })
        return { select: jest.fn().mockReturnValue({ eq }) }
      }
      const eq = jest.fn().mockResolvedValue({ error: null })
      return { update: jest.fn().mockReturnValue({ eq }) }
    })
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ totalChunks: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ fills: 1, failedCategories: [], final_state: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    mockReconstruct.mockRejectedValue(new Error('trades upsert error: connection timeout'))

    await syncer.processJob('job-1')

    expect(mockDel).toHaveBeenCalledWith('fullscan:lock:acc-1')
  })
})
