describe('GET /api/sync/mexc/chunks', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 200 with totalChunks, chunkDays, and totalDays', async () => {
    const { GET } = await import('../chunks/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.totalChunks).toBe(1)
    expect(json.chunkDays).toBe(90)
    expect(json.totalDays).toBe(90)
  })

  it('totalChunks * chunkDays === totalDays', async () => {
    const { GET } = await import('../chunks/route')
    const res = await GET()
    const json = await res.json()

    expect(json.totalChunks * json.chunkDays).toBe(json.totalDays)
  })

  it('requires no auth or DB — pure computation', async () => {
    const { GET } = await import('../chunks/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(typeof json.totalChunks).toBe('number')
    expect(typeof json.chunkDays).toBe('number')
    expect(typeof json.totalDays).toBe('number')
  })
})
