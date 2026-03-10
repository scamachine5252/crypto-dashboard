import type { DailyPnLEntry, Trade, DateRange } from '../types'

export interface ExchangeAdapter {
  getDailyPnL(subAccountId: string, dateRange: DateRange): Promise<DailyPnLEntry[]>
  getTrades(subAccountId: string, dateRange: DateRange): Promise<Trade[]>
  testConnection(): Promise<boolean>
}
