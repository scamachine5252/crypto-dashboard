import { supabaseAdmin } from '@/lib/supabase/server'

export class BinanceBanGuard {
  private banUntilMs = 0

  async recordIfBanned(err: unknown): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err)
    const match = msg.match(/banned until (\d+)/)
    if (!match) return
    const until = Number(match[1])
    // Sanity: Binance always sends milliseconds (>1e12 = year 2001+). Ignore if looks like seconds.
    if (until < 1e12) {
      console.warn(`[binance-ban-guard] suspicious ban timestamp ${until} — ignoring (expected ms, got seconds?)`)
      return
    }
    if (until <= this.banUntilMs) return
    this.banUntilMs = until
    const untilIso = new Date(until).toISOString()
    console.error(`[binance-ban-guard] IP banned until ${untilIso} — halting all Binance requests`)
    await supabaseAdmin
      .from('worker_status')
      .update({ binance_ban_until: untilIso })
      .eq('id', 1)
      .then(null, (e: unknown) => console.error('[binance-ban-guard] failed to persist ban:', e))
  }

  isBanned(): boolean {
    return Date.now() < this.banUntilMs
  }

  /** Reset ban state — for use in tests only. */
  reset(): void {
    this.banUntilMs = 0
  }
}

export const binanceBanGuard = new BinanceBanGuard()
