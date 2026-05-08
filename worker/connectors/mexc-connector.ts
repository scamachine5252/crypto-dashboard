import type { FillProcessor, RawFill } from '../fill-processor'

// MEXC has no private WebSocket for fills — poll REST every 5 min.
const POLL_INTERVAL_MS = 5 * 60 * 1000

export interface MexcConnectorOptions {
  accountId:      string
  lastFillTime?:  number
  fillProcessor:  FillProcessor
  fetchFills:     (since: number) => Promise<RawFill[]>
}

export class MexcConnector {
  private accountId:     string
  private lastFillTime:  number
  private fillProcessor: FillProcessor
  private fetchFillsFn:  (since: number) => Promise<RawFill[]>

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private destroyed: boolean = false

  constructor(opts: MexcConnectorOptions) {
    this.accountId     = opts.accountId
    this.lastFillTime  = opts.lastFillTime ?? 0
    this.fillProcessor = opts.fillProcessor
    this.fetchFillsFn  = opts.fetchFills
  }

  async connect(): Promise<void> {
    if (this.destroyed) return
    // Immediate initial poll on connect
    await this.poll()
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
    this.pollTimer.unref?.()
  }

  disconnect(): void {
    this.destroyed = true
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  private async poll(): Promise<void> {
    try {
      const fills = await this.fetchFillsFn(this.lastFillTime)
      if (fills.length > 0) {
        await this.fillProcessor.storeBatch(fills)
        const maxTime = Math.max(...fills.map(f => f.exec_time.getTime()))
        if (maxTime > this.lastFillTime) this.lastFillTime = maxTime
      }
    } catch (e) {
      console.error(`[mexc-connector] poll error: ${(e as Error).message}`)
    }
  }
}
