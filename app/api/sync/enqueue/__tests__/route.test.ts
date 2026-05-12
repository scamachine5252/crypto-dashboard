// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockSelectSingle = jest.fn()
const mockInsertSingle = jest.fn()
const mockLpush        = jest.fn()
const mockGet          = jest.fn()
const mockSet          = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'accounts') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({ single: mockSelectSingle })),
          })),
        }
      }
      // full_sync_jobs
      return {
        insert: jest.fn(() => ({
          select: jest.fn(() => ({ single: mockInsertSingle })),
        })),
      }
    }),
  },
}))

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    lpush: mockLpush,
    get:   mockGet,
    set:   mockSet,
  })),
)

jest.mock('server-only', () => ({}))

import { POST } from '../route'
import { NextRequest } from 'next/server'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sync/enqueue', {
    method:  'POST',
    body:    JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/sync/enqueue', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 400 when account_id is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('account_id required')
  })

  it('returns 404 when account not found', async () => {
    mockSelectSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })
    mockGet.mockResolvedValue(null)

    const res = await POST(makeRequest({ account_id: 'bad-id' }))
    expect(res.status).toBe(404)
  })

  it('returns 409 when sync already in progress (lock held)', async () => {
    mockSelectSingle.mockResolvedValue({ data: { id: 'acc-1', exchange: 'bybit' }, error: null })
    mockGet.mockResolvedValue('existing-job-id')

    const res = await POST(makeRequest({ account_id: 'acc-1' }))
    expect(res.status).toBe(409)
    const json = await res.json() as { error: string; jobId: string }
    expect(json.error).toBe('sync_in_progress')
    expect(json.jobId).toBe('existing-job-id')
  })

  it('creates job in DB, pushes to Redis queue, returns jobId', async () => {
    mockSelectSingle.mockResolvedValue({ data: { id: 'acc-1', exchange: 'binance' }, error: null })
    mockGet.mockResolvedValue(null)
    mockInsertSingle.mockResolvedValue({ data: { id: 'new-job-id' }, error: null })
    mockLpush.mockResolvedValue(1)

    const res = await POST(makeRequest({ account_id: 'acc-1' }))

    expect(res.status).toBe(200)
    const json = await res.json() as { jobId: string }
    expect(json.jobId).toBe('new-job-id')
    expect(mockLpush).toHaveBeenCalledWith('fullscan:queue', 'new-job-id')
  })

  it('returns 500 if DB insert fails', async () => {
    mockSelectSingle.mockResolvedValue({ data: { id: 'acc-1', exchange: 'bybit' }, error: null })
    mockGet.mockResolvedValue(null)
    mockInsertSingle.mockResolvedValue({ data: null, error: { message: 'constraint' } })

    const res = await POST(makeRequest({ account_id: 'acc-1' }))
    expect(res.status).toBe(500)
    expect(mockLpush).not.toHaveBeenCalled()
  })
})
