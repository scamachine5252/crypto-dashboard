import type { DailyPnLEntry, Trade, DateRange } from '../types'

export interface BalanceResult {
  usdt: number
  tokens: Record<string, number>
}

export interface ExchangeAdapter {
  getDailyPnL(subAccountId: string, dateRange: DateRange): Promise<DailyPnLEntry[]>
  getTrades(subAccountId: string, dateRange: DateRange, since?: number, limit?: number): Promise<Trade[]>
  testConnection(): Promise<boolean>
  fetchBalance(): Promise<BalanceResult>
}
