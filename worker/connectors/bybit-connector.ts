import * as crypto from 'crypto'
import type WebSocket from 'ws'
import type { FillProcessor, RawFill } from '../fill-processor'

const WS_URL = 'wss://stream.bybit.com/v5/private'

type ExecMsg = {
  orderId:    string
  execTime:   string
  execQty:    string
  symbol:     string
  side:       string
  execType:   string
  execPrice:  string
  execPnl:    string
  execFee:    string
  closedSize: string
  positionIdx?: string
}

type WsMessage = {
  topic?:  string
  op?:     string
  data?:   ExecMsg[]
}

export interface BybitConnectorOptions {
  apiKey:            string
  apiSecret:         string
  accountId:         string
  lastFillTime?:     number
  fillProcessor:     FillProcessor
  fetchGapFills?:    (since: number, until: number) => Promise<RawFill[]>
  enqueueFullSync?:  () => Promise<void>
}

export class BybitConnector {
  private apiKey:        string
  private apiSecret:     string
  private accountId:     string
  private lastFillTime:  number
  private fillProcessor: FillProcessor
  private fetchGapFillsFn?: (since: number, until: number) => Promise<RawFill[]>

  private ws:               WebSocket | null = null
  private pingTimer:        ReturnType<typeof setInterval> | null = null
  private reconnectDelay:   number = 1000
  private destroyed:        boolean = false
  private enqueueFullSync?: () => Promise<void>

  constructor(opts: BybitConnectorOptions) {
    this.apiKey          = opts.apiKey
    this.apiSecret       = opts.apiSecret
    this.accountId       = opts.accountId
    this.lastFillTime    = opts.lastFillTime ?? 0
    this.fillProcessor   = opts.fillProcessor
    this.fetchGapFillsFn = opts.fetchGapFills
    this.enqueueFullSync = opts.enqueueFullSync
  }

  // ── Public helpers (tested directly) ────────────────────────────────────

  buildExecId(exec: Pick<ExecMsg, 'orderId' | 'execTime' | 'execQty'>): string {
    return `${exec.orderId}_${exec.execTime}_${exec.execQty}`
  }

  buildFundingExecId(exec: Pick<ExecMsg, 'symbol' | 'execTime'>): string {
    return `funding_${exec.symbol}_${exec.execTime}`
  }

  buildAuthPayload() {
    const expires = Date.now() + 5000
    const sign = crypto
      .createHmac('sha256', this.apiSecret)
      .update(`GET/realtime${expires}`)
      .digest('hex')
    return { op: 'auth', args: [this.apiKey, expires, sign] }
  }

  buildSubscribePayload() {
    return {
      op:   'subscribe',
      args: ['execution.linear', 'execution.inverse', 'execution.spot'],
    }
  }

  async handleMessage(msg: Record<string, unknown>): Promise<void> {
    const topic = msg.topic as string | undefined
    if (!topic?.startsWith('execution.') || !Array.isArray(msg.data)) return
    const category = topic.split('.')[1] as 'linear' | 'inverse' | 'spot'

    for (const exec of msg.data as ExecMsg[]) {
      if (exec.execType !== 'Trade' && exec.execType !== 'Funding') continue

      const isFunding = exec.execType === 'Funding'
      const execId    = isFunding
        ? this.buildFundingExecId(exec)
        : this.buildExecId(exec)

      const execPnlNum = Number(exec.execPnl)
      const hasExecPnl = exec.execPnl !== undefined && exec.execPnl !== '' &&
                         !isNaN(execPnlNum) && execPnlNum !== 0

      const fill: RawFill = {
        account_id:  this.accountId,
        exchange:    'bybit',
        exec_id:     execId,
        symbol:      exec.symbol,
        category,
        exec_time:   new Date(Number(exec.execTime)),
        side:        exec.side,
        exec_qty:    Number(exec.execQty),
        exec_price:  Number(exec.execPrice),
        exec_pnl:    hasExecPnl ? execPnlNum : null,
        exec_fee:    Number(exec.execFee),
        closed_size: exec.closedSize ? Number(exec.closedSize) : null,
        position_idx: null,
        raw_data:    exec,
        source:      'ws',
      }
      await this.fillProcessor.store(fill)
      const fillMs = fill.exec_time.getTime()
      if (fillMs > this.lastFillTime) this.lastFillTime = fillMs
    }
  }

  async runGapFill(since: number, until: number): Promise<void> {
    if (!this.fetchGapFillsFn) return

    const MAX_BYBIT_WINDOW_MS = 7  * 24 * 60 * 60 * 1000
    const MAX_CHUNK_GAP_MS   = 30 * 24 * 60 * 60 * 1000
    const gap = until - since

    if (gap > MAX_CHUNK_GAP_MS) {
      console.warn(
        `[bybit-connector] gap ${Math.round(gap / 86400000)}d > 30d for account ` +
        `${this.accountId} — skipping gap fill, triggering full sync`,
      )
      if (this.enqueueFullSync) {
        await this.enqueueFullSync().catch(e =>
          console.error('[bybit-connector] failed to enqueue full sync:', e),
        )
      }
      return
    }

    // Chunk into ≤7d windows (Bybit API hard limit)
    let chunkStart = since
    while (chunkStart < until) {
      const chunkEnd = Math.min(chunkStart + MAX_BYBIT_WINDOW_MS, until)
      const fills = await this.fetchGapFillsFn(chunkStart, chunkEnd)
      if (fills.length > 0) {
        await this.fillProcessor.storeBatch(fills)
        const maxTs = fills.reduce((max, f) => Math.max(max, f.exec_time.getTime()), 0)
        if (maxTs > this.lastFillTime) this.lastFillTime = maxTs
      }
      chunkStart = chunkEnd
    }
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.runGapFill(this.lastFillTime, Date.now()).catch(e =>
      console.error('[bybit-connector] startup gap fill failed:', e)
    )

    while (!this.destroyed) {
      await this.connectOnce()
      if (this.destroyed) break

      await this.runGapFill(this.lastFillTime, Date.now()).catch(e =>
        console.error('[bybit-connector] gap fill failed (will retry on next reconnect):', e)
      )

      await new Promise(r => setTimeout(r, this.reconnectDelay))
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000)
      console.log(`[bybit-connector] reconnecting in ${this.reconnectDelay}ms...`)
    }
  }

  private async connectOnce(): Promise<void> {
    const WebSocket = (await import('ws')).default
    const ws = new WebSocket(WS_URL)
    this.ws = ws

    return new Promise<void>((resolve) => {
      ws.on('open', () => {
        this.reconnectDelay = 1000  // reset backoff on successful connection
        ws.send(JSON.stringify(this.buildAuthPayload()))
      })

      ws.on('message', async (data: Buffer | string) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(data.toString()) as Record<string, unknown>
        } catch { return /* malformed JSON — ignore */ }
        try {
          if (msg.op === 'auth' || msg.op === 'pong') {
            if (msg.op === 'auth') ws.send(JSON.stringify(this.buildSubscribePayload()))
            return
          }
          await this.handleMessage(msg)
        } catch (e) {
          console.error('[bybit-connector] message processing error:', (e as Error).message)
        }
      })

      ws.on('error', (err: Error) => {
        console.error(`[bybit-connector] ws error: ${err.message}`)
        ws.close()  // ensures 'close' fires so connectOnce Promise always resolves
      })

      ws.on('close', () => {
        this.stopPing()
        resolve()
      })

      this.startPing(ws)
    })
  }

  disconnect(): void {
    this.destroyed = true
    this.stopPing()
    this.ws?.close()
  }

  private startPing(ws: WebSocket) {
    this.pingTimer = setInterval(() => {
      if ((ws as { readyState: number }).readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({ op: 'ping' }))
      }
    }, 20_000)
    this.pingTimer.unref?.()
  }

  private stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
  }
}
