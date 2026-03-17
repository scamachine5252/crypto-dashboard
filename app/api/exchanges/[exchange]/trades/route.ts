import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'

const VALID_EXCHANGES = ['binance', 'bybit', 'okx'] as const
type ValidExchange = typeof VALID_EXCHANGES[number]

// ---------------------------------------------------------------------------
// POST /api/exchanges/[exchange]/trades
// Body: { account_id: string, since?: number, limit?: number }
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ exchange: string }> },
): Promise<NextResponse> {
  const { exchange } = await params

  if (!(VALID_EXCHANGES as readonly string[]).includes(exchange)) {
    return NextResponse.json(
      { error: `Invalid exchange. Must be one of: ${VALID_EXCHANGES.join(', ')}` },
      { status: 400 },
    )
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { account_id, since, limit } = body as { account_id?: string; since?: number; limit?: number }
  if (!account_id) {
    return NextResponse.json({ error: 'Missing required field: account_id' }, { status: 400 })
  }

  const { data: account, error: dbError } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, api_key, api_secret, passphrase')
    .eq('id', account_id)
    .single()

  if (dbError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const row = account as {
    id: string; account_name: string; exchange: string
    api_key: string; api_secret: string; passphrase: string | null
  }

  const apiKey    = decrypt(row.api_key)
  const apiSecret = decrypt(row.api_secret)

  // Placeholder dateRange — real date filtering is handled by since/limit
  const dateRange = { start: '2000-01-01', end: '2099-12-31' }

  let trades: unknown[]
  try {
    switch (exchange as ValidExchange) {
      case 'bybit':
        trades = await new BybitAdapter({ apiKey, apiSecret }).getTrades('all', dateRange, since, limit)
        break
      case 'binance':
        trades = await new BinanceAdapter({ apiKey, apiSecret }).getTrades('all', dateRange, since, limit)
        break
      case 'okx': {
        const passphrase = row.passphrase ? decrypt(row.passphrase) : ''
        trades = await new OkxAdapter({ apiKey, apiSecret, passphrase }).getTrades('all', dateRange, since, limit)
        break
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Adapter error' },
      { status: 500 },
    )
  }

  return NextResponse.json(
    { trades: trades!, account_name: row.account_name, exchange },
    { status: 200 },
  )
}
