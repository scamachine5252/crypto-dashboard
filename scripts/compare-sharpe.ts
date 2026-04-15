/**
 * compare-sharpe.ts
 * Fetches real trades from Supabase and prints a comparison of Sharpe / Sortino
 * computed with the CURRENT formula vs the CORRECTED formula.
 *
 * Run:  npx ts-node --project tsconfig.json scripts/compare-sharpe.ts
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
)

// ---------------------------------------------------------------------------
// CURRENT formula (as in calculateMetrics today)
// - Only trading days
// - Population variance ÷ n
// ---------------------------------------------------------------------------
function sharpeCurrent(dailyPnls: number[]): { sharpe: number; sortino: number; n: number } {
  const n = dailyPnls.length
  if (n === 0) return { sharpe: 0, sortino: 0, n: 0 }

  const mean = dailyPnls.reduce((a, b) => a + b, 0) / n
  const variance = dailyPnls.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0

  const downReturns = dailyPnls.filter((r) => r < 0)
  const downsideVar = downReturns.length > 0
    ? downReturns.reduce((s, r) => s + r ** 2, 0) / n
    : 0
  const sortino = Math.sqrt(downsideVar) > 0
    ? (mean / Math.sqrt(downsideVar)) * Math.sqrt(252)
    : 0

  return { sharpe: r2(sharpe), sortino: r2(sortino), n }
}

// ---------------------------------------------------------------------------
// CORRECTED formula
// - Calendar days (fills zeros for non-trading days between first and last)
// - Sample variance ÷ (n-1)
// ---------------------------------------------------------------------------
function sharpeFixed(dailyPnls: number[], dates: string[]): { sharpe: number; sortino: number; n: number } {
  if (dates.length === 0) return { sharpe: 0, sortino: 0, n: 0 }

  // Fill calendar days with 0 between first and last trade date
  const pnlByDate = new Map(dates.map((d, i) => [d, dailyPnls[i]]))
  const first = new Date(dates[0] + 'T00:00:00Z')
  const last  = new Date(dates[dates.length - 1] + 'T00:00:00Z')
  const filled: number[] = []
  const cur = new Date(first)
  while (cur <= last) {
    const key = cur.toISOString().slice(0, 10)
    filled.push(pnlByDate.get(key) ?? 0)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  const n = filled.length
  if (n < 2) return { sharpe: 0, sortino: 0, n }

  const mean = filled.reduce((a, b) => a + b, 0) / n
  // Sample variance ÷ (n-1)
  const variance = filled.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)
  const std = Math.sqrt(variance)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0

  const downReturns = filled.filter((r) => r < 0)
  const downsideVar = downReturns.length > 0
    ? downReturns.reduce((s, r) => s + r ** 2, 0) / (n - 1)
    : 0
  const sortino = Math.sqrt(downsideVar) > 0
    ? (mean / Math.sqrt(downsideVar)) * Math.sqrt(252)
    : 0

  return { sharpe: r2(sharpe), sortino: r2(sortino), n }
}

function r2(v: number) { return Math.round(v * 100) / 100 }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Fetch all accounts
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('id, account_name, exchange')
    .order('exchange')

  if (accErr || !accounts) { console.error('accounts error:', accErr); return }

  // Fetch all futures trades (last 365 days)
  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()
  const PAGE = 1000
  const allTrades: Array<{ account_id: string; closed_at: string; pnl: string | null; trade_type: string }> = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('trades')
      .select('account_id, closed_at, pnl, trade_type')
      .gte('closed_at', since)
      .not('closed_at', 'is', null)
      .range(from, from + PAGE - 1)
      .order('closed_at', { ascending: true })
    if (error || !data || data.length === 0) break
    allTrades.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  const futuresTrades = allTrades.filter((t) => t.trade_type === 'futures' && Number(t.pnl ?? 0) !== 0)

  console.log(`\nFetched ${futuresTrades.length} closing futures trades across ${accounts.length} accounts\n`)

  const header = [
    'Account'.padEnd(28),
    'Exch'.padEnd(8),
    'Days(cur)'.padEnd(10),
    'Sharpe(cur)'.padEnd(13),
    'Sortino(cur)'.padEnd(14),
    'Days(new)'.padEnd(10),
    'Sharpe(new)'.padEnd(13),
    'Sortino(new)'.padEnd(14),
    'ΔSharpe'.padEnd(10),
    'ΔSortino',
  ].join('')
  console.log(header)
  console.log('─'.repeat(header.length))

  for (const acc of accounts) {
    const trades = futuresTrades.filter((t) => t.account_id === acc.id)
    if (trades.length === 0) {
      console.log(`${acc.account_name.padEnd(28)}${acc.exchange.padEnd(8)}${'(no futures trades)'}`)
      continue
    }

    // Build daily PnL (trading days only)
    const dayMap = new Map<string, number>()
    for (const t of trades) {
      const d = t.closed_at.slice(0, 10)
      dayMap.set(d, (dayMap.get(d) ?? 0) + Number(t.pnl ?? 0))
    }
    const sortedDates = [...dayMap.keys()].sort()
    const tradingPnls = sortedDates.map((d) => dayMap.get(d)!)

    const cur  = sharpeCurrent(tradingPnls)
    const fixed = sharpeFixed(tradingPnls, sortedDates)

    const dSharpe  = r2(fixed.sharpe  - cur.sharpe)
    const dSortino = r2(fixed.sortino - cur.sortino)

    console.log([
      acc.account_name.slice(0, 27).padEnd(28),
      acc.exchange.padEnd(8),
      String(cur.n).padEnd(10),
      String(cur.sharpe).padEnd(13),
      String(cur.sortino).padEnd(14),
      String(fixed.n).padEnd(10),
      String(fixed.sharpe).padEnd(13),
      String(fixed.sortino).padEnd(14),
      (dSharpe  >= 0 ? '+' : '') + String(dSharpe).padEnd(9),
      (dSortino >= 0 ? '+' : '') + String(dSortino),
    ].join(''))
  }

  console.log('\nLegend:')
  console.log('  cur  = current:  trading days only, population variance ÷n')
  console.log('  new  = fixed:    calendar days (zeros filled), sample variance ÷(n-1)')
  console.log('  Δ    = new - cur (negative = new formula gives lower/more conservative ratio)')
}

main().catch(console.error)
