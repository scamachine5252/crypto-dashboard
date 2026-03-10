export type ExchangeId = 'binance' | 'bybit' | 'okx'
export type Timeframe = 'daily' | 'weekly' | 'monthly'
export type TradeSide = 'long' | 'short'

export interface SubAccount {
  id: string
  name: string
  exchangeId: ExchangeId
}

export interface ExchangeConfig {
  id: ExchangeId
  name: string
  color: string
  subAccounts: SubAccount[]
}

export interface Trade {
  id: string
  subAccountId: string
  exchangeId: ExchangeId
  symbol: string
  side: TradeSide
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  pnlPercent: number
  fee: number
  openedAt: string
  closedAt: string
}

export interface DailyPnLEntry {
  date: string
  pnl: number
  cumulativePnl: number
  exchangeId: ExchangeId
  subAccountId: string
}

export interface ChartDataPoint {
  period: string
  pnl: number
  cumulativePnl: number
}

export interface Metrics {
  sharpeRatio: number
  sortinoRatio: number
  maxDrawdown: number
  maxDrawdownPct: number
  winRate: number
  profitFactor: number
  cagr: number
  annualYield: number
  riskReward: number
  averageWin: number
  averageLoss: number
  totalFees: number
  totalPnl: number
  totalTrades: number
}

export interface FilterState {
  exchangeId: ExchangeId | 'all'
  subAccountId: string | 'all'
  timeframe: Timeframe
}
