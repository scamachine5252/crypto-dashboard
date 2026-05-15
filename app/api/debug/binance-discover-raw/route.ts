import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { requireDebugAuth } from '@/lib/debug-auth'
import * as ccxt from 'ccxt'

/**
 * GET /api/debug/binance-discover-raw?account_id=<uuid>
 *
 * Calls the raw PAPI income endpoint (same pagination as discoverTradedSymbols)
 * and returns exactly what Binance returns — unique symbols, total event count,
 * pagination pages fetched, and whether the endpoint errored.
 *
 * Use this to diagnose why discoverTradedSymbols() misses symbols for PM accounts.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const deny = requireDebugAuth(req)
  if (deny) return deny

  const accountId = req.nextUrl.searchParams.get('account_id')
  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, instrument, api_key, api_secret')
    .eq('id', accountId)
    .single()

  if (error || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const acc = account as Record<string, string>
  if (acc.exchange !== 'binance') return NextResponse.json({ error: 'Binance only' }, { status: 400 })
  if (acc.instrument !== 'portfolio_margin') {
    return NextResponse.json({ error: 'PM account only — use a portfolio_margin account' }, { status: 400 })
  }

  const ex = new ccxt.binance({
    apiKey: decrypt(acc.api_key),
    secret: decrypt(acc.api_secret),
    options: { defaultType: 'future', portfolioMargin: true },
  }) as unknown as {
    papiGetUmIncome: (p: Record<string, unknown>) => Promise<Array<{ symbol: string; incomeType: string; income: string; time: number }>>
    papiGetCmIncome: (p: Record<string, unknown>) => Promise<Array<{ symbol: string; incomeType: string; income: string; time: number }>>
  }

  const DAY       = 24 * 60 * 60 * 1000
  const scanStart = Date.now() - 180 * DAY
  const endTime   = Date.now()

  async function fetchPaginated(
    label: string,
    fetchFn: (p: Record<string, unknown>) => Promise<Array<{ symbol: string; incomeType: string; income: string; time: number }>>,
  ) {
    const allRows: Array<{ symbol: string; incomeType: string; income: string; time: number }> = []
    let cursor = scanStart
    let pages  = 0
    let error: string | null = null

    try {
      while (cursor <= endTime) {
        const page = await fetchFn({
          incomeType: 'REALIZED_PNL',
          startTime:  cursor,
          endTime,
          limit:      1000,
        })
        pages++
        allRows.push(...page)
        if (page.length < 1000) break
        cursor = Number(page[page.length - 1].time) + 1
        if (pages > 50) { error = 'pagination safety limit hit (50 pages)'; break }
      }
    } catch (e) {
      error = String(e).slice(0, 400)
    }

    // Unique symbols found
    const symbolMap: Record<string, { count: number; totalIncome: number; earliest: string; latest: string }> = {}
    for (const row of allRows) {
      if (!row.symbol) continue
      if (!symbolMap[row.symbol]) {
        symbolMap[row.symbol] = { count: 0, totalIncome: 0, earliest: '', latest: '' }
      }
      symbolMap[row.symbol].count++
      symbolMap[row.symbol].totalIncome += Number(row.income) || 0
      const ts = Number(row.time)
      const dt = Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString().slice(0, 10) : 'unknown'
      if (!symbolMap[row.symbol].earliest || dt < symbolMap[row.symbol].earliest) symbolMap[row.symbol].earliest = dt
      if (!symbolMap[row.symbol].latest   || dt > symbolMap[row.symbol].latest)   symbolMap[row.symbol].latest   = dt
    }

    return {
      label,
      pages_fetched: pages,
      total_events:  allRows.length,
      unique_symbols: Object.keys(symbolMap).length,
      error,
      symbols: Object.entries(symbolMap)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([sym, s]) => ({
          symbol:       sym,
          events:       s.count,
          total_income: Number(s.totalIncome.toFixed(4)),
          earliest:     s.earliest,
          latest:       s.latest,
        })),
    }
  }

  const [um, cm] = await Promise.all([
    fetchPaginated('UM (USDT-M)', (p) => ex.papiGetUmIncome(p)),
    fetchPaginated('CM (Coin-M)', (p) => ex.papiGetCmIncome(p)),
  ])

  const allSymbols = new Set([
    ...um.symbols.map(s => s.symbol),
    ...cm.symbols.map(s => s.symbol),
  ])

  return NextResponse.json({
    account:          acc.account_name,
    instrument:       acc.instrument,
    scan_window_days: 180,
    summary: {
      um_symbols:    um.unique_symbols,
      cm_symbols:    cm.unique_symbols,
      total_symbols: allSymbols.size,
      um_events:     um.total_events,
      cm_events:     cm.total_events,
      um_pages:      um.pages_fetched,
      cm_pages:      cm.pages_fetched,
    },
    um,
    cm,
  })
}
