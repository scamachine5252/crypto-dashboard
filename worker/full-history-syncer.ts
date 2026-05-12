import 'server-only'
import Redis from 'ioredis'
import { supabaseAdmin } from '@/lib/supabase/server'

export type SyncJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface SyncJob {
  id:            string
  account_id:    string
  exchange:      string
  status:        SyncJobStatus
  current_step:  number
  total_steps:   number
  failed_items:  Array<{ symbol: string; error: string }>
  error_message: string | null
  started_at:    string | null
  completed_at:  string | null
}

const QUEUE_KEY    = 'fullscan:queue'
const LOCK_PREFIX  = 'fullscan:lock:'
const LOCK_TTL_SEC = 3600
const STUCK_MS     = 10 * 60 * 1000

export class FullHistorySyncer {
  private redis:      Redis
  private running:    boolean = false
  private appBaseUrl: string

  constructor(redisUrl: string, appBaseUrl = 'http://localhost:3000') {
    this.redis      = new Redis(redisUrl)
    this.appBaseUrl = appBaseUrl
  }

  // ── Public helpers ───────────────────────────────────────────────────────

  async enqueue(jobId: string): Promise<void> {
    await this.redis.lpush(QUEUE_KEY, jobId)
  }

  async acquireLock(accountId: string, jobId: string): Promise<boolean> {
    const result = await this.redis.set(
      `${LOCK_PREFIX}${accountId}`, jobId, 'EX', LOCK_TTL_SEC, 'NX',
    )
    return result === 'OK'
  }

  async releaseLock(accountId: string): Promise<void> {
    await this.redis.del(`${LOCK_PREFIX}${accountId}`)
  }

  // ── Recovery ────────────────────────────────────────────────────────────

  async recoverStuckJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STUCK_MS).toISOString()
    const { data: stuck } = await supabaseAdmin
      .from('full_sync_jobs')
      .select('id')
      .eq('status', 'processing')
      .lt('started_at', cutoff)

    if (!stuck || stuck.length === 0) return 0

    for (const job of stuck as Array<{ id: string }>) {
      await supabaseAdmin
        .from('full_sync_jobs')
        .update({ status: 'pending', started_at: null })
        .eq('id', job.id)
      await this.redis.lpush(QUEUE_KEY, job.id)
    }
    console.log(`[full-history-syncer] recovered ${stuck.length} stuck jobs`)
    return stuck.length
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.running = true
    await this.recoverStuckJobs()
    void this.processLoop()
  }

  stop(): void {
    this.running = false
    this.redis.disconnect()
  }

  // ── Queue consumer ───────────────────────────────────────────────────────

  private async processLoop(): Promise<void> {
    while (this.running) {
      const result = await this.redis.brpop(QUEUE_KEY, 5).catch(() => null)
      if (!result) continue
      const [, jobId] = result as [string, string]
      await this.processJob(jobId).catch((e) =>
        console.error('[full-history-syncer] processJob unhandled error:', e),
      )
    }
  }

  async processJob(jobId: string): Promise<void> {
    const { data: job, error } = await supabaseAdmin
      .from('full_sync_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (error || !job || (job as SyncJob).status !== 'pending') return

    const syncJob = job as SyncJob
    const locked  = await this.acquireLock(syncJob.account_id, jobId)
    if (!locked) {
      await this.redis.lpush(QUEUE_KEY, jobId)
      return
    }

    await supabaseAdmin
      .from('full_sync_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId)

    try {
      await this.runSync(syncJob)
      await supabaseAdmin
        .from('full_sync_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId)
      // accounts.last_full_sync_at and full_sync_failed_count are written by the
      // exchange-specific PATCH routes called inside syncBinance/syncChunked.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[full-history-syncer] sync failed:', message)
      await supabaseAdmin
        .from('full_sync_jobs')
        .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .eq('id', jobId)
    } finally {
      await this.releaseLock(syncJob.account_id)
    }
  }

  // ── Sync orchestration ───────────────────────────────────────────────────

  private async runSync(job: SyncJob): Promise<void> {
    const base = this.appBaseUrl

    if (job.exchange === 'binance') {
      await this.syncBinance(job, base)
    } else if (['bybit', 'okx', 'mexc'].includes(job.exchange)) {
      await this.syncChunked(job, base)
    } else {
      throw new Error(`Unsupported exchange: ${job.exchange}`)
    }

    await fetch(`${base}/api/sync/reconstruct`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ account_id: job.account_id }),
    })
  }

  private async syncBinance(job: SyncJob, base: string): Promise<void> {
    const discoverRes = await fetch(`${base}/api/sync/binance/discover`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ account_id: job.account_id }),
    })
    if (!discoverRes.ok) {
      const body = await discoverRes.json().catch(() => ({})) as { error?: string }
      throw new Error(`discover failed (${discoverRes.status}): ${body.error ?? ''}`)
    }
    const { symbols } = await discoverRes.json() as {
      symbols: Array<{ rawSymbol: string; weekIndices: number[] }>
    }

    await this.updateProgress(job.id, { total_steps: symbols.length })

    const allFailed: Array<{ symbol: string; error: string }> = []
    for (let i = 0; i < symbols.length; i++) {
      const { rawSymbol, weekIndices } = symbols[i]
      const res = await fetch(`${base}/api/sync/binance/full`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ account_id: job.account_id, symbol: rawSymbol, weeks: weekIndices }),
      })
      if (res.ok) {
        const data = await res.json() as { failedSymbols: Array<{ symbol: string; error: string }> }
        allFailed.push(...data.failedSymbols)
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        allFailed.push({ symbol: rawSymbol, error: body.error ?? `HTTP ${res.status}` })
      }
      await this.updateProgress(job.id, { current_step: i + 1, failed_items: allFailed })
    }

    await fetch(`${base}/api/sync/binance/full`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ account_id: job.account_id, failed_count: allFailed.length }),
    })
  }

  private async syncChunked(job: SyncJob, base: string): Promise<void> {
    const chunksRes = await fetch(`${base}/api/sync/${job.exchange}/chunks`)
    if (!chunksRes.ok) throw new Error(`chunks failed: ${chunksRes.status}`)
    const { totalChunks } = await chunksRes.json() as { totalChunks: number }

    await this.updateProgress(job.id, { total_steps: totalChunks })

    const allFailed: Array<{ symbol: string; error: string }> = []
    const refTs = Date.now()
    let inheritedState: Record<string, unknown> | undefined

    for (let i = 0; i < totalChunks; i++) {
      const res = await fetch(`${base}/api/sync/${job.exchange}/full`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          account_id:          job.account_id,
          chunk_index:         i,
          inherited_state:     inheritedState,
          reference_timestamp: refTs,
        }),
      })
      if (res.ok) {
        const data = await res.json() as {
          failedCategories?: Array<{ symbol: string; error: string }>
          final_state?:      Record<string, unknown>
        }
        allFailed.push(...(data.failedCategories ?? []))
        if (data.final_state) inheritedState = data.final_state
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string }
        allFailed.push({ symbol: `chunk-${i}`, error: body.error ?? `HTTP ${res.status}` })
      }
      await this.updateProgress(job.id, { current_step: i + 1, failed_items: allFailed })
    }

    await fetch(`${base}/api/sync/${job.exchange}/full`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ account_id: job.account_id, failed_count: allFailed.length }),
    })
  }

  private async updateProgress(
    jobId: string,
    patch: { current_step?: number; total_steps?: number; failed_items?: Array<{ symbol: string; error: string }> },
  ): Promise<void> {
    await supabaseAdmin.from('full_sync_jobs').update(patch).eq('id', jobId)
  }
}
