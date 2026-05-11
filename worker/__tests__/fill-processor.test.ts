// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockSet      = jest.fn()
const mockDel      = jest.fn()
const mockUpsert   = jest.fn()

// Pipeline mock: exec() returns [[null, result], ...] per ioredis convention
const mockPipelineSet  = jest.fn()
const mockPipelineExec = jest.fn()
const mockPipelineDel  = jest.fn()

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set:      mockSet,
    del:      mockDel,
    pipeline: jest.fn(() => ({
      set:  mockPipelineSet,
      del:  mockPipelineDel,
      exec: mockPipelineExec,
    })),
  }))
})

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({ upsert: mockUpsert })),
  },
}))

import Redis from 'ioredis'
import { FillProcessor, type RawFill } from '../fill-processor'

function makeFill(overrides: Partial<RawFill> = {}): RawFill {
  return {
    account_id:  'acc-1',
    exchange:    'bybit',
    exec_id:     'order1_1234567890000_0.1',
    symbol:      'BTCUSDT',
    exec_time:   new Date('2025-01-01T00:00:00.000Z'),
    side:        'Buy',
    exec_qty:    0.1,
    exec_price:  50000,
    exec_pnl:    null,
    exec_fee:    0.5,
    raw_data:    {},
    source:      'ws',
    ...overrides,
  }
}

describe('FillProcessor', () => {
  let redis: Redis
  let processor: FillProcessor

  beforeEach(() => {
    jest.clearAllMocks()
    redis = new Redis()
    processor = new FillProcessor(redis)
  })

  // ── store() ──────────────────────────────────────────────────────────────

  it('stores a new fill when Redis NX returns OK', async () => {
    mockSet.mockResolvedValue('OK')
    mockUpsert.mockResolvedValue({ error: null })

    await processor.store(makeFill())

    expect(mockSet).toHaveBeenCalledWith(
      'fill:acc-1:bybit:order1_1234567890000_0.1',
      '1',
      'EX',
      86400,
      'NX',
    )
    expect(mockUpsert).toHaveBeenCalledTimes(1)
  })

  it('skips DB write when Redis NX returns null (duplicate)', async () => {
    mockSet.mockResolvedValue(null)

    await processor.store(makeFill())

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('passes exec_time as ISO string to supabase', async () => {
    mockSet.mockResolvedValue('OK')
    mockUpsert.mockResolvedValue({ error: null })

    await processor.store(makeFill({ exec_time: new Date('2025-06-15T12:00:00.000Z') }))

    const upsertArg = mockUpsert.mock.calls[0][0]
    expect(upsertArg.exec_time).toBe('2025-06-15T12:00:00.000Z')
  })

  it('uses correct onConflict option for idempotency', async () => {
    mockSet.mockResolvedValue('OK')
    mockUpsert.mockResolvedValue({ error: null })

    await processor.store(makeFill())

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ exec_id: 'order1_1234567890000_0.1' }),
      { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true },
    )
  })

  it('throws and undoes Redis key when DB upsert fails', async () => {
    mockSet.mockResolvedValue('OK')
    mockDel.mockResolvedValue(1)
    mockUpsert.mockResolvedValue({ error: { message: 'constraint violation' } })

    await expect(processor.store(makeFill())).rejects.toThrow('constraint violation')
    expect(mockDel).toHaveBeenCalledWith('fill:acc-1:bybit:order1_1234567890000_0.1')
  })

  // ── storeBatch() ──────────────────────────────────────────────────────────

  it('storeBatch: uses pipeline for bulk Redis NX check', async () => {
    // All three pass NX: pipeline exec returns [[null,'OK'],[null,'OK'],[null,'OK']]
    mockPipelineSet.mockReturnValue({ set: mockPipelineSet, del: mockPipelineDel, exec: mockPipelineExec })
    mockPipelineExec.mockResolvedValue([[null, 'OK'], [null, 'OK'], [null, 'OK']])
    mockUpsert.mockResolvedValue({ error: null })

    const fills = [
      makeFill({ exec_id: 'id1' }),
      makeFill({ exec_id: 'id2' }),
      makeFill({ exec_id: 'id3' }),
    ]
    const inserted = await processor.storeBatch(fills)
    expect(inserted).toBe(3)
    // Single batch upsert, not one per fill
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const upsertRows = mockUpsert.mock.calls[0][0]
    expect(Array.isArray(upsertRows)).toBe(true)
    expect(upsertRows).toHaveLength(3)
  })

  it('storeBatch: skips duplicates (pipeline NX returns null)', async () => {
    // Middle fill is duplicate
    mockPipelineSet.mockReturnValue({ set: mockPipelineSet, del: mockPipelineDel, exec: mockPipelineExec })
    mockPipelineExec.mockResolvedValue([[null, 'OK'], [null, null], [null, 'OK']])
    mockUpsert.mockResolvedValue({ error: null })

    const fills = [
      makeFill({ exec_id: 'id1' }),
      makeFill({ exec_id: 'id2' }),
      makeFill({ exec_id: 'id3' }),
    ]
    const inserted = await processor.storeBatch(fills)
    expect(inserted).toBe(2)
    const upsertRows = mockUpsert.mock.calls[0][0]
    expect(upsertRows).toHaveLength(2)
    expect(upsertRows.map((r: { exec_id: string }) => r.exec_id)).toEqual(['id1', 'id3'])
  })

  it('storeBatch: returns 0 for empty input without touching Redis', async () => {
    const inserted = await processor.storeBatch([])
    expect(inserted).toBe(0)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockPipelineExec).not.toHaveBeenCalled()
  })

  it('storeBatch: returns 0 when all fills are duplicates', async () => {
    mockPipelineSet.mockReturnValue({ set: mockPipelineSet, del: mockPipelineDel, exec: mockPipelineExec })
    mockPipelineExec.mockResolvedValue([[null, null], [null, null]])
    const fills = [makeFill({ exec_id: 'dup1' }), makeFill({ exec_id: 'dup2' })]
    const inserted = await processor.storeBatch(fills)
    expect(inserted).toBe(0)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── Redis key format ─────────────────────────────────────────────────────

  it('builds Redis key as fill:{account_id}:{exchange}:{exec_id}', async () => {
    mockSet.mockResolvedValue('OK')
    mockUpsert.mockResolvedValue({ error: null })

    await processor.store(makeFill({
      account_id: 'uuid-abc',
      exchange:   'binance',
      exec_id:    '987654321',
    }))

    expect(mockSet.mock.calls[0][0]).toBe('fill:uuid-abc:binance:987654321')
  })
})
