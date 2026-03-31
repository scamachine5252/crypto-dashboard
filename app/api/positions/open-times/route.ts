import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BinanceAdapter } from '@/lib/adapters/binance'

type PositionRef = {
  accountId: string
  rawSymbol: string  // e.g. 'BTCUSDT'
  side: 'long' | 'short'
}

type DbAccount = {
  id: string
  api_key: string
  api_secret: string
  instrument: string | null
}

// POST { positions: PositionRef[] }
// Returns { openTimes: Record<"accountId:rawSymbol", timestamp_ms> }
// Only handles Binance — caller should filter to Binance positions before sending.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as { positions?: PositionRef[] }
  const positions = body.positions ?? []

  if (positions.length === 0) {
    return NextResponse.json({ openTimes: {} })
  }

  // Group by accountId
  const byAccount = new Map<string, Array<{ rawSymbol: string; side: 'long' | 'short' }>>()
  for (const p of positions) {
    if (!byAccount.has(p.accountId)) byAccount.set(p.accountId, [])
    byAccount.get(p.accountId)!.push({ rawSymbol: p.rawSymbol, side: p.side })
  }

  const accountIds = Array.from(byAccount.keys())

  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, api_key, api_secret, instrument')
    .in('id', accountIds)

  if (accErr || !accounts) {
    return NextResponse.json({ error: accErr?.message ?? 'No accounts' }, { status: 500 })
  }

  const openTimes: Record<string, number> = {}

  await Promise.allSettled(
    (accounts as DbAccount[]).map(async (acc) => {
      const symbols = byAccount.get(acc.id) ?? []
      if (symbols.length === 0) return

      const adapter = new BinanceAdapter({
        apiKey:          decrypt(acc.api_key),
        apiSecret:       decrypt(acc.api_secret),
        portfolioMargin: acc.instrument === 'portfolio_margin',
      })

      const times = await adapter.findPositionOpenTimes(symbols)

      for (const [rawSymbol, ts] of Object.entries(times)) {
        openTimes[`${acc.id}:${rawSymbol}`] = ts
      }
    }),
  )

  return NextResponse.json({ openTimes })
}
