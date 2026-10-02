import Redis, { type RedisOptions } from 'ioredis'

const REDIS_BASE_RETRY_DELAY_MS = 500
export const REDIS_MAX_RETRY_DELAY_MS = 30_000

/** ioredis retryStrategy: exponential backoff 0.5s → 1s → 2s … capped at 30s; never gives up. */
export function redisRetryDelay(attempt: number): number {
  const exp = Math.min(Math.max(attempt, 1) - 1, 16)
  return Math.min(REDIS_BASE_RETRY_DELAY_MS * 2 ** exp, REDIS_MAX_RETRY_DELAY_MS)
}

/**
 * Creates an ioredis client with reconnect backoff and an 'error' listener that
 * logs once per outage (instead of ioredis' "Unhandled error event" on every attempt).
 */
export function createRedisClient(url: string, name: string, options: RedisOptions = {}): Redis {
  const client = new Redis(url, { ...options, retryStrategy: redisRetryDelay })
  let down = false

  client.on('error', (err: Error) => {
    if (down) return
    down = true
    console.error(`[redis:${name}] ${err.message} — reconnecting with backoff (max ${REDIS_MAX_RETRY_DELAY_MS / 1000}s)`)
  })
  client.on('ready', () => {
    if (down) console.log(`[redis:${name}] reconnected`)
    down = false
  })

  return client
}

const shared = new Map<string, Redis>()

/** One lazily-connected client per URL for short, non-blocking commands (locks etc.). Never use for BRPOP. */
export function getSharedRedis(url: string): Redis {
  let client = shared.get(url)
  if (!client) {
    client = createRedisClient(url, 'shared', { lazyConnect: true })
    shared.set(url, client)
  }
  return client
}
