// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockSelectSingle = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single: mockSelectSingle })),
      })),
    })),
  },
}))

jest.mock('server-only', () => ({}))

import { GET } from '../route'
import { NextRequest } from 'next/server'

function makeRequest(jobId: string): NextRequest {
  return new NextRequest(`http://localhost/api/sync/job/${jobId}`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/sync/job/[jobId]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 404 when job not found', async () => {
    mockSelectSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })

    const res = await GET(makeRequest('bad-id'), { params: { jobId: 'bad-id' } })
    expect(res.status).toBe(404)
    const json = await res.json() as { error: string }
    expect(json.error).toBe('Job not found')
  })

  it('returns job data with status and progress', async () => {
    const job = {
      id:            'job-1',
      account_id:    'acc-1',
      exchange:      'binance',
      status:        'processing',
      current_step:  15,
      total_steps:   26,
      failed_items:  [],
      error_message: null,
      created_at:    '2025-01-01T00:00:00Z',
      started_at:    '2025-01-01T00:00:01Z',
      completed_at:  null,
    }
    mockSelectSingle.mockResolvedValue({ data: job, error: null })

    const res = await GET(makeRequest('job-1'), { params: { jobId: 'job-1' } })
    expect(res.status).toBe(200)
    const json = await res.json() as typeof job
    expect(json.status).toBe('processing')
    expect(json.current_step).toBe(15)
    expect(json.total_steps).toBe(26)
  })

  it('returns completed job with completed_at set', async () => {
    const job = {
      id:            'job-2',
      account_id:    'acc-1',
      exchange:      'bybit',
      status:        'completed',
      current_step:  26,
      total_steps:   26,
      failed_items:  [],
      error_message: null,
      created_at:    '2025-01-01T00:00:00Z',
      started_at:    '2025-01-01T00:00:01Z',
      completed_at:  '2025-01-01T00:05:00Z',
    }
    mockSelectSingle.mockResolvedValue({ data: job, error: null })

    const res = await GET(makeRequest('job-2'), { params: { jobId: 'job-2' } })
    expect(res.status).toBe(200)
    const json = await res.json() as typeof job
    expect(json.completed_at).toBe('2025-01-01T00:05:00Z')
  })
})
