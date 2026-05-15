// Supabase mock — must be set up before import
const mockRpc = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: mockRpc,
  },
}))

import { supabaseAdmin } from '@/lib/supabase/server'
const mockFrom = supabaseAdmin.from as jest.Mock

import { GET } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build timestamps relative to now */
function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}
function msFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

const MIN = 60_000
const HOUR = 60 * MIN

/**
 * Set up the two `from()` calls the route makes:
 *   1. worker_status  (single row)
 *   2. accounts       (list)
 * and the `rpc()` call for latest_fill_per_account.
 */
function setupMocks({
  workerStatus,
  accounts = [],
  lastFills = [],
  rpcError = null,
}: {
  workerStatus: Record<string, unknown> | null
  accounts?: Array<{ id: string; exchange: string; account_name: string }>
  lastFills?: Array<{ account_id: string; exec_time: string }>
  rpcError?: unknown
}) {
  // worker_status chain: .from('worker_status').select(...).eq(...).single()
  const wsSingle = jest.fn().mockResolvedValue({ data: workerStatus, error: null })
  const wsEq = jest.fn().mockReturnValue({ single: wsSingle })
  const wsSelect = jest.fn().mockReturnValue({ eq: wsEq })

  // accounts chain: .from('accounts').select(...).eq(...)  — resolves directly
  const accEq = jest.fn().mockResolvedValue({ data: accounts, error: null })
  const accSelect = jest.fn().mockReturnValue({ eq: accEq })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'worker_status') return { select: wsSelect }
    if (table === 'accounts') return { select: accSelect }
    return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }) }
  })

  mockRpc.mockResolvedValue({ data: rpcError ? null : lastFills, error: rpcError })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/worker-status', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns alive=true when last_heartbeat is <10 minutes ago', async () => {
    setupMocks({ workerStatus: { last_heartbeat: msAgo(5 * MIN), started_at: null, binance_ban_until: null } })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.worker.alive).toBe(true)
  })

  it('returns alive=false when last_heartbeat is >30 minutes ago', async () => {
    setupMocks({ workerStatus: { last_heartbeat: msAgo(45 * MIN), started_at: null, binance_ban_until: null } })
    const res = await GET()
    const body = await res.json()
    expect(body.worker.alive).toBe(false)
  })

  it('returns alive=false when worker_status row is absent (data: null)', async () => {
    setupMocks({ workerStatus: null })
    const res = await GET()
    const body = await res.json()
    expect(body.worker.alive).toBe(false)
  })

  it('returns binance.banned=true when binance_ban_until is in the future', async () => {
    setupMocks({
      workerStatus: {
        last_heartbeat: msAgo(5 * MIN),
        started_at: null,
        binance_ban_until: msFromNow(10 * MIN),
      },
    })
    const res = await GET()
    const body = await res.json()
    expect(body.binance.banned).toBe(true)
    expect(body.binance.ban_until).not.toBeNull()
  })

  it('returns binance.banned=false when binance_ban_until is in the past', async () => {
    setupMocks({
      workerStatus: {
        last_heartbeat: msAgo(5 * MIN),
        started_at: null,
        binance_ban_until: msAgo(5 * MIN),
      },
    })
    const res = await GET()
    const body = await res.json()
    expect(body.binance.banned).toBe(false)
    expect(body.binance.ban_until).toBeNull()
  })

  it('returns binance.banned=false when binance_ban_until is null', async () => {
    setupMocks({
      workerStatus: { last_heartbeat: msAgo(5 * MIN), started_at: null, binance_ban_until: null },
    })
    const res = await GET()
    const body = await res.json()
    expect(body.binance.banned).toBe(false)
    expect(body.binance.ban_until).toBeNull()
  })

  it('marks account stale=true when latest fill is >24h ago', async () => {
    const accounts = [{ id: 'acc-1', exchange: 'binance', account_name: 'Alpha' }]
    setupMocks({
      workerStatus: { last_heartbeat: msAgo(5 * MIN), started_at: null, binance_ban_until: null },
      accounts,
      lastFills: [{ account_id: 'acc-1', exec_time: msAgo(25 * HOUR) }],
    })
    const res = await GET()
    const body = await res.json()
    const acc = body.accounts.find((a: { id: string }) => a.id === 'acc-1')
    expect(acc.stale).toBe(true)
  })

  it('marks account stale=false when latest fill is recent (<1h ago)', async () => {
    const accounts = [{ id: 'acc-2', exchange: 'bybit', account_name: 'Beta' }]
    setupMocks({
      workerStatus: { last_heartbeat: msAgo(5 * MIN), started_at: null, binance_ban_until: null },
      accounts,
      lastFills: [{ account_id: 'acc-2', exec_time: msAgo(30 * MIN) }],
    })
    const res = await GET()
    const body = await res.json()
    const acc = body.accounts.find((a: { id: string }) => a.id === 'acc-2')
    expect(acc.stale).toBe(false)
  })

  it('marks account stale=true when account has no fills (not in RPC result)', async () => {
    const accounts = [{ id: 'acc-3', exchange: 'okx', account_name: 'Gamma' }]
    setupMocks({
      workerStatus: { last_heartbeat: msAgo(5 * MIN), started_at: null, binance_ban_until: null },
      accounts,
      lastFills: [], // no fills returned for acc-3
    })
    const res = await GET()
    const body = await res.json()
    const acc = body.accounts.find((a: { id: string }) => a.id === 'acc-3')
    expect(acc.stale).toBe(true)
    expect(acc.last_fill_at).toBeNull()
  })

  it('handles RPC error gracefully — does not return 500, all accounts get stale=true', async () => {
    const accounts = [
      { id: 'acc-4', exchange: 'binance', account_name: 'Delta' },
      { id: 'acc-5', exchange: 'bybit', account_name: 'Epsilon' },
    ]
    setupMocks({
      workerStatus: { last_heartbeat: msAgo(5 * MIN), started_at: null, binance_ban_until: null },
      accounts,
      rpcError: { message: 'function not found' },
    })
    const res = await GET()
    // Must not be a 500
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accounts).toHaveLength(2)
    // When RPC errors, lastFills is null → fillMap is empty → all accounts stale
    body.accounts.forEach((a: { stale: boolean }) => {
      expect(a.stale).toBe(true)
    })
  })
})
