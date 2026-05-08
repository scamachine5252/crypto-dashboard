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
    const isNew = await this.redis.set(redisKey, '1', 'NX', 'EX', 86400)
    if (!isNew) return

    const row = { ...fill, exec_time: fill.exec_time.toISOString() }
    await supabaseAdmin
      .from('raw_fills')
      .upsert(row, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })

    this.scheduleReconstruction(fill.account_id, fill.exchange)
  }

  async storeBatch(fills: RawFill[]): Promise<number> {
    let inserted = 0
    for (const fill of fills) {
      const redisKey = `fill:${fill.account_id}:${fill.exchange}:${fill.exec_id}`
      const isNew = await this.redis.set(redisKey, '1', 'NX', 'EX', 86400)
      if (!isNew) continue

      const row = { ...fill, exec_time: fill.exec_time.toISOString() }
      await supabaseAdmin
        .from('raw_fills')
        .upsert(row, { onConflict: 'account_id,exchange,exec_id', ignoreDuplicates: true })

      inserted++
      this.scheduleReconstruction(fill.account_id, fill.exchange)
    }
    return inserted
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
