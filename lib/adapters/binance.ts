import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult } from './types'
import type { DailyPnLEntry, Trade, DateRange } from '../types'
import { mapCcxtTrade } from './ccxt-utils'

interface BinanceCredentials {
  apiKey: string
  apiSecret: string
  type?: 'spot' | 'future'
}

export interface FullTradesResult {
  trades: Trade[]
  failedSymbols: { symbol: string; error: string }[]
}

// Top-50 most-traded USDT pairs — always included in quick sync
const TOP_50_SYMBOLS = [
  'BTC/USDT',   'ETH/USDT',   'BNB/USDT',   'SOL/USDT',   'XRP/USDT',
  'DOGE/USDT',  'ADA/USDT',   'AVAX/USDT',  'SHIB/USDT',  'TRX/USDT',
  'TON/USDT',   'LINK/USDT',  'DOT/USDT',   'MATIC/USDT', 'DAI/USDT',
  'LTC/USDT',   'BCH/USDT',   'UNI/USDT',   'ATOM/USDT',  'XLM/USDT',
  'FIL/USDT',   'NEAR/USDT',  'APT/USDT',   'ARB/USDT',   'OP/USDT',
  'ALGO/USDT',  'HBAR/USDT',  'CRO/USDT',   'QNT/USDT',   'EGLD/USDT',
  'FLOW/USDT',  'SAND/USDT',  'MANA/USDT',  'AXS/USDT',   'THETA/USDT',
  'XTZ/USDT',   'EOS/USDT',   'FTM/USDT',   'GALA/USDT',  'ENJ/USDT',
  'CHZ/USDT',   'BAT/USDT',   'ZIL/USDT',   'CRV/USDT',   'AAVE/USDT',
  'SUSHI/USDT', 'COMP/USDT',  'MKR/USDT',   'SNX/USDT',   'YFI/USDT',
]

export class BinanceAdapter implements ExchangeAdapter {
  private exchange: ccxt.binance

  constructor(credentials: BinanceCredentials) {
    this.exchange = new ccxt.binance({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      ...(credentials.type === 'future' ? { options: { defaultType: 'future' } } : {}),
    })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.fetchBalance()
      return true
    } catch {
      return false
    }
  }

  async fetchBalance(): Promise<BalanceResult> {
    const walletTypes = ['spot', 'future', 'delivery'] as const

    const results = await Promise.allSettled(
      walletTypes.map((type) => this.exchange.fetchBalance({ type }))
    )

    let usdt = 0
    const tokens: Record<string, number> = {}
    let anySucceeded = false

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      anySucceeded = true
      const total = (result.value.total ?? {}) as unknown as Record<string, number>
      usdt += total['USDT'] ?? 0
      for (const [symbol, amount] of Object.entries(total)) {
        if (symbol !== 'USDT' && typeof amount === 'number' && amount > 0) {
          tokens[symbol] = (tokens[symbol] ?? 0) + amount
        }
      }
    }

    if (!anySucceeded) {
      const firstRejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (firstRejected) throw firstRejected.reason
      throw new Error('fetchBalance: all wallet types failed')
    }

    return { usdt, tokens }
  }

  async getDailyPnL(_subAccountId: string, _dateRange: DateRange): Promise<DailyPnLEntry[]> {
    return []
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    _limit?: number,
  ): Promise<Trade[]> {
    // Fetch spot balance to derive token-based symbol list
    let balanceTokens: string[] = []
    try {
      const bal = await this.exchange.fetchBalance({ type: 'spot' })
      const total = (bal.total ?? {}) as unknown as Record<string, number>
      balanceTokens = Object.entries(total)
        .filter(([sym, amt]) => sym !== 'USDT' && typeof amt === 'number' && amt > 0)
        .map(([sym]) => `${sym}/USDT`)
    } catch {
      // If balance fetch fails, proceed with top-50 only
    }

    const symbolSet = new Set([...TOP_50_SYMBOLS, ...balanceTokens])
    const symbols = Array.from(symbolSet)

    const trades: Trade[] = []
    for (const symbol of symbols) {
      try {
        const raw = await this.exchange.fetchMyTrades(symbol, since, 1000)
        for (const t of raw) trades.push(mapCcxtTrade(t, 'binance'))
      } catch {
        // Skip symbol on error — not fatal for quick sync
      }
    }
    return trades
  }

  // Full 180-day scan — called by /api/sync/binance/full only (not on ExchangeAdapter interface).
  // Note: accountId is intentionally NOT a parameter — the route owns account identity;
  // this method only receives the symbol slice for the current chunk.
  async getFullTrades(symbols: string[]): Promise<FullTradesResult> {
    const since = Date.now() - 180 * 24 * 60 * 60 * 1000
    const trades: Trade[] = []
    const failedSymbols: { symbol: string; error: string }[] = []

    for (const symbol of symbols) {
      let succeeded = false
      let lastError = ''

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await this.exchange.fetchMyTrades(symbol, since, 1000)
          for (const t of raw) trades.push(mapCcxtTrade(t, 'binance'))
          succeeded = true
          break
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
        }
      }

      if (!succeeded) failedSymbols.push({ symbol, error: lastError })
    }

    return { trades, failedSymbols }
  }
}
