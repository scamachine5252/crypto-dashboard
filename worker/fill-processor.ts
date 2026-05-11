import type Redis from 'ioredis'
import { supabaseAdmin } from '@/lib/supabase/server'

export interface RawFill {
  account_id:   string
  exchange:     string
  exec_id:      string
  symbol:       string
  category?:    string
  exec_time:    Date
  side:         string
  exec_qty:     number
  exec_price:   number
  exec_pnl?:    number | null
  exec_fee?:    number
  closed_size?: number | null
  position_idx?: number | null
  raw_data:     unknown
  source:       'ws' | 'rest'
}

export class FillProcessor {
  private reconstructionTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private onReconstruct?: (accountId: string, exchange: string) => void

  constructor(
    private redis: Redis,
    opts?: { onReconstruct?: (accountId: string, exchange: string) => void },
  ) {
    this.onReconstruct = opts?.onReconstruct
  }

  async store(fill: RawFill): Promise<void> {
    const redisKey = `fill:${fill.account_id}:${fill.exchange}:${fill.exec_id}`
    const isNew = await this.redis.set(redisKey, '1', 'EX', 86400, 'NX')
    if (!isNew) return

    const row = { ...fill, exec_time: fill.exec_time.toISOString() }
    const { error } = await supabaseAdmin
      .from('raw_fills')
      .upsert(row, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })

    if (error) {
      // Undo the Redis mark so the fill can be retried
      await this.redis.del(redisKey)
      throw new Error(`raw_fills upsert failed for ${fill.exec_id}: ${error.message}`)
    }

    this.scheduleReconstruction(fill.account_id, fill.exchange)
  }

  async storeBatch(fills: RawFill[]): Promise<number> {
    if (fills.length === 0) return 0

    // Bulk Redis NX check via pipeline — one round-trip for the entire batch
    const pipeline = this.redis.pipeline()
    for (const fill of fills) {
      pipeline.set(`fill:${fill.account_id}:${fill.exchange}:${fill.exec_id}`, '1', 'EX', 86400, 'NX')
    }
    const results = await pipeline.exec()

    // Collect fills that passed the NX check (result[i][1] === 'OK')
    const newFills = fills.filter((_, i) => results?.[i]?.[1] === 'OK')
    if (newFills.length === 0) return 0

    // Single batch upsert for all new fills
    const rows = newFills.map(f => ({ ...f, exec_time: f.exec_time.toISOString() }))
    const { error } = await supabaseAdmin
      .from('raw_fills')
      .upsert(rows, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })

    if (error) {
      // Undo Redis marks so fills can be retried
      const delPipeline = this.redis.pipeline()
      for (const fill of newFills) {
        delPipeline.del(`fill:${fill.account_id}:${fill.exchange}:${fill.exec_id}`)
      }
      await delPipeline.exec()
      throw new Error(`raw_fills batch upsert failed: ${error.message}`)
    }

    // Schedule reconstruction once per account/exchange pair in the batch
    const pairs = new Set(newFills.map(f => `${f.account_id}:${f.exchange}`))
    for (const pair of pairs) {
      const [accountId, exchange] = pair.split(':')
      this.scheduleReconstruction(accountId, exchange)
    }

    return newFills.length
  }

  private scheduleReconstruction(accountId: string, exchange: string): void {
    const key = `${accountId}:${exchange}`
    const existing = this.reconstructionTimers.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.reconstructionTimers.delete(key)
      this.onReconstruct?.(accountId, exchange)
    }, 5000)
    timer.unref?.()  // don't block process exit in tests / worker shutdown
    this.reconstructionTimers.set(key, timer)
  }
}
