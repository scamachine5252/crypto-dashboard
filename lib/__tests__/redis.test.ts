/**
 * Redis client factory — reconnect backoff + log throttling.
 *
 * Regression: on every Redis restart the worker wrote thousands of
 * "[ioredis] Unhandled error event: ECONNREFUSED 127.0.0.1:6379" lines per second:
 * no 'error' listener, default retry capped at 2s, and a new (never closed)
 * connection per PositionReconstructor instance.
 */

type Handler = (arg?: unknown) => void

const mockInstances: Array<{ url: string; options: Record<string, unknown>; handlers: Record<string, Handler[]> }> = []

jest.mock('ioredis', () =>
  jest.fn().mockImplementation((url: string, options: Record<string, unknown>) => {
    const inst = {
      url,
      options,
      handlers: {} as Record<string, Handler[]>,
      on(event: string, fn: Handler) {
        ;(inst.handlers[event] ??= []).push(fn)
        return inst
      },
    }
    mockInstances.push(inst)
    return inst
  }),
)

import { redisRetryDelay, createRedisClient, getSharedRedis, REDIS_MAX_RETRY_DELAY_MS } from '@/lib/redis'

function emit(i: number, event: string, arg?: unknown): void {
  for (const fn of mockInstances[i].handlers[event] ?? []) fn(arg)
}

describe('redisRetryDelay', () => {
  it('starts at 500ms on the first attempt', () => {
    expect(redisRetryDelay(1)).toBe(500)
  })

  it('doubles on each attempt', () => {
    expect(redisRetryDelay(2)).toBe(1000)
    expect(redisRetryDelay(3)).toBe(2000)
    expect(redisRetryDelay(4)).toBe(4000)
  })

  it('is capped at REDIS_MAX_RETRY_DELAY_MS (30s)', () => {
    expect(REDIS_MAX_RETRY_DELAY_MS).toBe(30_000)
    expect(redisRetryDelay(7)).toBe(30_000)
    expect(redisRetryDelay(1000)).toBe(30_000) // no Infinity / overflow
  })

  it('treats zero / negative attempts as the first attempt', () => {
    expect(redisRetryDelay(0)).toBe(500)
    expect(redisRetryDelay(-3)).toBe(500)
  })

  it('never returns null (never gives up reconnecting)', () => {
    for (let n = 1; n <= 50; n++) expect(redisRetryDelay(n)).toBeGreaterThan(0)
  })
})

describe('createRedisClient', () => {
  let errSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    mockInstances.length = 0
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('passes the backoff retryStrategy to ioredis', () => {
    createRedisClient('redis://x:6379', 'test')
    expect(mockInstances[0].url).toBe('redis://x:6379')
    expect(mockInstances[0].options.retryStrategy).toBe(redisRetryDelay)
  })

  it('keeps caller options (e.g. lazyConnect)', () => {
    createRedisClient('redis://x:6379', 'test', { lazyConnect: true })
    expect(mockInstances[0].options.lazyConnect).toBe(true)
    expect(mockInstances[0].options.retryStrategy).toBe(redisRetryDelay)
  })

  it('registers an error listener (no "Unhandled error event")', () => {
    createRedisClient('redis://x:6379', 'test')
    expect(mockInstances[0].handlers.error?.length).toBe(1)
  })

  it('logs only the first error of an outage', () => {
    createRedisClient('redis://x:6379', 'test')
    for (let i = 0; i < 1000; i++) emit(0, 'error', new Error('connect ECONNREFUSED 127.0.0.1:6379'))
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(String(errSpy.mock.calls[0][0])).toContain('ECONNREFUSED')
    expect(String(errSpy.mock.calls[0][0])).toContain('[redis:test]')
  })

  it('logs recovery once and reports the next outage again', () => {
    createRedisClient('redis://x:6379', 'test')
    emit(0, 'error', new Error('down 1'))
    emit(0, 'error', new Error('down 1'))
    emit(0, 'ready')
    expect(logSpy).toHaveBeenCalledTimes(1)
    emit(0, 'error', new Error('down 2'))
    expect(errSpy).toHaveBeenCalledTimes(2)
  })

  it('does not log "reconnected" on the initial ready', () => {
    createRedisClient('redis://x:6379', 'test')
    emit(0, 'ready')
    expect(logSpy).not.toHaveBeenCalled()
  })
})

describe('getSharedRedis', () => {
  beforeEach(() => { mockInstances.length = 0 })

  it('returns the same connection for the same URL (no per-call leak)', () => {
    const a = getSharedRedis('redis://shared-a:6379')
    const b = getSharedRedis('redis://shared-a:6379')
    expect(a).toBe(b)
    expect(mockInstances).toHaveLength(1)
  })

  it('returns separate connections for different URLs', () => {
    const a = getSharedRedis('redis://shared-b:6379')
    const b = getSharedRedis('redis://shared-c:6379')
    expect(a).not.toBe(b)
  })

  it('creates the shared connection lazily with backoff', () => {
    getSharedRedis('redis://shared-d:6379')
    expect(mockInstances[0].options.lazyConnect).toBe(true)
    expect(mockInstances[0].options.retryStrategy).toBe(redisRetryDelay)
  })
})
