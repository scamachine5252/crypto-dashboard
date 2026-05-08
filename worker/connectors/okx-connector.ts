import * as crypto from 'crypto'
import type WebSocket from 'ws'
import type { FillProcessor, RawFill } from '../fill-processor'

const WS_URL = 'wss://ws.okx.com:8443/ws/v5/private'
const PING_INTERVAL_MS = 25_000

type OkxFill = {
  fillId:  string
  instId:  string
  ts:      string
  side:    string
  fillSz:  string
  fillPx:  string
  pnl:     string
  fee:     string
}

export interface OkxConnectorOptions {
  apiKey:         string
  apiSecret:      string
  passphrase:     string
  accountId:      string
  lastFillTime?:  number
  fillProcessor:  FillProcessor
  fetchGapFills?: (since: number, until: number) => Promise<RawFill[]>
}

export class OkxConnector {
  private apiKey:         string
  private apiSecret:      string
  private passphrase:     string
  private accountId:      string
  private lastFillTime:   number
  private fillProcessor:  FillProcessor
  private fetchGapFillsFn?: (since: number, until: number) => Promise<RawFill[]>

  private ws:             WebSocket | null = null
  private pingTimer:      ReturnType<typeof setInterval> | null = null
  private destroyed:      boolean = false
  private reconnectDelay: number = 1000

  constructor(opts: OkxConnectorOptions) {
    this.apiKey         = opts.apiKey
    this.apiSecret      = opts.apiSecret
    this.passphrase     = opts.passphrase
    this.accountId      = opts.accountId
    this.lastFillTime   = opts.lastFillTime ?? 0
    this.fillProcessor  = opts.fillProcessor
    this.fetchGapFillsFn = opts.fetchGapFills
  }

  // ── Public helpers (tested directly) ────────────────────────────────────

  buildAuthPayload() {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const sign = crypto
      .createHmac('sha256', this.apiSecret)
      .update(`${timestamp}GET/users/self/verify`)
      .digest('base64')
    return {
      op:   'login',
      args: [{ apiKey: this.apiKey, passphrase: this.passphrase, timestamp, sign }],
    }
  }

  buildSubscribePayload() {
    return {
      op:   'subscribe',
      args: [{ channel: 'fills', instType: 'ANY' }],
    }
  }

  buildExecId(fillId: string): string {
    return fillId
  }

  async handleMessage(msg: Record<string, unknown>): Promise<void> {
    if (msg.event !== 'fills') return
    const data = msg.data as OkxFill[] | undefined
    if (!Array.isArray(data)) return

    for (const fill of data) {
      const pnl = fill.pnl ? Number(fill.pnl) : null
      const row: RawFill = {
        account_id:  this.accountId,
        exchange:    'okx',
        exec_id:     this.buildExecId(fill.fillId),
        symbol:      fill.instId,
        exec_time:   new Date(Number(fill.ts)),
        side:        fill.side,
        exec_qty:    Number(fill.fillSz),
        exec_price:  Number(fill.fillPx),
        exec_pnl:    pnl !== null && !isNaN(pnl) ? pnl : null,
        exec_fee:    Math.abs(Number(fill.fee)),
        raw_data:    fill,
        source:      'ws',
      }
      await this.fillProcessor.store(row)
    }
  }

  async runGapFill(since: number, until: number): Promise<void> {
    if (!this.fetchGapFillsFn) return
    const fills = await this.fetchGapFillsFn(since, until)
    if (fills.length > 0) await this.fillProcessor.storeBatch(fills)
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.destroyed) return
    const WebSocket = (await import('ws')).default
    const ws = new WebSocket(WS_URL)
    this.ws = ws

    ws.on('open', () => {
      ws.send(JSON.stringify(this.buildAuthPayload()))
    })

    ws.on('message', async (data: Buffer | string) => {
      const raw = data.toString()
      if (raw === 'pong') return
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>
        if (msg.event === 'login') {
          ws.send(JSON.stringify(this.buildSubscribePayload()))
          return
        }
        await this.handleMessage(msg)
      } catch { /* malformed — ignore */ }
    })

    ws.on('error', (err: Error) => {
      console.error(`[okx-connector] ws error: ${err.message}`)
    })

    ws.on('close', async () => {
      this.stopPing()
      if (!this.destroyed) await this.reconnect()
    })

    this.startPing(ws)
  }

  disconnect(): void {
    this.destroyed = true
    this.stopPing()
    this.ws?.close()
  }

  private startPing(ws: WebSocket) {
    this.pingTimer = setInterval(() => { ws.send('ping') }, PING_INTERVAL_MS)
    this.pingTimer.unref?.()
  }

  private stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
  }

  private async reconnect(): Promise<void> {
    const since = this.lastFillTime
    const until = Date.now()
    await new Promise(r => setTimeout(r, this.reconnectDelay))
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000)
    await this.runGapFill(since, until)
    await this.connect()
  }
}
