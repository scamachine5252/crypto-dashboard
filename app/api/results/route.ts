import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

type BalRow   = { account_id: string; usdt_balance: number; total_equity_usdt: number | null; recorded_at: string }
type TradeRow = { account_id: string; pnl: number | null; fee: number | null; closed_at: string }
type TxRow    = { account_id: string; type: string; amount: number; recorded_at: string }
type AccRow   = { id: string; account_name: string; exchange: string; fund: string; instrument: string; initial_aum?: number | null }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const since = Number(req.nextUrl.searchParams.get('since') ?? '0')
  const until = Number(req.nextUrl.searchParams.get('until') ?? Date.now())

  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, fund, instrument, initial_aum')

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ accounts: [], navHistory: [], accountSummaries: [] })
  }

  const accountIds = (accounts as AccRow[]).map((a) => a.id)
  const pmAccountIds = new Set((accounts as AccRow[]).filter((a) => a.instrument === 'portfolio_margin').map((a) => a.id))
  const sinceDate = new Date(since).toISOString()
  const untilDate = new Date(until).toISOString()

  // Fetch ALL USDT balance snapshots (no date filter) — needed for NAV baseline detection
  const PAGE = 1000
  const allBalances: BalRow[] = []
  let balFrom = 0
  while (true) {
    const { data, error: balErr } = await supabaseAdmin
      .from('balances')
      .select('account_id, usdt_balance, total_equity_usdt, recorded_at')
      .in('account_id', accountIds)
      .is('token_symbol', null)
      .order('recorded_at', { ascending: true })
      .order('account_id', { ascending: true })
      .range(balFrom, balFrom + PAGE - 1)
    if (balErr) return NextResponse.json({ error: balErr.message }, { status: 500 })
    if (!data || data.length === 0) break
    allBalances.push(...(data as BalRow[]))
    if (data.length < PAGE) break
    balFrom += PAGE
  }

  // Effective balance helper (equity-first for non-PM; usdt_balance for PM)
  const effectiveBal = (row: BalRow) =>
    pmAccountIds.has(row.account_id)
      ? Number(row.usdt_balance)
      : Number(row.total_equity_usdt ?? row.usdt_balance)

  // First snapshot per account — used as fallback initial capital
  const firstBalMap: Record<string, number> = {}
  for (const row of allBalances) {
    if (!(row.account_id in firstBalMap)) {
      firstBalMap[row.account_id] = effectiveBal(row)
    }
  }

  // Group by (account_id, date) — last snapshot per day wins
  const allDayMap: Record<string, Record<string, number>> = {}
  for (const row of allBalances) {
    const date = row.recorded_at.slice(0, 10)
    if (!allDayMap[row.account_id]) allDayMap[row.account_id] = {}
    allDayMap[row.account_id][date] = effectiveBal(row)
  }

  // Fetch ALL transactions (no date filter) for cumulative deposit/withdrawal tracking
  const allTx: TxRow[] = []
  let txFrom = 0
  while (true) {
    const { data, error: txErr } = await supabaseAdmin
      .from('transactions')
      .select('account_id, type, amount, recorded_at')
      .in('account_id', accountIds)
      .order('recorded_at', { ascending: true })
      .range(txFrom, txFrom + PAGE - 1)
    if (txErr) break
    if (!data || data.length === 0) break
    allTx.push(...(data as TxRow[]))
    if (data.length < PAGE) break
    txFrom += PAGE
  }

  // Group transactions by account, sorted ascending (already ordered)
  const txByAccount: Record<string, TxRow[]> = {}
  for (const tx of allTx) {
    if (tx.type === 'income') continue
    if (!txByAccount[tx.account_id]) txByAccount[tx.account_id] = []
    txByAccount[tx.account_id].push(tx)
  }

  // Compute NAV per (account, date)
  //
  // Two modes depending on whether initial_aum is known:
  //
  // A) initial_aum IS SET (e.g. Filimonov, DFI):
  //    The initial deposit predates our transaction tracking — it is NOT in the
  //    transactions table. Every row in transactions is a SUBSEQUENT capital flow.
  //    NAV = (balance - subsequentDeposits + subsequentWithdrawals) / initial_aum
  //    At inception (no subsequent flows): NAV = initial_balance / initial_aum ≈ 1.0
  //
  // B) initial_aum NOT SET (Ryan, Leonardo, Continum, …):
  //    We don't know the exact initial investment. Use the first ever balance
  //    snapshot as baseline and skip transaction adjustment — it avoids double-
  //    counting for accounts whose initial deposit IS captured in transactions
  //    (Ryan/Leonardo start at 1.0 naturally since firstSnapshot ≈ deposit amount).
  //    NAV = balance / firstSnapshot
  const navHistory: { accountId: string; date: string; nav: number }[] = []

  for (const acc of accounts as AccRow[]) {
    const dateBalMap = allDayMap[acc.id]
    if (!dateBalMap) continue

    const sortedDates = Object.keys(dateBalMap).sort()
    if (sortedDates.length === 0) continue

    if (acc.initial_aum != null) {
      // Mode A: initial_aum known, strip only subsequent (post-initial) flows
      const initialCapital = Number(acc.initial_aum)
      if (initialCapital <= 0) continue

      const txList = txByAccount[acc.id] ?? []
      let txIdx = 0
      let cumDeps = 0
      let cumWith = 0

      for (const date of sortedDates) {
        while (txIdx < txList.length && txList[txIdx].recorded_at.slice(0, 10) <= date) {
          const tx = txList[txIdx]
          if (tx.type === 'deposit')         cumDeps += Number(tx.amount)
          else if (tx.type === 'withdrawal') cumWith += Number(tx.amount)
          txIdx++
        }
        const bal = dateBalMap[date]
        const nav = (bal - cumDeps + cumWith) / initialCapital

        if (date >= sinceDate.slice(0, 10) && date <= untilDate.slice(0, 10)) {
          navHistory.push({ accountId: acc.id, date, nav })
        }
      }
    } else {
      // Mode B: no initial_aum — use first-ever snapshot as baseline, no tx adjustment
      const initialCapital = firstBalMap[acc.id] ?? 0
      if (initialCapital <= 0) continue

      for (const date of sortedDates) {
        const nav = dateBalMap[date] / initialCapital

        if (date >= sinceDate.slice(0, 10) && date <= untilDate.slice(0, 10)) {
          navHistory.push({ accountId: acc.id, date, nav })
        }
      }
    }

  }

  // Fetch trades for PnL/fee aggregation in range — paginated
  const tradeRows: TradeRow[] = []
  let trFrom = 0
  while (true) {
    const { data, error: tradeErr } = await supabaseAdmin
      .from('trades')
      .select('account_id, pnl, fee, closed_at')
      .in('account_id', accountIds)
      .gte('closed_at', sinceDate)
      .lte('closed_at', untilDate)
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: true })
      .order('id', { ascending: true })
      .range(trFrom, trFrom + PAGE - 1)
    if (tradeErr) return NextResponse.json({ error: tradeErr.message }, { status: 500 })
    if (!data || data.length === 0) break
    tradeRows.push(...(data as TradeRow[]))
    if (data.length < PAGE) break
    trFrom += PAGE
  }

  // Net deposits per account in range
  const netDepositsMap: Record<string, number> = {}
  for (const tx of allTx) {
    if (tx.type === 'income') continue
    const txDate = tx.recorded_at.slice(0, 10)
    if (txDate < sinceDate.slice(0, 10) || txDate > untilDate.slice(0, 10)) continue
    const sign = tx.type === 'deposit' ? 1 : -1
    netDepositsMap[tx.account_id] = (netDepositsMap[tx.account_id] ?? 0) + sign * Number(tx.amount)
  }

  // Last balance per account strictly BEFORE sinceDate — used as startUsdt
  const { data: priorBals } = await supabaseAdmin
    .from('balances')
    .select('account_id, usdt_balance, total_equity_usdt')
    .in('account_id', accountIds)
    .is('token_symbol', null)
    .lt('recorded_at', sinceDate)
    .order('recorded_at', { ascending: false })

  type PriorBalRow = { account_id: string; usdt_balance: number; total_equity_usdt: number | null }
  const startBalMap: Record<string, number> = {}
  const seenPrior = new Set<string>()
  for (const row of (priorBals ?? []) as PriorBalRow[]) {
    if (!seenPrior.has(row.account_id)) {
      startBalMap[row.account_id] = pmAccountIds.has(row.account_id)
        ? Number(row.usdt_balance)
        : Number(row.total_equity_usdt ?? row.usdt_balance)
      seenPrior.add(row.account_id)
    }
  }

  // Balance day map restricted to the requested date range (for endUsdt)
  const rangeDayMap: Record<string, Record<string, number>> = {}
  for (const [accountId, dateMap] of Object.entries(allDayMap)) {
    for (const [date, val] of Object.entries(dateMap)) {
      if (date >= sinceDate.slice(0, 10) && date <= untilDate.slice(0, 10)) {
        if (!rangeDayMap[accountId]) rangeDayMap[accountId] = {}
        rangeDayMap[accountId][date] = val
      }
    }
  }

  // Account summaries
  const accountSummaries = (accounts as AccRow[]).map((acc) => {
    const accDates = Object.keys(rangeDayMap[acc.id] ?? {}).sort()
    const startUsdt = startBalMap[acc.id] ?? (acc.initial_aum != null ? Number(acc.initial_aum) : 0)
    const endUsdt   = accDates.length > 0 ? rangeDayMap[acc.id][accDates[accDates.length - 1]] : 0
    const accTrades = tradeRows.filter((t) => t.account_id === acc.id)
    const totalFees = accTrades.reduce((s, t) => s + Number(t.fee ?? 0), 0)
    const totalPnl  = accTrades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
    const netDeposits   = netDepositsMap[acc.id] ?? 0
    const deltaUsdt     = endUsdt - startUsdt
    const tradingResult = deltaUsdt - netDeposits
    return {
      accountId:   acc.id,
      accountName: acc.account_name,
      exchange:    acc.exchange,
      fund:        acc.fund,
      startUsdt,
      endUsdt,
      deltaUsdt,
      netDeposits,
      tradingResult,
      totalFees,
      totalPnl,
    }
  })

  return NextResponse.json({ accounts, navHistory, accountSummaries })
}
