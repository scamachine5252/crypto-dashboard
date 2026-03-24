import type { DailyPnLEntry, Trade, DateRange } from '../types'

export interface BalanceResult {
  usdt: number
  tokens: Record<string, number>
}

export interface RawPosition {
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  markPrice: number
  notional: number
  unrealizedPnl: number
  leverage: number
  margin: number
}

export interface ExchangeAdapter {
  getDailyPnL(subAccountId: string, dateRange: DateRange): Promise<DailyPnLEntry[]>
  getTrades(subAccountId: string, dateRange: DateRange, since?: number, limit?: number, until?: number): Promise<Trade[]>
  testConnection(): Promise<boolean>
  fetchBalance(): Promise<BalanceResult>
  fetchPositions(): Promise<RawPosition[]>
}
