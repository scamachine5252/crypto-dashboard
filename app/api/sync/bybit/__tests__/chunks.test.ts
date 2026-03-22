import { NextRequest } from 'next/server'

describe('GET /api/sync/bybit/chunks', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 200 with totalChunks, chunkDays, and totalDays', async () => {
    const { GET } = await import('../chunks/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.totalChunks).toBe(26)
    expect(json.chunkDays).toBe(7)
    expect(json.totalDays).toBe(182)
  })

  it('totalChunks * chunkDays === totalDays', async () => {
    const { GET } = await import('../chunks/route')
    const res = await GET()
    const json = await res.json()

    expect(json.totalChunks * json.chunkDays).toBe(json.totalDays)
  })

  it('requires no auth or DB — pure computation', async () => {
    // This test confirms the endpoint returns a valid response with no external deps
    const { GET } = await import('../chunks/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.totalChunks).toBe('number')
    expect(typeof json.chunkDays).toBe('number')
    expect(typeof json.totalDays).toBe('number')
  })
})
