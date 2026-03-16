export type ExchangeId = 'binance' | 'bybit' | 'okx'
export type Timeframe = 'daily' | 'weekly' | 'monthly'
export type TradeSide = 'long' | 'short'
export type TradeType = 'spot' | 'futures'
export type Period = '1D' | '1W' | '1M' | '1Y' | 'manual'
export type ConnectionStatus = 'connected' | 'error' | 'not_configured'

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

export interface DateRange {
  start: string  // ISO date YYYY-MM-DD
  end: string    // ISO date YYYY-MM-DD
}

export interface Trade {
  id: string
  subAccountId: string
  exchangeId: ExchangeId
  symbol: string
  side: TradeSide
  tradeType: TradeType
  entryPrice: number
  exitPrice: number
  quantity: number
  pnl: number
  pnlPercent: number
  fee: number
  durationMin: number
  leverage: number      // 1 for spot/options; 3-25 for futures
  fundingCost: number   // cumulative funding paid (futures only, 0 otherwise)
  isOvernight: boolean  // position spanned at least one midnight UTC
  openedAt: string
  closedAt: string
}

export interface FuturesMetrics {
  totalFundingCost: number        // sum of all funding costs across futures trades
  averageLeverage: number         // simple average leverage on futures trades
  longShortRatio: number          // % of futures trades that are long (0-100)
  liquidationDistancePct: number  // avg theoretical liq distance = 100 / leverage %
  overnightExposureCount: number  // count of all trades held past midnight
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
  period: Period
}

export interface HistoryFilterState {
  exchangeId: ExchangeId | 'all'
  subAccountId: string | 'all'
  symbol: string
  tradeType: TradeType | 'all'
  side: TradeSide | 'all'
  dateRange: DateRange
  page: number
}

export interface MetricTimeSeries {
  date: string
  [accountId: string]: number | string
}

export interface AccountSummary {
  subAccountId: string
  exchangeId: ExchangeId
  name: string
  balance: number
  pnl: number
  pnlPct: number
}

export interface ApiKeyConfig {
  exchangeId: ExchangeId
  apiKey: string
  apiSecret: string
  passphrase?: string  // OKX only
}

export interface BalanceTransaction {
  date: string          // YYYY-MM-DD
  subAccountId: string
  exchangeId: ExchangeId
  usdtAmount: number    // always positive; sign determined by type
  tokenAmount: number   // always positive
  token: string         // e.g. "BTC"
  type: 'deposit' | 'withdrawal'
}

export interface AccountSnapshot {
  subAccountId: string
  exchangeId: ExchangeId
  accountName: string
  token: string
  usdtOpen: number
  usdtClose: number
  deltaUsdt: number
  tokenOpen: number
  tokenClose: number
  deltaToken: number
  depositUsdt: number
  withdrawalUsdt: number
  depositToken: number
  withdrawalToken: number
  avgPrice: number
  pnl: number
}

export interface ComparisonRow {
  // Identity
  subAccountId: string
  exchangeId: ExchangeId
  name: string          // human-readable sub-account name (e.g. "Alpha Fund")

  // Snapshot metrics for the selected period (same fields as Metrics)
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

  // Delta vs baseline (positive = better than baseline, negative = worse)
  // null for the baseline row itself
  delta: {
    sharpeRatio: number | null
    sortinoRatio: number | null
    maxDrawdown: number | null
    maxDrawdownPct: number | null
    winRate: number | null
    profitFactor: number | null
    cagr: number | null
    annualYield: number | null
    riskReward: number | null
    averageWin: number | null
    averageLoss: number | null
    totalFees: number | null
    totalPnl: number | null
    totalTrades: number | null
  }

  isBaseline: boolean   // true for the reference row; its delta fields are all null
}
