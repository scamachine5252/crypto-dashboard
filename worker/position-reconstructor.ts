import { supabaseAdmin } from '@/lib/supabase/server'
import { reconstructPositions, type RawExecution } from '@/lib/adapters/bybit'
import type { Trade } from '@/lib/types'

const PAGE_SIZE = 1000

// Maps a raw_fills DB row back to the RawExecution shape expected by reconstructPositions().
// raw_data stores the original API object which already has all required fields.
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

async function fetchAllFills(
  accountId: string,
  exchange: string,
  category: string,
): Promise<Record<string, unknown>[]> {
  const fills: Record<string, unknown>[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('raw_fills')
      .select('*')
      .eq('account_id', accountId)
      .eq('category', category)
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

async function upsertTrades(accountId: string, exchange: string, trades: Trade[]): Promise<void> {
  if (trades.length === 0) return
  const rows = trades.map((t: Trade) => ({
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
  }))
  const { error } = await supabaseAdmin
    .from('trades')
    .upsert(rows, { onConflict: 'account_id,symbol,opened_at,closed_at' })
  if (error) throw new Error(`trades upsert error: ${error.message}`)
}

export class PositionReconstructor {
  async reconstruct(accountId: string, exchange: string): Promise<void> {
    if (exchange === 'bybit') {
      for (const category of ['linear', 'inverse'] as const) {
        const rows = await fetchAllFills(accountId, exchange, category)
        if (rows.length === 0) continue
        const executions = rows.map(rowToRawExecution)
        const { trades } = reconstructPositions(executions, category)
        await upsertTrades(accountId, exchange, trades)
      }
      return
    }

    if (exchange === 'binance') {
      // Binance reconstruction deferred — trades are written directly by the
      // full sync route using reconstructBinanceTrades(). Future: read raw_fills
      // grouped by symbol and call reconstructBinanceTrades() per symbol.
      return
    }

    // OKX / MEXC: spot fills are already 1-fill = 1-trade; no reconstruction needed.
    // Trades are written directly by full sync routes.
  }
}
