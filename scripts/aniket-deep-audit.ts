/**
 * Deep audit of Aniket (Bybit) account trades.
 * Checks:
 *   1. All DB trades — prices, PnL math consistency
 *   2. Raw Bybit API data (current closed-pnl) — compare with DB
 *   3. Per-symbol breakdown with Binance klines price cross-check
 *   4. Fee analysis
 *   5. Data mapping bugs
 *
 * Run: npx tsx scripts/aniket-deep-audit.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

// ── env ────────────────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '../.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SECRET_KEY!
if (!supabaseUrl || !supabaseKey) { console.error('Missing env vars'); process.exit(1) }

const db = createClient(supabaseUrl, supabaseKey)

// Binance public klines — no auth needed, for price cross-check
async function fetchBinanceKline(symbol: string, startTime: number): Promise<{ open: number; high: number; low: number; close: number } | null> {
  // Convert Bybit symbol to Binance: ORDI/USDT:USDT → ORDIUSDT
  const binanceSym = symbol.replace('/', '').replace(':USDT', '').replace(':USDC', '').replace(':BTC', '').toUpperCase()
  if (binanceSym.includes(':')) return null

  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=1m&startTime=${startTime - 60000}&endTime=${startTime + 120000}&limit=3`
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const data = await resp.json() as number[][]
    if (!data || data.length === 0) return null
    const k = data[0]
    return { open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) }
  } catch {
    return null
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
function fmt(n: number, dec = 2) {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(dec)}`
}
function fmtPrice(n: number) {
  if (n >= 1000) return n.toFixed(2)
  if (n >= 1)    return n.toFixed(4)
  return n.toFixed(6)
}
function pnlColor(n: number) {
  return n >= 0 ? '\x1b[32m' : '\x1b[31m'
}
const RESET = '\x1b[0m'
const BOLD  = '\x1b[1m'
const YELLOW = '\x1b[33m'
const DIM   = '\x1b[2m'

type DbTrade = {
  id:          string
  symbol:      string
  side:        string       // 'buy' | 'sell'
  direction:   string       // 'long' | 'short'
  entry_price: number
  exit_price:  number
  quantity:    number
  pnl:         number
  fee:         number
  opened_at:   string
  closed_at:   string
  trade_type:  string
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════════`)
  console.log('  ANIKET (BYBIT) — DEEP TRADE AUDIT')
  console.log(`══════════════════════════════════════════════════════════════${RESET}\n`)

  // 1. Get Aniket account
  const { data: accounts } = await db.from('accounts').select('id, account_name, api_key, api_secret, exchange')
  const acc = (accounts as Array<{ id: string; account_name: string; api_key: string; api_secret: string; exchange: string }>)
    ?.find(a => a.account_name.toLowerCase().includes('aniket'))
  if (!acc) { console.error('Aniket account not found'); process.exit(1) }

  console.log(`Account: ${acc.account_name}  id: ${acc.id}  exchange: ${acc.exchange}`)

  // 2. Fetch all DB trades for Aniket
  const dbTrades: DbTrade[] = []
  let from = 0
  while (true) {
    const { data, error } = await db
      .from('trades')
      .select('id, symbol, side, direction, entry_price, exit_price, quantity, pnl, fee, opened_at, closed_at, trade_type')
      .eq('account_id', acc.id)
      .order('closed_at', { ascending: true })
      .range(from, from + 999)
    if (error || !data || data.length === 0) break
    dbTrades.push(...(data as DbTrade[]))
    if (data.length < 1000) break
    from += 1000
  }

  console.log(`\nDB trades total: ${dbTrades.length}`)

  // Note: Direct Bybit API call skipped — CloudFront blocks non-Vercel IPs.
  // All analysis below uses DB data + public Binance klines.

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION A: PnL math consistency check on DB data
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`${BOLD}══ A. PnL MATH CONSISTENCY (DB DATA) ════════════════════════${RESET}`)
  console.log(`${DIM}Expected: pnl ≈ (exit - entry) × qty for longs, (entry - exit) × qty for shorts${RESET}\n`)

  let mathOk = 0, mathWarn = 0, mathErr = 0
  const mathIssues: string[] = []

  const closingTrades = dbTrades.filter(t => t.pnl !== 0)

  for (const t of closingTrades) {
    const isLong = t.direction === 'long'
    const expectedPnl = isLong
      ? (t.exit_price - t.entry_price) * t.quantity
      : (t.entry_price - t.exit_price) * t.quantity

    if (t.entry_price === 0 || t.exit_price === 0) {
      mathIssues.push(`${YELLOW}ZERO PRICE${RESET} ${t.symbol} ${t.direction} | entry=${t.entry_price} exit=${t.exit_price} | ${t.closed_at?.slice(0,16)}`)
      mathErr++
      continue
    }

    const diff = t.pnl - expectedPnl
    const pctDiff = Math.abs(expectedPnl) > 0.001 ? Math.abs(diff / expectedPnl) * 100 : 0

    if (pctDiff > 20) {
      // Large discrepancy — likely fee/funding baked in or wrong price
      mathIssues.push(`${'\x1b[31m'}MISMATCH ${pctDiff.toFixed(0)}%${RESET} ${t.symbol} ${t.direction} | db_pnl=${fmt(t.pnl)} expected=${fmt(expectedPnl)} diff=${fmt(diff)} | entry=${fmtPrice(t.entry_price)} exit=${fmtPrice(t.exit_price)} qty=${t.quantity} | ${t.closed_at?.slice(0,16)}`)
      mathErr++
    } else if (pctDiff > 5) {
      mathIssues.push(`${YELLOW}WARN ${pctDiff.toFixed(1)}%${RESET} ${t.symbol} ${t.direction} | db_pnl=${fmt(t.pnl)} expected=${fmt(expectedPnl)} diff=${fmt(diff)} | entry=${fmtPrice(t.entry_price)} exit=${fmtPrice(t.exit_price)} qty=${t.quantity} | ${t.closed_at?.slice(0,16)}`)
      mathWarn++
    } else {
      mathOk++
    }
  }

  if (mathIssues.length === 0) {
    console.log(`  ${'\x1b[32m'}✅ All ${closingTrades.length} closing trades pass PnL math check${RESET}`)
  } else {
    console.log(`  ✅ OK: ${mathOk} | ⚠ WARN: ${mathWarn} | ❌ ERR: ${mathErr}\n`)
    mathIssues.slice(0, 30).forEach(l => console.log(`  ${l}`))
    if (mathIssues.length > 30) console.log(`  ... and ${mathIssues.length - 30} more`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION B: Price sanity vs Binance market data
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}══ C. PRICE SANITY vs BINANCE MARKET DATA ═══════════════════${RESET}`)
  console.log(`${DIM}(fetching 1m klines around entry/exit timestamps for each symbol)${RESET}\n`)

  // Group by symbol to avoid duplicate fetches
  const symbolSamples = new Map<string, DbTrade>()
  for (const t of closingTrades) {
    if (!symbolSamples.has(t.symbol)) symbolSamples.set(t.symbol, t)
  }

  let priceOk = 0, priceWarn = 0, priceErr = 0

  for (const [sym, t] of symbolSamples) {
    const closeMs = new Date(t.closed_at).getTime()
    const kline   = await fetchBinanceKline(sym, closeMs)

    if (!kline) {
      console.log(`  ${DIM}${sym.padEnd(25)} — Binance kline not available (new listing or different exchange)${RESET}`)
      continue
    }

    // Entry and exit should be within the day's range (with some margin)
    const entryInRange = t.entry_price >= kline.low * 0.85 && t.entry_price <= kline.high * 1.15
    const exitInRange  = t.exit_price  >= kline.low * 0.85 && t.exit_price  <= kline.high * 1.15

    const entryDevPct = Math.abs(t.entry_price - kline.close) / kline.close * 100
    const exitDevPct  = Math.abs(t.exit_price  - kline.close) / kline.close * 100

    const status = (!entryInRange || !exitInRange || entryDevPct > 30 || exitDevPct > 30)
      ? `${'\x1b[31m'}❌ SUSPICIOUS${RESET}`
      : entryDevPct > 10 || exitDevPct > 10
        ? `${YELLOW}⚠  LARGE DEV${RESET}`
        : `${'\x1b[32m'}✅ OK${RESET}`

    const inRange = (!entryInRange || !exitInRange || entryDevPct > 30 || exitDevPct > 30)
    if (inRange) priceErr++
    else if (entryDevPct > 10 || exitDevPct > 10) priceWarn++
    else priceOk++

    console.log(`  ${status} ${sym.padEnd(28)} entry=${fmtPrice(t.entry_price).padStart(12)} exit=${fmtPrice(t.exit_price).padStart(12)} | mkt_close=${fmtPrice(kline.close).padStart(12)} [${fmtPrice(kline.low)}–${fmtPrice(kline.high)}]`)

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 60))
  }

  console.log(`\n  Price sanity: ✅ ${priceOk}  ⚠ ${priceWarn}  ❌ ${priceErr}`)

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION D: Full trade list with PnL audit
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}══ D. COMPLETE TRADE LIST (closing fills) ════════════════════${RESET}`)

  const headers = ['#', 'Symbol', 'Dir', 'Qty', 'Entry', 'Exit', 'PnL(db)', 'PnL(calc)', 'Δ%', 'Fee', 'Opened', 'Closed']
  console.log(`\n  ${headers.map(h => h.padEnd(14)).join('')}`)
  console.log(`  ${'─'.repeat(headers.length * 14)}`)

  closingTrades.forEach((t, i) => {
    const isLong = t.direction === 'long'
    const calcPnl = isLong
      ? (t.exit_price - t.entry_price) * t.quantity
      : (t.entry_price - t.exit_price) * t.quantity
    const delta = Math.abs(t.pnl) > 0.001 ? ((t.pnl - calcPnl) / Math.abs(t.pnl)) * 100 : 0
    const deltaStr = Math.abs(delta) > 5 ? `${YELLOW}${fmt(delta, 1)}%${RESET}` : `${DIM}${fmt(delta, 1)}%${RESET}`
    const color = pnlColor(t.pnl)

    const row = [
      String(i + 1).padEnd(4),
      t.symbol.replace(':USDT', '').replace('/USDT', '/U').padEnd(16),
      (t.direction === 'long' ? '▲L' : '▽S').padEnd(4),
      t.quantity.toFixed(4).padStart(10),
      fmtPrice(t.entry_price).padStart(12),
      fmtPrice(t.exit_price).padStart(12),
      `${color}${fmt(t.pnl)}${RESET}`.padEnd(18),
      fmt(calcPnl).padStart(10),
      deltaStr.padEnd(12),
      fmt(t.fee, 4).padStart(8),
      (t.opened_at?.slice(0, 16) ?? '').padEnd(18),
      (t.closed_at?.slice(0, 16) ?? ''),
    ]
    console.log(`  ${row.join(' ')}`)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION E: Fee analysis
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}══ F. FEE ANALYSIS ════════════════════════════════════════════${RESET}`)

  const totalPnl  = closingTrades.reduce((s, t) => s + t.pnl, 0)
  const totalFees = closingTrades.reduce((s, t) => s + t.fee, 0)
  const grossPnl  = totalPnl + totalFees  // before fees
  const wins      = closingTrades.filter(t => t.pnl > 0)
  const losses    = closingTrades.filter(t => t.pnl < 0)

  console.log(`\n  Closing trades: ${closingTrades.length}`)
  console.log(`  Wins:  ${wins.length}  (${(wins.length / closingTrades.length * 100).toFixed(1)}%)`)
  console.log(`  Losses: ${losses.length}  (${(losses.length / closingTrades.length * 100).toFixed(1)}%)`)
  console.log(`\n  Gross PnL (before fees): ${pnlColor(grossPnl)}${fmt(grossPnl)}${RESET}`)
  console.log(`  Total fees:               ${pnlColor(-totalFees)}${fmt(-totalFees)}${RESET}`)
  console.log(`  Net PnL:                  ${pnlColor(totalPnl)}${BOLD}${fmt(totalPnl)}${RESET}`)

  // Negative fee sanity check (funding farms can have negative fees)
  const negativeFees = closingTrades.filter(t => t.fee < 0)
  if (negativeFees.length > 0) {
    console.log(`\n  ${YELLOW}⚠ ${negativeFees.length} trades have negative fee (funding income > commission):${RESET}`)
    negativeFees.forEach(t => {
      console.log(`    ${t.symbol} ${t.direction} pnl=${fmt(t.pnl)} fee=${fmt(t.fee, 4)} | ${t.closed_at?.slice(0,16)}`)
    })
  }

  // Per-symbol fee stats
  console.log(`\n  Per-symbol fee summary:`)
  const bySym = new Map<string, { pnl: number; fee: number; count: number }>()
  for (const t of closingTrades) {
    const e = bySym.get(t.symbol) ?? { pnl: 0, fee: 0, count: 0 }
    e.pnl += t.pnl; e.fee += t.fee; e.count++
    bySym.set(t.symbol, e)
  }
  ;[...bySym.entries()]
    .sort(([, a], [, b]) => Math.abs(b.pnl) - Math.abs(a.pnl))
    .forEach(([sym, e]) => {
      const feeRate = Math.abs(e.pnl) > 0 ? (e.fee / Math.abs(e.pnl) * 100) : 0
      const c = pnlColor(e.pnl)
      console.log(`    ${sym.replace(':USDT', '').padEnd(22)} pnl=${c}${fmt(e.pnl).padStart(10)}${RESET}  fee=${fmt(e.fee, 4).padStart(10)}  trades=${String(e.count).padStart(4)}  fee/|pnl|=${feeRate.toFixed(1)}%`)
    })

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION G: Opening fills analysis (pnl=0 rows)
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}══ G. OPENING FILLS (pnl=0 rows) ═════════════════════════════${RESET}`)
  const openFills = dbTrades.filter(t => t.pnl === 0)
  console.log(`\n  Count: ${openFills.length}`)
  const openBySymbol = new Map<string, number>()
  for (const t of openFills) openBySymbol.set(t.symbol, (openBySymbol.get(t.symbol) ?? 0) + 1)
  ;[...openBySymbol.entries()].sort(([, a], [, b]) => b - a).forEach(([sym, count]) => {
    console.log(`    ${sym.replace(':USDT', '').padEnd(22)} ${count} fills`)
  })
  console.log(`\n  ${DIM}These are stored in DB (Bybit adapter uses closed-pnl endpoint, not fills,`)
  console.log(`  so pnl=0 rows should NOT appear for Bybit futures. Investigate if present.)${RESET}`)

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION H: Potential duplicate detection (same symbol+date, different row)
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}══ H. DUPLICATE RISK — same symbol+close_date buckets ════════${RESET}`)

  // Group by symbol + close day
  const dayBuckets = new Map<string, DbTrade[]>()
  for (const t of closingTrades) {
    const day = t.closed_at?.slice(0, 10) ?? 'unknown'
    const key = `${t.symbol}|${day}`
    if (!dayBuckets.has(key)) dayBuckets.set(key, [])
    dayBuckets.get(key)!.push(t)
  }

  // Flag buckets where PnL or prices look suspicious
  console.log(`\n  Buckets with multiple trades on same symbol+day:`)
  let suspiciousGroups = 0
  ;[...dayBuckets.entries()]
    .filter(([, trades]) => trades.length > 1)
    .sort(([, a], [, b]) => b.length - a.length)
    .forEach(([key, trades]) => {
      const totalBucketPnl = trades.reduce((s, t) => s + t.pnl, 0)
      // Check if any two trades in the bucket have identical pnl (potential double-count)
      const pnls = trades.map(t => t.pnl)
      const hasDupPnl = pnls.some((p, i) => pnls.indexOf(p) !== i && Math.abs(p) > 0.01)
      const tag = hasDupPnl ? ` ${YELLOW}⚠ DUPLICATE PnL VALUES${RESET}` : ''
      if (hasDupPnl) suspiciousGroups++
      const color = pnlColor(totalBucketPnl)
      console.log(`    ${key.padEnd(35)} ${trades.length} trades  total=${color}${fmt(totalBucketPnl)}${RESET}${tag}`)
      trades.forEach(t => {
        console.log(`      ${t.direction.padEnd(6)} entry=${fmtPrice(t.entry_price).padStart(12)} exit=${fmtPrice(t.exit_price).padStart(12)} qty=${t.quantity.toFixed(4)} pnl=${pnlColor(t.pnl)}${fmt(t.pnl)}${RESET} | ${t.opened_at?.slice(0,16)} → ${t.closed_at?.slice(0,19)}`)
      })
    })

  if (suspiciousGroups === 0) {
    console.log(`  ${'\x1b[32m'}✅ No suspicious same-symbol same-day PnL duplicates${RESET}`)
  }

  console.log(`\n${BOLD}══ AUDIT COMPLETE ═══════════════════════════════════════════${RESET}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
