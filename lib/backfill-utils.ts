/**
 * Pure helpers shared between balance-backfill, transactions-backfill, and their tests.
 * No server-only imports — safe to use in Jest.
 */

// ---------------------------------------------------------------------------
// Bybit: group transaction-log rows by day, keeping the last cashBalance per day
// ---------------------------------------------------------------------------

export function groupByDay(
  rows: Array<Record<string, string>>,
): Record<string, number> {
  const map: Record<string, { time: number; balance: number }> = {}
  for (const row of rows) {
    const t    = Number(row['transactionTime'])
    const date = new Date(t).toISOString().slice(0, 10)
    if (!map[date] || t > map[date].time) {
      map[date] = { time: t, balance: Number(row['cashBalance']) }
    }
  }
  const result: Record<string, number> = {}
  for (const [date, { balance }] of Object.entries(map)) result[date] = balance
  return result
}

// ---------------------------------------------------------------------------
// Bybit: extract TRANSFER_IN / TRANSFER_OUT from transaction-log rows
// ---------------------------------------------------------------------------

export interface BybitTxLogRow {
  type:            string
  id:              string
  currency?:       string
  cashFlow?:       string
  change?:         string
  transactionTime?: string
}

export interface TransactionRecord {
  account_id:  string
  exchange:    string
  type:        'deposit' | 'withdrawal'
  asset:       string
  amount:      number
  fee:         null
  status:      string
  tx_id:       string
  recorded_at: string
}

export interface FundingFeeRecord {
  account_id:  string
  exchange:    string
  type:        'funding_fee'
  asset:       string
  amount:      number   // signed: positive = received, negative = paid
  fee:         null
  status:      string
  tx_id:       string
  recorded_at: string
}

/** Extracts perpetual funding fee settlements (type=SETTLEMENT) from a Bybit transaction log. */
export function extractBybitFundingFees(
  rows: BybitTxLogRow[],
  accountId: string,
): FundingFeeRecord[] {
  const result: FundingFeeRecord[] = []
  for (const row of rows) {
    if (row.type !== 'SETTLEMENT') continue
    if (!row.id) continue
    const amount = Number(row.cashFlow ?? row.change ?? 0)
    if (amount === 0) continue
    result.push({
      account_id:  accountId,
      exchange:    'bybit',
      type:        'funding_fee',
      asset:       row.currency ?? 'USDT',
      amount,
      fee:         null,
      status:      'completed',
      tx_id:       `funding_${row.id}`,
      recorded_at: new Date(Number(row.transactionTime ?? 0)).toISOString(),
    })
  }
  return result
}

export function extractBybitTransfers(
  rows: BybitTxLogRow[],
  accountId: string,
): TransactionRecord[] {
  const result: TransactionRecord[] = []
  for (const row of rows) {
    if (row.type !== 'TRANSFER_IN' && row.type !== 'TRANSFER_OUT') continue
    if (!row.id) continue
    const cashFlow = Number(row.cashFlow ?? row.change ?? 0)
    if (cashFlow === 0) continue
    result.push({
      account_id:  accountId,
      exchange:    'bybit',
      type:        row.type === 'TRANSFER_IN' ? 'deposit' : 'withdrawal',
      asset:       row.currency ?? 'USDT',
      amount:      Math.abs(cashFlow),
      fee:         null,
      status:      'completed',
      tx_id:       `txlog_${row.id}`,
      recorded_at: new Date(Number(row.transactionTime ?? 0)).toISOString(),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Binance: extract USDT balance from snapshot asset list
// Handles both FUTURES (assets[].walletBalance) and MARGIN (userAssets[].free)
// ---------------------------------------------------------------------------

export interface BinanceSnapshotAsset {
  asset:          string
  walletBalance?: string
  free?:          string
  netAsset?:      string
}

export interface BinanceSnapshotData {
  assets?:     BinanceSnapshotAsset[]
  balances?:   BinanceSnapshotAsset[]
  userAssets?: BinanceSnapshotAsset[]
}

export function extractUsdtFromSnapshot(data: BinanceSnapshotData): number {
  const assets = data.userAssets ?? data.assets ?? data.balances ?? []
  const usdtRow = assets.find(a => a.asset === 'USDT')
  if (!usdtRow) return 0
  return Number(usdtRow.walletBalance ?? usdtRow.free ?? usdtRow.netAsset ?? 0)
}

// ---------------------------------------------------------------------------
// Binance: merge FUTURES + MARGIN balance maps per date
//
// portfolio_margin: separate sub-accounts → sum them
// unified:          same pool shown twice → use futures, fall back to margin
// ---------------------------------------------------------------------------

export function mergeBinanceBalances(
  futuresMap: Record<string, number>,
  marginMap:  Record<string, number>,
  isPortfolioMargin: boolean,
): Record<string, number> {
  const allDates = new Set([...Object.keys(futuresMap), ...Object.keys(marginMap)])
  const result: Record<string, number> = {}
  for (const date of allDates) {
    const f = futuresMap[date] ?? 0
    const m = marginMap[date] ?? 0
    result[date] = isPortfolioMargin ? f + m : (f > 0 ? f : m)
  }
  return result
}
