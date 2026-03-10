import type { DailyPnLEntry, Trade, DateRange } from '../types'
import type { ExchangeAdapter } from './types'
import { getAllDailyPnL, getAllTrades } from '../mock-data'
import { filterByDateRange } from '../calculations'

export class MockAdapter implements ExchangeAdapter {
  async getDailyPnL(subAccountId: string, dateRange: DateRange): Promise<DailyPnLEntry[]> {
    const all = getAllDailyPnL().filter((e) =>
      subAccountId === 'all' || e.subAccountId === subAccountId
    )
    return filterByDateRange(all, dateRange)
  }

  async getTrades(subAccountId: string, dateRange: DateRange): Promise<Trade[]> {
    return getAllTrades().filter((t) => {
      if (subAccountId !== 'all' && t.subAccountId !== subAccountId) return false
      const closed = t.closedAt.slice(0, 10)
      return closed >= dateRange.start && closed <= dateRange.end
    })
  }

  async testConnection(): Promise<boolean> {
    return true
  }
}
