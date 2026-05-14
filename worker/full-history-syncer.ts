import 'server-only'
import Redis from 'ioredis'
import { supabaseAdmin } from '@/lib/supabase/server'
import { PositionReconstructor } from './position-reconstructor'
import { BybitAdapter, type ReconstructionStateJson, type RawExecution } from '@/lib/adapters/bybit'
import { BinanceAdapter, type RawFapiTrade } from '@/lib/adapters/binance'
import { OkxAdapter } from '@/lib/adapters/okx'
import { MexcAdapter } from '@/lib/adapters/mexc'
import { decrypt } from '@/lib/crypto/decrypt'
import type { Trade, DateRange } from '@/lib/types'

export type SyncJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface SyncJob {
  id:            string
  account_id:    string
  exchange:      string
  status:        SyncJobStatus
  current_step:  number
  total_steps:   number
  retry_count:   number
  retry_after:   string | null
  failed_items:  Array<{ symbol: string; error: string }>
  error_message: string | null
  started_at:    string | null
  completed_at:  string | null
}

interface AccountRow {
  id:         string
  api_key:    string
  api_secret: string
  passphrase: string | null
  instrument: string
}

const QUEUE_KEY    = 'fullscan:queue'
const LOCK_PREFIX  = 'fullscan:lock:'
const LOCK_TTL_SEC = 3600

const BYBIT_CHUNK_DAYS = 7
const BYBIT_CHUNKS     = 26
const OKX_CHUNK_DAYS   = 30
const OKX_CHUNKS       = 6

export class FullHistorySyncer {
  private redis:              Redis
  private running:            boolean = false
  private currentJobId:       string | null = null
  private currentAccountId:   string | null = null

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl)
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

  async recoverOnStartup(): Promise<void> {
    // Reset ALL processing jobs — worker just started, none can be legitimately processing
    const { data: processing } = await supabaseAdmin
      .from('full_sync_jobs')
      .select('id')
      .eq('status', 'processing')

    if (processing && processing.length > 0) {
      for (const job of processing as Array<{ id: string }>) {
        await supabaseAdmin
          .from('full_sync_jobs')
          .update({ status: 'pending', started_at: null })
          .eq('id', job.id)
        await this.redis.lpush(QUEUE_KEY, job.id)
      }
      console.log(`[full-history-syncer] reset ${processing.length} orphaned processing jobs`)
    }

    // Re-enqueue pending jobs — restore retry_after timers for deferred jobs
    const { data: pending } = await supabaseAdmin
      .from('full_sync_jobs')
      .select('id, retry_after')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (pending && pending.length > 0) {
      let immediate = 0
      let deferred  = 0
      for (const job of pending as Array<{ id: string; retry_after: string | null }>) {
        const retryAfterMs = job.retry_after ? new Date(job.retry_after).getTime() : 0
        const delayMs      = Math.max(0, retryAfterMs - Date.now())
        if (delayMs > 0) {
          setTimeout(() => {
            void this.redis.rpush(QUEUE_KEY, job.id)
              .catch(e => console.error('[full-history-syncer] deferred enqueue failed:', e))
          }, delayMs)
          deferred++
        } else {
          await this.redis.rpush(QUEUE_KEY, job.id)
          immediate++
        }
      }
      console.log(`[full-history-syncer] queued ${immediate} immediate + ${deferred} deferred pending jobs`)
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.running = true
    await this.recoverOnStartup()
    void this.processLoop()
  }

  stop(): void {
    this.running = false
    this.redis.disconnect()
  }

  async shutdown(): Promise<void> {
    this.running = false
    if (this.currentJobId && this.currentAccountId) {
      console.log(`[full-history-syncer] shutdown: resetting job ${this.currentJobId} to pending`)
      await supabaseAdmin
        .from('full_sync_jobs')
        .update({ status: 'pending', started_at: null })
        .eq('id', this.currentJobId)
      await this.releaseLock(this.currentAccountId)
    }
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

    // Respect crash-safe retry backoff: if retry_after is still in the future, defer
    if (syncJob.retry_after && new Date(syncJob.retry_after) > new Date()) {
      const delayMs = new Date(syncJob.retry_after).getTime() - Date.now()
      setTimeout(() => {
        void this.redis.rpush(QUEUE_KEY, jobId)
          .catch(e => console.error('[full-history-syncer] deferred re-enqueue failed:', e))
      }, delayMs)
      console.log(`[full-history-syncer] job ${jobId} deferred ${Math.round(delayMs / 60000)}min (retry_after)`)
      return
    }

    const locked  = await this.acquireLock(syncJob.account_id, jobId)
    if (!locked) {
      // Re-queue at tail (FIFO) and back off to avoid spinning against the lock holder
      await new Promise(r => setTimeout(r, 5000))
      await this.redis.rpush(QUEUE_KEY, jobId)
      return
    }

    await supabaseAdmin
      .from('full_sync_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId)

    this.currentJobId     = jobId
    this.currentAccountId = syncJob.account_id

    try {
      const { data: account } = await supabaseAdmin
        .from('accounts')
        .select('id, api_key, api_secret, passphrase, instrument')
        .eq('id', syncJob.account_id)
        .single()
      if (!account) throw new Error(`Account ${syncJob.account_id} not found`)

      await this.runSync(syncJob, account as AccountRow)
      await supabaseAdmin
        .from('full_sync_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[full-history-syncer] sync failed:', message)
      await supabaseAdmin
        .from('full_sync_jobs')
        .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .eq('id', jobId)
    } finally {
      this.currentJobId     = null
      this.currentAccountId = null
      await this.releaseLock(syncJob.account_id)
    }

    const { data: freshJob } = await supabaseAdmin
      .from('full_sync_jobs')
      .select('status, retry_count, failed_items')
      .eq('id', jobId)
      .single()

    if (freshJob) {
      const hasFailedItems = Array.isArray(freshJob.failed_items) && freshJob.failed_items.length > 0
      const shouldRetry = (freshJob.status === 'failed' || hasFailedItems) && freshJob.retry_count < 3

      if (shouldRetry) {
        // Preserve error context: append current error_message to failed_items history before clearing it.
        const existingItems = Array.isArray(freshJob.failed_items) ? freshJob.failed_items : []
        const { data: jobWithError } = await supabaseAdmin
          .from('full_sync_jobs')
          .select('error_message')
          .eq('id', jobId)
          .single()
        const errorEntry = jobWithError?.error_message
          ? [{ symbol: '_error', error: jobWithError.error_message, attempt: freshJob.retry_count + 1 }]
          : []
        const retryAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString()
        await supabaseAdmin
          .from('full_sync_jobs')
          .update({
            status:        'pending',
            started_at:    null,
            retry_count:   freshJob.retry_count + 1,
            retry_after:   retryAfter,
            failed_items:  [...existingItems, ...errorEntry],
            error_message: null,
          })
          .eq('id', jobId)
        // Also enqueue now — processJob will defer via retry_after check if picked up before the deadline
        setTimeout(() => {
          void this.redis.rpush(QUEUE_KEY, jobId)
            .catch(e => console.error('[full-history-syncer] retry enqueue failed:', e))
        }, 60 * 60 * 1000)
        console.log(`[full-history-syncer] job ${jobId} retry ${freshJob.retry_count + 1}/3 scheduled in 1h (persisted to DB)`)
      }
    }
  }

  // ── Sync orchestration ───────────────────────────────────────────────────

  private async runSync(job: SyncJob, account: AccountRow): Promise<void> {
    let failedCount = 0

    if (job.exchange === 'bybit') {
      failedCount = await this.syncBybitDirect(job, account)
    } else if (job.exchange === 'binance') {
      failedCount = await this.syncBinanceDirect(job, account)
    } else if (job.exchange === 'okx') {
      failedCount = await this.syncOkxDirect(job, account)
    } else if (job.exchange === 'mexc') {
      failedCount = await this.syncMexcDirect(job, account)
    } else {
      throw new Error(`Unsupported exchange: ${job.exchange}`)
    }

    const reconstructor = new PositionReconstructor()
    await reconstructor.reconstruct(job.account_id, job.exchange)

    const { error: updateErr } = await supabaseAdmin
      .from('accounts')
      .update({
        last_full_sync_at:      new Date().toISOString(),
        full_sync_failed_count: failedCount,
      })
      .eq('id', job.account_id)
    if (updateErr) console.warn(`[full-history-syncer] failed to update last_full_sync_at for ${job.account_id}:`, updateErr.message)
  }

  // ── Per-exchange sync ────────────────────────────────────────────────────

  private async syncBybitDirect(job: SyncJob, account: AccountRow): Promise<number> {
    const adapter = new BybitAdapter({
      apiKey:    decrypt(account.api_key),
      apiSecret: decrypt(account.api_secret),
    })

    const chunkMs = BYBIT_CHUNK_DAYS * 24 * 60 * 60 * 1000
    const refTs   = Date.now()
    await this.updateProgress(job.id, { total_steps: BYBIT_CHUNKS })

    const allFailed: Array<{ symbol: string; error: string }> = []
    let inheritedState: ReconstructionStateJson | undefined

    for (let i = 0; i < BYBIT_CHUNKS; i++) {
      const since = refTs - (BYBIT_CHUNKS - i) * chunkMs
      const until = since + chunkMs
      try {
        const { rawExecutions, finalState } = await adapter.getTradesForChunk(since, until, inheritedState)
        inheritedState = finalState

        const fillRows = rawExecutions.flatMap(({ category, executions }: { category: string; executions: RawExecution[] }) =>
          executions.map((exec: RawExecution) => ({
            account_id:   job.account_id,
            exchange:     'bybit',
            exec_id:      `${exec.orderId}_${exec.execTime}_${exec.execQty}`,
            symbol:       exec.symbol,
            category,
            exec_time:    new Date(Number(exec.execTime)).toISOString(),
            side:         exec.side,
            exec_qty:     Number(exec.execQty),
            exec_price:   Number(exec.execPrice),
            exec_pnl:     Number(exec.execPnl) || null,
            exec_fee:     Math.abs(Number(exec.execFee)),
            closed_size:  Number(exec.closedSize),
            position_idx: exec.positionIdx ? Number(exec.positionIdx) : null,
            raw_data:     exec,
            source:       'rest' as const,
          }))
        )
        if (fillRows.length > 0) {
          const { error } = await supabaseAdmin
            .from('raw_fills')
            .upsert(fillRows, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })
          if (error) console.warn('[full-history-syncer] bybit raw_fills warning:', error.message)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        allFailed.push({ symbol: `chunk-${i}`, error: msg })
      }
      await this.updateProgress(job.id, { current_step: i + 1, failed_items: allFailed })
    }
    return allFailed.length
  }

  private async syncBinanceDirect(job: SyncJob, account: AccountRow): Promise<number> {
    const adapter = new BinanceAdapter({
      apiKey:           decrypt(account.api_key),
      apiSecret:        decrypt(account.api_secret),
      portfolioMargin:  account.instrument === 'portfolio_margin',
    })

    const symbols = await adapter.discoverTradedSymbols()
    await this.updateProgress(job.id, { total_steps: symbols.length })

    const allFailed: Array<{ symbol: string; error: string }> = []

    for (let i = 0; i < symbols.length; i++) {
      const { rawSymbol, weekIndices } = symbols[i]
      try {
        const { rawFills, failedSymbols } = await adapter.getFullTrades(rawSymbol, weekIndices)
        allFailed.push(...failedSymbols)

        if (rawFills.length > 0) {
          const fillRows = rawFills.map((fill: RawFapiTrade) => ({
            account_id:   job.account_id,
            exchange:     'binance',
            exec_id:      String(fill.id),
            symbol:       fill.symbol,
            category:     fill.positionSide,
            exec_time:    new Date(Number(fill.time)).toISOString(),
            side:         fill.side,
            exec_qty:     Number(fill.qty),
            exec_price:   Number(fill.price),
            exec_pnl:     Number(fill.realizedPnl) || null,
            exec_fee:     Math.abs(Number(fill.commission)),
            closed_size:  null,
            position_idx: null,
            raw_data:     fill,
            source:       'rest' as const,
          }))
          const { error } = await supabaseAdmin
            .from('raw_fills')
            .upsert(fillRows, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })
          if (error) console.warn('[full-history-syncer] binance raw_fills warning:', error.message)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        allFailed.push({ symbol: rawSymbol, error: msg })
      }
      await this.updateProgress(job.id, { current_step: i + 1, failed_items: allFailed })
    }
    return allFailed.length
  }

  private async syncOkxDirect(job: SyncJob, account: AccountRow): Promise<number> {
    const adapter = new OkxAdapter({
      apiKey:     decrypt(account.api_key),
      apiSecret:  decrypt(account.api_secret),
      passphrase: account.passphrase ? decrypt(account.passphrase) : '',
    })

    const chunkMs = OKX_CHUNK_DAYS * 24 * 60 * 60 * 1000
    const refTs   = Date.now()
    await this.updateProgress(job.id, { total_steps: OKX_CHUNKS })

    const allFailed: Array<{ symbol: string; error: string }> = []

    for (let i = 0; i < OKX_CHUNKS; i++) {
      const since = refTs - (OKX_CHUNKS - i) * chunkMs
      const until = since + chunkMs
      try {
        const trades = await adapter.getTrades('', {} as DateRange, since, 1000, until)
        if (trades.length > 0) {
          const fillRows = trades.map((t: Trade) => ({
            account_id:   job.account_id,
            exchange:     'okx',
            exec_id:      t.id,
            symbol:       t.symbol,
            category:     t.tradeType,
            exec_time:    t.closedAt,
            side:         t.side === 'long' ? 'buy' : 'sell',
            exec_qty:     t.quantity,
            exec_price:   t.exitPrice,
            exec_pnl:     t.pnl || null,
            exec_fee:     Math.abs(t.fee),
            closed_size:  null,
            position_idx: null,
            raw_data:     t,
            source:       'rest' as const,
          }))
          const { error } = await supabaseAdmin
            .from('raw_fills')
            .upsert(fillRows, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })
          if (error) console.warn('[full-history-syncer] okx raw_fills warning:', error.message)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        allFailed.push({ symbol: `chunk-${i}`, error: msg })
      }
      await this.updateProgress(job.id, { current_step: i + 1, failed_items: allFailed })
    }
    return allFailed.length
  }

  private async syncMexcDirect(job: SyncJob, account: AccountRow): Promise<number> {
    const adapter = new MexcAdapter({
      apiKey:    decrypt(account.api_key),
      apiSecret: decrypt(account.api_secret),
    })

    const since = Date.now() - 90 * 24 * 60 * 60 * 1000
    await this.updateProgress(job.id, { total_steps: 1 })

    const allFailed: Array<{ symbol: string; error: string }> = []

    try {
      const trades = await adapter.getTrades('', {} as DateRange, since, 1000, Date.now())
      if (trades.length > 0) {
        const fillRows = trades.map((t: Trade) => ({
          account_id:   job.account_id,
          exchange:     'mexc',
          exec_id:      t.id,
          symbol:       t.symbol,
          category:     t.tradeType,
          exec_time:    t.closedAt,
          side:         t.side === 'long' ? 'buy' : 'sell',
          exec_qty:     t.quantity,
          exec_price:   t.exitPrice,
          exec_pnl:     t.pnl,
          exec_fee:     Math.abs(t.fee),
          closed_size:  null,
          position_idx: null,
          raw_data:     t,
          source:       'rest' as const,
        }))
        const { error } = await supabaseAdmin
          .from('raw_fills')
          .upsert(fillRows, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })
        if (error) console.warn('[full-history-syncer] mexc raw_fills warning:', error.message)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[full-history-syncer] mexc sync failed:', msg)
      allFailed.push({ symbol: 'mexc', error: msg })
    }

    await this.updateProgress(job.id, { current_step: 1, failed_items: allFailed })
    return allFailed.length
  }

  private async updateProgress(
    jobId: string,
    patch: { current_step?: number; total_steps?: number; failed_items?: Array<{ symbol: string; error: string }> },
  ): Promise<void> {
    await supabaseAdmin.from('full_sync_jobs').update(patch).eq('id', jobId)
  }
}
