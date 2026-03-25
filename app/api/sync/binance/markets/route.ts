import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import * as ccxt from 'ccxt'
import { supabaseAdmin } from '@/lib/supabase/server'

const CHUNK_SIZE = 50

export async function GET(req: NextRequest): Promise<NextResponse> {
  const accountId = req.nextUrl.searchParams.get('account_id')
  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('instrument')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const instrument = (account as Record<string, string>).instrument
  const isFuturesOnly     = instrument === 'futures'
  const isPortfolioMargin = instrument === 'portfolio_margin'

  try {
    const loadSymbols = async (futures: boolean): Promise<string[]> => {
      const opts = futures
        ? { options: { defaultType: 'future', ...(isPortfolioMargin ? { portfolioMargin: true } : {}) } }
        : {}
      const ex = new ccxt.binance(opts)
      const markets = await ex.loadMarkets()
      return Object.values(markets)
        .filter((m): m is NonNullable<typeof m> => {
          if (m == null) return false
          return futures ? (m.quote === 'USDT' && m.linear === true) : m.quote === 'USDT'
        })
        .map((m) => m.symbol)
        .sort()
    }

    let spotSymbols: string[] = []
    let futuresSymbols: string[] = []

    if (isFuturesOnly || isPortfolioMargin) {
      futuresSymbols = await loadSymbols(true)
    } else {
      ;[spotSymbols, futuresSymbols] = await Promise.all([loadSymbols(false), loadSymbols(true)])
    }

    const spotChunks    = Math.ceil(spotSymbols.length    / CHUNK_SIZE)
    const futuresChunks = Math.ceil(futuresSymbols.length / CHUNK_SIZE)
    const totalChunks   = spotChunks + futuresChunks
    const totalSymbols  = spotSymbols.length + futuresSymbols.length

    // Return full symbol arrays so the caller can pass exact slices to chunk POSTs
    // (avoids redundant loadMarkets() calls in the full route)
    return NextResponse.json({
      totalChunks,
      chunkSize: CHUNK_SIZE,
      totalSymbols,
      spotChunks,
      spotSymbols,
      futuresSymbols,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
