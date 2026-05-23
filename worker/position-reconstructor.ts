import Redis from 'ioredis'
import { supabaseAdmin } from '@/lib/supabase/server'
import { reconstructPositions, type RawExecution } from '@/lib/adapters/bybit'
import { reconstructBinanceTrades, type RawFapiTrade } from '@/lib/adapters/binance'
import type { Trade, TradeType, TradeSide } from '@/lib/types'

const PAGE_SIZE  = 1000
const LOCK_TTL_S = 120   // 2-minute max hold time per reconstruction

// ── OKX per-symbol position state ────────────────────────────────────────────
// Analogous to Bybit's SymbolState. OKX uses net mode so one slot per symbol.
interface OkxSymbolState {
  size:     number      // open size (positive)
  avgEntry: number      // weighted-average entry price
  openTime: string      // ISO — time of first opening fill
  openSide: TradeSide   // 'long' | 'short'
  accFee:   number      // fees accumulated on the open side
}

// OKX sets exec_pnl on closing fills only. Opening fills have exec_pnl = null.
function isOkxClosingFill(row: Record<string, unknown>): boolean {
  return row.exec_pnl !== null && row.exec_pnl !== undefined
}

export function reconstructOkxTrades(rows: Record<string, unknown>[]): Trade[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(String(a.exec_time)).getTime() - new Date(String(b.exec_time)).getTime()
  )

  const states = new Map<string, OkxSymbolState>()
  const trades: Trade[] = []

  for (const row of sorted) {
    const symbol    = String(row.symbol ?? '')
    const sideRaw   = String(row.side ?? 'buy').toLowerCase()
    const qty       = Number(row.exec_qty ?? 0)
    const price     = Number(row.exec_price ?? 0)
    const pnl       = Number(row.exec_pnl ?? 0)
    const fee       = Number(row.exec_fee ?? 0)
    const execTime  = String(row.exec_time ?? new Date().toISOString())
    const cat       = String(row.category ?? '')
    const tradeType: TradeType = (
      cat === 'futures' || symbol.includes('SWAP') || symbol.includes('FUTURES')
    ) ? 'futures' : 'spot'

    const existing = states.get(symbol)

    if (!isOkxClosingFill(row)) {
      // Opening fill — create or add to position
      if (!existing || existing.size === 0) {
        states.set(symbol, {
          size:     qty,
          avgEntry: price,
          openTime: execTime,
          openSide: sideRaw === 'buy' ? 'long' : 'short',
          accFee:   fee,
        })
      } else {
        const total    = existing.size + qty
        const avgEntry = (existing.avgEntry * existing.size + price * qty) / total
        states.set(symbol, { ...existing, size: total, avgEntry, accFee: existing.accFee + fee })
      }
    } else {
      // Closing fill — emit a reconstructed trade
      if (existing && existing.size > 0) {
        trades.push({
          id:           String(row.exec_id ?? ''),
          subAccountId: 'okx',
          exchangeId:   'okx' as const,
          symbol,
          side:         existing.openSide,
          tradeType,
          entryPrice:   existing.avgEntry,
          exitPrice:    price,
          quantity:     Math.min(qty, existing.size),
          pnl,
          pnlPercent:   0,
          fee:          existing.accFee + fee,
          durationMin:  Math.round(
            (new Date(execTime).getTime() - new Date(existing.openTime).getTime()) / 60_000
          ),
          leverage:     1,
          fundingCost:  0,
          isOvernight:  false,
          openedAt:     existing.openTime,
          closedAt:     execTime,
        })
        const remaining = existing.size - qty
        if (remaining > 0.000001) {
          // Reset accFee after partial close — the emitted trade already consumed it
          states.set(symbol, { ...existing, size: remaining, accFee: 0 })
        } else {
          states.delete(symbol)
        }
      } else {
        // No tracked open position — fall back to fill-level trade
        trades.push({
          id:           String(row.exec_id ?? ''),
          subAccountId: 'okx',
          exchangeId:   'okx' as const,
          symbol,
          side:         sideRaw === 'buy' ? 'long' : 'short',
          tradeType,
          entryPrice:   price,
          exitPrice:    price,
          quantity:     qty,
          pnl,
          pnlPercent:   0,
          fee,
          durationMin:  0,
          leverage:     1,
          fundingCost:  0,
          isOvernight:  false,
          openedAt:     execTime,
          closedAt:     execTime,
        })
      }
    }
  }
  return trades
}

// ── DB row → adapter types ────────────────────────────────────────────────────
function rowToRawExecution(row: Record<string, unknown>): RawExecution {
  const raw = row.raw_data as Record<string, string>
  return {
    execTime:    raw.execTime    ?? '0',
    symbol:      raw.symbol      ?? String(row.symbol ?? ''),
    side:        raw.side        ?? String(row.side   ?? ''),
    execType:    raw.execType    ?? 'Trade',
    execPrice:   raw.execPrice   ?? String(row.exec_price ?? '0'),
    execQty:     raw.execQty     ?? String(row.exec_qty   ?? '0'),
    execPnl:     raw.execPnl     ?? '0',
    execFee:     raw.execFee     ?? String(row.exec_fee   ?? '0'),
    closedSize:  raw.closedSize  ?? String(row.closed_size ?? '0'),
    orderId:     raw.orderId     ?? '',
    positionIdx: raw.positionIdx,
  }
}

function rowToRawFapiTrade(row: Record<string, unknown>): RawFapiTrade {
  const raw = (row.raw_data ?? {}) as Record<string, unknown>
  // Binance WS execution reports use single-letter keys; REST trades use full names.
  // WS: s=symbol, S=side, L=lastPrice, l=lastQty, rp=realizedPnl, n=commission,
  //     N=commissionAsset, T=transactTime, ps=positionSide, i=orderId, t=tradeId
  const isWs = raw.rp !== undefined || raw.ps !== undefined
  return {
    symbol:          String(raw.symbol   ?? raw.s  ?? row.symbol      ?? ''),
    side:            String(raw.side     ?? raw.S  ?? row.side        ?? 'BUY'),
    price:           String(raw.price    ?? raw.L  ?? row.exec_price  ?? '0'),
    qty:             String(raw.qty      ?? raw.l  ?? row.exec_qty    ?? '0'),
    realizedPnl:     String(raw.realizedPnl ?? raw.rp ?? (isWs ? '0' : (row.exec_pnl ?? '0'))),
    commission:      String(raw.commission  ?? raw.n  ?? row.exec_fee ?? '0'),
    commissionAsset: String(raw.commissionAsset ?? raw.N ?? 'USDT'),
    time:            Number(raw.time ?? raw.T ?? new Date(String(row.exec_time ?? 0)).getTime()),
    positionSide:    String(raw.positionSide ?? raw.ps ?? row.category ?? 'BOTH'),
    orderId:         Number(raw.orderId ?? raw.i ?? 0),
    id:              Number(raw.id ?? raw.t ?? 0),
  }
}

// ── Paginated fill fetch ──────────────────────────────────────────────────────
async function fetchAllFills(
  accountId: string,
  exchange: string,
  category?: string,
): Promise<Record<string, unknown>[]> {
  const fills: Record<string, unknown>[] = []
  let offset = 0
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = supabaseAdmin
      .from('raw_fills')
      .select('*')
      .eq('account_id', accountId)
      .eq('exchange', exchange)
    if (category !== undefined) query = query.eq('category', category)
    const { data, error } = await query
      .order('exec_time', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`raw_fills fetch error: ${error.message}`)
    if (!data || data.length === 0) break
    fills.push(...(data as Record<string, unknown>[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return fills
}

// ── Trade upsert / delete ─────────────────────────────────────────────────────
async function upsertTrades(accountId: string, exchange: string, trades: Trade[]): Promise<void> {
  if (trades.length === 0) return
  const rowMap = new Map<string, Record<string, unknown>>()
  for (const t of trades) {
    const key = `${accountId}|${t.symbol}|${t.openedAt}|${t.closedAt}`
    rowMap.set(key, {
      account_id:  accountId,
      exchange,
      symbol:      t.symbol,
      side:        t.side === 'long' ? 'buy' : 'sell',
      direction:   t.side === 'long' || t.side === 'short' ? t.side : 'unknown',
      entry_price: t.entryPrice,
      exit_price:  t.exitPrice,
      quantity:    t.quantity,
      pnl:         t.pnl,
      fee:         t.fee,
      opened_at:   t.openedAt,
      closed_at:   t.closedAt,
      trade_type:  t.tradeType,
    })
  }
  const rows = Array.from(rowMap.values())
  const { error } = await supabaseAdmin
    .from('trades')
    .upsert(rows, { onConflict: 'account_id,symbol,opened_at,closed_at', ignoreDuplicates: true })
  if (error) throw new Error(`trades upsert error: ${error.message}`)
}

async function deleteTrades(accountId: string, exchange: string, tradeType?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabaseAdmin.from('trades').delete().eq('account_id', accountId).eq('exchange', exchange)
  if (tradeType) query = query.eq('trade_type', tradeType)
  const { error } = await query
  if (error) throw new Error(`trades delete error: ${error.message}`)
}

// ── Main class ────────────────────────────────────────────────────────────────
export class PositionReconstructor {
  private redis: Redis

  constructor(redisUrl = 'redis://127.0.0.1:6379') {
    this.redis = new Redis(redisUrl, { lazyConnect: true })
  }

  async reconstruct(accountId: string, exchange: string): Promise<void> {
    const lockKey = `recon:${accountId}:${exchange}`

    // NX = only set if absent; EX = TTL seconds (ioredis v5: EX before NX)
    const acquired = await this.redis.set(lockKey, '1', 'EX', LOCK_TTL_S, 'NX')
    if (acquired !== 'OK') {
      console.warn(`[reconstructor] ${accountId}/${exchange} already running — skipping`)
      return
    }

    try {
      // Skip reconstruction if no fills have arrived since last run
      const { data: acct } = await supabaseAdmin
        .from('accounts')
        .select('last_reconstructed_at')
        .eq('id', accountId)
        .single()

      if (acct?.last_reconstructed_at) {
        const { data: latest } = await supabaseAdmin
          .from('raw_fills')
          .select('exec_time')
          .eq('account_id', accountId)
          .eq('exchange', exchange)
          .order('exec_time', { ascending: false })
          .limit(1)
          .single()

        if (latest?.exec_time) {
          const latestMs = new Date(String(latest.exec_time)).getTime()
          const reconMs  = new Date(String(acct.last_reconstructed_at)).getTime()
          if (latestMs <= reconMs) {
            console.log(`[reconstructor] ${accountId}/${exchange} — no new fills, skipping`)
            return
          }
        }
      }

      // Heartbeat: renew Redis lock TTL every 30s.
      // Prevents lock expiry mid-reconstruction on large accounts (Continum: 33k fills > 120s).
      const heartbeat = setInterval(() => {
        this.redis.expire(lockKey, LOCK_TTL_S).catch(() => {})
      }, 30_000)

      try {
        await this.doReconstruct(accountId, exchange)
        await supabaseAdmin
          .from('accounts')
          .update({ last_reconstructed_at: new Date().toISOString() })
          .eq('id', accountId)
      } finally {
        clearInterval(heartbeat)
      }
    } finally {
      await this.redis.del(lockKey)
    }
  }

  private async doReconstruct(accountId: string, exchange: string): Promise<void> {
    if (exchange === 'bybit') {
      await deleteTrades(accountId, exchange, 'futures')
      for (const category of ['linear', 'inverse'] as const) {
        const rows = await fetchAllFills(accountId, exchange, category)
        if (rows.length === 0) continue
        const { trades } = reconstructPositions(rows.map(rowToRawExecution), category)
        await upsertTrades(accountId, exchange, trades)
      }
      return
    }

    if (exchange === 'binance') {
      const rows = await fetchAllFills(accountId, exchange)
      if (rows.length === 0) return
      await deleteTrades(accountId, exchange)
      const bySymbol = new Map<string, Record<string, unknown>[]>()
      for (const row of rows) {
        const sym = String(row.symbol ?? '')
        if (!bySymbol.has(sym)) bySymbol.set(sym, [])
        bySymbol.get(sym)!.push(row)
      }
      for (const [rawSymbol, symbolRows] of bySymbol) {
        const trades = reconstructBinanceTrades(symbolRows.map(rowToRawFapiTrade), rawSymbol)
        await upsertTrades(accountId, exchange, trades)
      }
      return
    }

    if (exchange === 'okx') {
      const rows = await fetchAllFills(accountId, exchange)
      if (rows.length === 0) return
      await deleteTrades(accountId, exchange)
      const trades = reconstructOkxTrades(rows)
      await upsertTrades(accountId, exchange, trades)
      return
    }

    if (exchange === 'mexc') {
      const rows = await fetchAllFills(accountId, exchange)
      if (rows.length === 0) return
      await deleteTrades(accountId, exchange)
      const trades: Trade[] = rows.map(row => {
        const sideRaw  = String(row.side ?? 'buy').toLowerCase()
        const symbol   = String(row.symbol ?? '')
        const cat      = String(row.category ?? '')
        const tradeType: TradeType = (
          cat === 'futures' || symbol.includes('_PERP') || symbol.includes('FUTURES')
        ) ? 'futures' : 'spot'
        return {
          id:           String(row.exec_id ?? ''),
          subAccountId: 'mexc',
          exchangeId:   'mexc' as const,
          symbol,
          side:         sideRaw === 'buy' ? 'long' : 'short',
          tradeType,
          entryPrice:   Number(row.exec_price ?? 0),
          exitPrice:    Number(row.exec_price ?? 0),
          quantity:     Number(row.exec_qty   ?? 0),
          pnl:          Number(row.exec_pnl   ?? 0),
          pnlPercent:   0,
          fee:          Number(row.exec_fee   ?? 0),
          durationMin:  0,
          leverage:     1,
          fundingCost:  0,
          isOvernight:  false,
          openedAt:     String(row.exec_time ?? new Date().toISOString()),
          closedAt:     String(row.exec_time ?? new Date().toISOString()),
        }
      })
      await upsertTrades(accountId, exchange, trades)
      return
    }
    // Unsupported exchange — no-op
  }
}
