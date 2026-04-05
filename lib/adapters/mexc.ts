import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult, RawPosition } from './types'
import type { DailyPnLEntry, Trade, DateRange, ExchangeId } from '../types'

interface MexcCredentials {
  apiKey: string
  apiSecret: string
}

// Maps a closed MEXC position (fetchPositionsHistory) to our internal Trade format.
// One closed position = one futures trade — correct granularity for PnL tracking.
// Client-side since/until filter guards against CCXT not forwarding time params to MEXC API.
//
// IMPORTANT: CCXT's parsePosition for MEXC leaves several unified fields undefined:
//   realizedPnl  → raw field is `realised`
//   lastPrice    → raw field is `closeAvgPrice`
//   fee          → raw field is `fee`
//   holdFee      → raw field is `holdFee` (funding cost)
// All of these must be read from p.info (raw MEXC API response).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MexcRawInfo = Record<string, any>

function mapMexcPositionHistory(
  p: ccxt.Position,
  contractSize: number,
  since?: number,
  until?: number,
): Trade | null {
  const info = (p.info ?? {}) as MexcRawInfo

  // info.updateTime = close timestamp (ms), info.createTime = open timestamp (ms)
  const closedAt = info.updateTime
    ? new Date(Number(info.updateTime)).toISOString()
    : (p.datetime ?? new Date().toISOString())
  const openedAt = info.createTime
    ? new Date(Number(info.createTime)).toISOString()
    : closedAt
  const closedTs = new Date(closedAt).getTime()

  if (since && closedTs < since) return null
  if (until && closedTs > until) return null

  const entryPrice = Number(p.entryPrice ?? info.openAvgPrice ?? 0)
  // closeAvgPrice = actual fill price when position was closed
  const exitPrice  = Number(info.closeAvgPrice ?? p.lastPrice ?? p.markPrice ?? entryPrice)
  // closeVol = number of contracts closed; multiply by contractSize to get base-currency amount
  // (holdVol=0 for closed positions, so we must use closeVol not p.contracts)
  const closeVol   = Math.abs(Number(info.closeVol ?? 0))
  const quantity   = closeVol * contractSize
  // realised = realized PnL; p.realizedPnl is always undefined from CCXT for MEXC
  const pnl        = Number(p.realizedPnl ?? info.realised ?? 0)
  const fee        = Number(info.fee ?? 0)
  const fundingCost = Number(info.holdFee ?? 0)
  const notional   = entryPrice * quantity

  // TEMP DIAG — remove after fee investigation
  if (fee !== 0) {
    console.log('[MEXC fee diag]', {
      symbol: p.symbol,
      'info.fee': info.fee,
      'info.holdFee': info.holdFee,
      'info.realised': info.realised,
      'info.closeProfitLoss': info.closeProfitLoss,
      fee,
      pnl,
    })
  }

  return {
    id:           String(p.id ?? info.positionId ?? Math.random()),
    subAccountId: 'mexc',
    exchangeId:   'mexc' as ExchangeId,
    symbol:       p.symbol ?? 'UNKNOWN',
    side:         p.side === 'short' ? 'short' : 'long',
    tradeType:    'futures',
    entryPrice,
    exitPrice,
    quantity,
    pnl,
    pnlPercent:   notional > 0 ? (pnl / notional) * 100 : 0,
    fee,
    durationMin:  Math.round((new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 60000),
    leverage:     Number(p.leverage ?? info.leverage ?? 1),
    fundingCost,
    isOvernight:  new Date(openedAt).getUTCDate() !== new Date(closedAt).getUTCDate(),
    openedAt,
    closedAt,
  }
}

export class MexcAdapter implements ExchangeAdapter {
  private spot: ccxt.mexc
  private swap: ccxt.mexc

  constructor(credentials: MexcCredentials) {
    const common = {
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      enableRateLimit: true,
    }
    this.spot = new ccxt.mexc({ ...common, options: { defaultType: 'spot' } })
    this.swap = new ccxt.mexc({ ...common, options: { defaultType: 'swap' } })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.spot.fetchBalance()
      return true
    } catch {
      return false
    }
  }

  async fetchBalance(): Promise<BalanceResult> {
    const [spotResult, swapResult] = await Promise.allSettled([
      this.spot.fetchBalance(),
      this.swap.fetchBalance(),
    ])

    if (spotResult.status === 'rejected' && swapResult.status === 'rejected') {
      throw spotResult.reason
    }

    let usdt = 0
    const tokens: Record<string, number> = {}

    for (const result of [spotResult, swapResult]) {
      if (result.status !== 'fulfilled') continue
      const total = (result.value.total ?? {}) as unknown as Record<string, number>
      usdt += total['USDT'] ?? 0
      for (const [symbol, amount] of Object.entries(total)) {
        if (symbol !== 'USDT' && typeof amount === 'number' && amount > 0) {
          tokens[symbol] = (tokens[symbol] ?? 0) + amount
        }
      }
    }

    return { usdt, tokens }
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    _limit?: number,
    until?: number,
  ): Promise<Trade[]> {
    // MEXC swap: fetchPositionsHistory does not require a symbol argument.
    // One closed position = one futures trade with realized PnL.
    // Do NOT pass 'since' to CCXT — MEXC errors with code 6003 ("up to 90 days only")
    // because CCXT internally sets end_time=now, making the range since→now exceed 90 days.
    // Fetch all pages (MEXC max ~90 days) and filter client-side by chunk window.
    // Spot: skipped — fetchMyTrades requires symbol (separate future task).
    const PAGE_SIZE = 100
    const allPositions: ccxt.Position[] = []
    let pageNum = 1

    while (true) {
      const page = await this.swap
        .fetchPositionsHistory(undefined, undefined, PAGE_SIZE, { page_num: pageNum })
        .catch((err: Error) => {
          console.error('[MEXC getTrades] fetchPositionsHistory page', pageNum, 'failed:', err?.message ?? err)
          return [] as ccxt.Position[]
        })

      if (page.length === 0) break
      allPositions.push(...page)
      if (page.length < PAGE_SIZE) break
      pageNum++
    }

    // markets are already loaded by fetchPositionsHistory internally
    return allPositions
      .map((p) => {
        const contractSize = Number(this.swap.market(p.symbol ?? '')?.contractSize ?? 1)
        return mapMexcPositionHistory(p, contractSize, since, until)
      })
      .filter((t): t is Trade => t !== null)
  }

  async fetchPositions(): Promise<RawPosition[]> {
    try {
      const raw = await this.swap.fetchPositions()
      return raw
        .filter((p) => p.contracts && Math.abs(Number(p.contracts)) > 0)
        .map((p): RawPosition => {
          const symbol = p.symbol ?? ''
          return {
            symbol: symbol.includes(':') ? symbol.split(':')[0] : symbol,
            side: (p.side === 'short' ? 'short' : 'long') as 'long' | 'short',
            size: Math.abs(Number(p.contracts ?? 0) * Number(p.contractSize ?? 1)),
            entryPrice: Number(p.entryPrice ?? 0),
            markPrice: Number(p.markPrice ?? 0),
            notional: Math.abs(Number(p.notional ?? 0)),
            unrealizedPnl: Number(p.unrealizedPnl ?? 0),
            leverage: Number(p.leverage ?? 1),
            margin: Number(p.initialMargin ?? 0),
            liquidationPrice: Number(p.liquidationPrice ?? 0),
            openTimestamp: Number(p.timestamp ?? 0),
          }
        })
    } catch {
      return []
    }
  }

  getDailyPnL(_subAccountId: string, _dateRange: DateRange): Promise<DailyPnLEntry[]> {
    return Promise.resolve([])
  }
}
