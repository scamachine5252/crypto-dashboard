// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockUpdate = jest.fn()
const mockFrom   = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: { from: mockFrom },
}))
jest.mock('server-only', () => ({}))

import { BinanceBanGuard } from '../binance-ban-guard'

function makeGuard() {
  const g = new BinanceBanGuard()
  g.reset()
  return g
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFrom.mockReturnValue({ update: mockUpdate.mockReturnValue({ eq: jest.fn().mockReturnValue({ then: jest.fn() }) }) })
})

describe('BinanceBanGuard.recordIfBanned', () => {
  it('ignores errors without "banned until" message', async () => {
    const g = makeGuard()
    await g.recordIfBanned(new Error('rate limit exceeded'))
    expect(g.isBanned()).toBe(false)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('sets ban when error contains "banned until <ms>"', async () => {
    const g = makeGuard()
    const future = Date.now() + 60_000
    await g.recordIfBanned(new Error(`IP banned until ${future}`))
    expect(g.isBanned()).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('worker_status')
  })

  it('ignores suspiciously small timestamps (seconds not ms)', async () => {
    const g = makeGuard()
    const secondsTimestamp = Math.floor(Date.now() / 1000) + 3600  // looks like seconds
    await g.recordIfBanned(new Error(`IP banned until ${secondsTimestamp}`))
    expect(g.isBanned()).toBe(false)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('does not downgrade an existing ban to an earlier time', async () => {
    const g = makeGuard()
    const laterBan  = Date.now() + 120_000
    const earlierBan = Date.now() + 30_000

    await g.recordIfBanned(new Error(`IP banned until ${laterBan}`))
    const callCountAfterFirst = mockFrom.mock.calls.length

    await g.recordIfBanned(new Error(`IP banned until ${earlierBan}`))
    // Second call should not trigger another DB write
    expect(mockFrom.mock.calls.length).toBe(callCountAfterFirst)
  })

  it('accepts string errors as well as Error instances', async () => {
    const g = makeGuard()
    const future = Date.now() + 60_000
    await g.recordIfBanned(`IP banned until ${future}`)
    expect(g.isBanned()).toBe(true)
  })
})

describe('BinanceBanGuard.isBanned', () => {
  it('returns false before any ban is recorded', () => {
    const g = makeGuard()
    expect(g.isBanned()).toBe(false)
  })

  it('returns true while ban is active', async () => {
    const g = makeGuard()
    await g.recordIfBanned(new Error(`IP banned until ${Date.now() + 60_000}`))
    expect(g.isBanned()).toBe(true)
  })

  it('returns false after ban expiry', () => {
    const g = makeGuard()
    // Directly set an already-expired ban via a past timestamp trick:
    // recordIfBanned only accepts future timestamps (>1e12), so manipulate via reset + spy
    // Instead: record a ban, then simulate time passing by setting banUntilMs to past
    ;(g as unknown as { banUntilMs: number }).banUntilMs = Date.now() - 1
    expect(g.isBanned()).toBe(false)
  })
})

describe('BinanceBanGuard.reset', () => {
  it('clears ban state', async () => {
    const g = makeGuard()
    await g.recordIfBanned(new Error(`IP banned until ${Date.now() + 60_000}`))
    expect(g.isBanned()).toBe(true)
    g.reset()
    expect(g.isBanned()).toBe(false)
  })
})
