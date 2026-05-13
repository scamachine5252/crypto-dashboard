import { supabaseAdmin } from '@/lib/supabase/server'
import { reconstructPositions, type RawExecution } from '@/lib/adapters/bybit'
import { reconstructBinanceTrades, type RawFapiTrade } from '@/lib/adapters/binance'
import type { Trade, TradeType } from '@/lib/types'

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

function rowToRawFapiTrade(row: Record<string, unknown>): RawFapiTrade {
  const raw = (row.raw_data ?? {}) as Record<string, unknown>
  return {
    symbol:          String(raw.symbol          ?? row.symbol       ?? ''),
    side:            String(raw.side            ?? row.side         ?? 'BUY'),
    price:           String(raw.price           ?? row.exec_price   ?? '0'),
    qty:             String(raw.qty             ?? row.exec_qty     ?? '0'),
    realizedPnl:     String(raw.realizedPnl     ?? row.exec_pnl     ?? '0'),
    commission:      String(raw.commission      ?? row.exec_fee     ?? '0'),
    commissionAsset: String(raw.commissionAsset ?? 'USDT'),
    time:            Number(raw.time            ?? new Date(String(row.exec_time ?? 0)).getTime()),
    positionSide:    String(raw.positionSide    ?? row.category     ?? 'BOTH'),
    orderId:         Number(raw.orderId         ?? 0),
    id:              Number(raw.id              ?? 0),
  }
}

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

    if (category !== undefined) {
      query = query.eq('category', category)
    }

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
  let query = supabaseAdmin.from('trades').delete().eq('account_id', accountId).eq('exchange', exchange)
  if (tradeType) query = query.eq('trade_type', tradeType)
  const { error } = await query
  if (error) throw new Error(`trades delete error: ${error.message}`)
}

export class PositionReconstructor {
  async reconstruct(accountId: string, exchange: string): Promise<void> {
    if (exchange === 'bybit') {
      // Delete existing futures trades before re-reconstructing to avoid stale records
      // with wrong opened_at from a previous run. Spot trades are written directly by
      // the sync route and must not be deleted here.
      await deleteTrades(accountId, exchange, 'futures')
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
      const rows = await fetchAllFills(accountId, exchange)
      if (rows.length === 0) return

      // Delete ALL existing binance trades before re-reconstructing to ensure
      // changed opened_at values (from more history being available) don't leave
      // stale records alongside new ones.
      await deleteTrades(accountId, exchange)

      // Group fills by symbol, reconstruct positions per symbol
      const bySymbol = new Map<string, Record<string, unknown>[]>()
      for (const row of rows) {
        const sym = String(row.symbol ?? '')
        if (!bySymbol.has(sym)) bySymbol.set(sym, [])
        bySymbol.get(sym)!.push(row)
      }

      for (const [rawSymbol, symbolRows] of bySymbol) {
        const fills  = symbolRows.map(rowToRawFapiTrade)
        const trades = reconstructBinanceTrades(fills, rawSymbol)
        await upsertTrades(accountId, exchange, trades)
      }
      return
    }

    if (exchange === 'okx') {
      const rows = await fetchAllFills(accountId, exchange)
      if (rows.length === 0) return

      await deleteTrades(accountId, exchange)

      const trades: Trade[] = rows.map(row => {
        const sideRaw  = String(row.side ?? 'buy').toLowerCase()
        const symbol   = String(row.symbol ?? '')
        const cat      = String(row.category ?? '')
        const tradeType: TradeType = (
          cat === 'futures' ||
          symbol.includes('SWAP') ||
          symbol.includes('FUTURES')
        ) ? 'futures' : 'spot'

        return {
          id:           String(row.exec_id ?? ''),
          subAccountId: 'okx',
          exchangeId:   'okx' as const,
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

    if (exchange === 'mexc') {
      const rows = await fetchAllFills(accountId, exchange)
      if (rows.length === 0) return

      await deleteTrades(accountId, exchange)

      const trades: Trade[] = rows.map(row => {
        const sideRaw   = String(row.side ?? 'buy').toLowerCase()
        const symbol    = String(row.symbol ?? '')
        const cat       = String(row.category ?? '')
        const tradeType: TradeType = (
          cat === 'futures' ||
          symbol.includes('_PERP') ||
          symbol.includes('FUTURES')
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
