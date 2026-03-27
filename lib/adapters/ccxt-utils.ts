import type { Trade, ExchangeId, TradeSide, TradeType } from '../types'

// Map a raw ccxt trade object to our internal Trade shape.
// ccxt provides fill-level data; fields that require full position roundtrip
// (pnl, duration, isOvernight) are best-effort from exchange info where available.
export function mapCcxtTrade(
  t: {
    id?: string | null
    symbol?: string
    side?: string | null
    price?: number | null
    amount?: number | null
    cost?: number | null
    fee?: { cost?: number | null } | null
    timestamp?: number | null
    datetime?: string | null
    info?: Record<string, unknown>
  },
  exchangeId: ExchangeId,
): Trade {
  const side: TradeSide = t.side === 'sell' ? 'short' : 'long'
  const price           = t.price  ?? 0
  const quantity        = t.amount ?? 0
  const fee             = t.fee?.cost ?? 0
  const closedAt        = t.datetime ?? new Date(t.timestamp ?? 0).toISOString()
  const info            = t.info ?? {}

  // Best-effort PnL extraction from exchange-specific info fields.
  // Values may arrive as strings ("1.5000") or numbers depending on exchange.
  const rawPnl =
    info['realizedPnl']  ??   // Binance futures (USDT-M / COIN-M)
    info['closedPnl']    ??   // Bybit
    info['realised_pnl'] ??   // OKX
    info['pnl']          ??   // generic
    0
  const pnl = Number(rawPnl)

  const rawLeverage =
    typeof info['leverage'] === 'number' ? info['leverage'] :
    typeof info['leverage'] === 'string' ? Number(info['leverage']) :
    1
  const leverage = Number.isFinite(rawLeverage) && rawLeverage > 0 ? rawLeverage : 1

  const tradeType: TradeType = t.symbol?.includes(':') ? 'futures' : 'spot'

  return {
    id:           String(t.id ?? Math.random()),
    subAccountId: exchangeId,
    exchangeId,
    symbol:       t.symbol ?? 'UNKNOWN',
    side,
    tradeType,
    entryPrice:   price,
    exitPrice:    price,
    quantity,
    pnl,
    pnlPercent:   price > 0 && quantity > 0 ? (pnl / (price * quantity)) * 100 : 0,
    fee,
    durationMin:  0,
    leverage,
    fundingCost:  0,
    isOvernight:  false,
    openedAt:     closedAt,
    closedAt,
  }
}
