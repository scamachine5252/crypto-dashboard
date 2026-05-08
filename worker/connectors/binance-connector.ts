import type WebSocket from 'ws'
import type { FillProcessor, RawFill } from '../fill-processor'

const FAPI_BASE = 'https://fapi.binance.com'
const PAPI_BASE = 'https://papi.binance.com'
const WS_BASE   = 'wss://fstream.binance.com'

const KEEPALIVE_MS = 30 * 60 * 1000  // 30 min

type OrderTradeUpdate = {
  e: string
  o: {
    t:  number   // tradeId
    s:  string   // symbol
    T:  number   // trade time ms
    S:  string   // side BUY/SELL
    l:  string   // last filled qty
    L:  string   // last filled price
    rp: string   // realized PnL
    n:  string   // commission (may be negative = rebate)
    ps: string   // positionSide LONG/SHORT/BOTH
    x:  string   // execution type
  }
}

export interface BinanceConnectorOptions {
  apiKey:          string
  apiSecret:       string
  accountId:       string
  portfolioMargin: boolean
  lastFillTime?:   number
  fillProcessor:   FillProcessor
  fetchGapFills?:  (since: number, until: number) => Promise<RawFill[]>
}

export class BinanceConnector {
  private apiKey:          string
  private accountId:       string
  private portfolioMargin: boolean
  private fillProcessor:   FillProcessor
  private fetchGapFillsFn?: (since: number, until: number) => Promise<RawFill[]>
  private lastFillTime:    number

  private ws:              WebSocket | null = null
  private keepaliveTimer:  ReturnType<typeof setInterval> | null = null
  private destroyed:       boolean = false
  private listenKey:       string = ''
  private reconnectDelay:  number = 1000

  constructor(opts: BinanceConnectorOptions) {
    this.apiKey          = opts.apiKey
    this.accountId       = opts.accountId
    this.portfolioMargin = opts.portfolioMargin
    this.fillProcessor   = opts.fillProcessor
    this.fetchGapFillsFn = opts.fetchGapFills
    this.lastFillTime    = opts.lastFillTime ?? 0
  }

  // ── Public helpers (tested directly) ────────────────────────────────────

  listenKeyUrl(): string {
    const base = this.portfolioMargin ? PAPI_BASE : FAPI_BASE
    const path = this.portfolioMargin ? '/papi/v1/listenKey' : '/fapi/v1/listenKey'
    return `${base}${path}`
  }

  wsUrl(listenKey: string): string {
    const prefix = this.portfolioMargin ? 'pm' : 'ws'
    return `${WS_BASE}/${prefix}/${listenKey}`
  }

  buildExecId(tradeId: number): string {
    return String(tradeId)
  }

  async handleMessage(msg: Record<string, unknown>): Promise<void> {
    if (msg.e !== 'ORDER_TRADE_UPDATE') return
    const o = msg.o as OrderTradeUpdate['o']
    if (o.x !== 'TRADE') return

    const fill: RawFill = {
      account_id:  this.accountId,
      exchange:    'binance',
      exec_id:     this.buildExecId(o.t),
      symbol:      o.s,
      category:    o.ps,
      exec_time:   new Date(o.T),
      side:        o.S,
      exec_qty:    Number(o.l),
      exec_price:  Number(o.L),
      exec_pnl:    Number(o.rp),
      exec_fee:    Math.abs(Number(o.n)),
      closed_size: null,
      position_idx: null,
      raw_data:    o,
      source:      'ws',
    }
    await this.fillProcessor.store(fill)
  }

  async runGapFill(since: number, until: number): Promise<void> {
    if (!this.fetchGapFillsFn) return
    const fills = await this.fetchGapFillsFn(since, until)
    if (fills.length > 0) await this.fillProcessor.storeBatch(fills)
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.destroyed) return
    this.listenKey = await this.createListenKey()
    const WebSocket = (await import('ws')).default
    const ws = new WebSocket(this.wsUrl(this.listenKey))
    this.ws = ws

    ws.on('message', async (data: Buffer | string) => {
      try {
        await this.handleMessage(JSON.parse(data.toString()) as Record<string, unknown>)
      } catch { /* ignore malformed */ }
    })

    ws.on('error', (err: Error) => {
      console.error(`[binance-connector] ws error: ${err.message}`)
    })

    ws.on('close', async () => {
      this.stopKeepalive()
      if (!this.destroyed) await this.reconnect()
    })

    this.startKeepalive()
  }

  disconnect(): void {
    this.destroyed = true
    this.stopKeepalive()
    this.ws?.close()
  }

  private async createListenKey(): Promise<string> {
    const res = await fetch(this.listenKeyUrl(), {
      method:  'POST',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    })
    const json = await res.json() as { listenKey: string }
    return json.listenKey
  }

  private async renewListenKey(): Promise<void> {
    try {
      await fetch(this.listenKeyUrl(), {
        method:  'PUT',
        headers: { 'X-MBX-APIKEY': this.apiKey },
        body:    JSON.stringify({ listenKey: this.listenKey }),
      })
    } catch (e) {
      console.warn('[binance-connector] listenKey renewal failed:', e)
    }
  }

  private startKeepalive() {
    this.keepaliveTimer = setInterval(() => void this.renewListenKey(), KEEPALIVE_MS)
    this.keepaliveTimer.unref?.()
  }

  private stopKeepalive() {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null }
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
