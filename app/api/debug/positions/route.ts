import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { requireDebugAuth } from '@/lib/debug-auth'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'
import { MexcAdapter }    from '@/lib/adapters/mexc'
import type { RawPosition } from '@/lib/adapters/types'

// GET /api/debug/positions?account_id=xxx
// Returns raw RawPosition[] so we can inspect margin, liquidationPrice, leverage from the adapter.
// Requires x-debug-secret header matching DEBUG_SECRET env var.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const deny = requireDebugAuth(req)
  if (deny) return deny

  const accountId = req.nextUrl.searchParams.get('account_id')
  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: acc, error } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, instrument, api_key, api_secret, passphrase')
    .eq('id', accountId)
    .single()

  if (error || !acc) return NextResponse.json({ error: 'account not found' }, { status: 404 })

  const apiKey    = decrypt(acc.api_key)
  const apiSecret = decrypt(acc.api_secret)

  let rawPositions: RawPosition[]
  switch (acc.exchange) {
    case 'bybit':
      rawPositions = await new BybitAdapter({ apiKey, apiSecret }).fetchPositions()
      break
    case 'binance': {
      const isPortfolioMargin = acc.instrument === 'portfolio_margin'
      rawPositions = await new BinanceAdapter({ apiKey, apiSecret, ...(isPortfolioMargin ? { portfolioMargin: true } : {}) }).fetchPositions()
      break
    }
    case 'okx': {
      const passphrase = acc.passphrase ? decrypt(acc.passphrase) : ''
      rawPositions = await new OkxAdapter({ apiKey, apiSecret, passphrase }).fetchPositions()
      break
    }
    case 'mexc':
      rawPositions = await new MexcAdapter({ apiKey, apiSecret }).fetchPositions()
      break
    default:
      return NextResponse.json({ error: `unsupported exchange: ${acc.exchange}` }, { status: 400 })
  }

  return NextResponse.json({
    account_name: acc.account_name,
    exchange:     acc.exchange,
    instrument:   acc.instrument,
    count:        rawPositions.length,
    positions:    rawPositions,
  })
}
