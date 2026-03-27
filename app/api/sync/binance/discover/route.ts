import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BinanceAdapter } from '@/lib/adapters/binance'

// ---------------------------------------------------------------------------
// POST — discover all Binance futures symbols traded in the last 180 days.
// Returns { symbols: string[] } — raw Binance symbol strings (e.g. 'BTCUSDT').
// The frontend calls this once before starting the per-symbol Full History loop.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body      = await req.json() as Record<string, unknown>
  const accountId = body.account_id as string | undefined

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id, api_key, api_secret, instrument')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const instrument        = (account as Record<string, string>).instrument
  const isPortfolioMargin = instrument === 'portfolio_margin'

  const adapter = new BinanceAdapter({
    apiKey:          decrypt((account as Record<string, string>).api_key),
    apiSecret:       decrypt((account as Record<string, string>).api_secret),
    portfolioMargin: isPortfolioMargin,
  })

  const symbols = await adapter.discoverTradedSymbols()

  // symbols is DiscoveredSymbol[] — each entry has rawSymbol + weekIndices
  return NextResponse.json({ symbols })
}
