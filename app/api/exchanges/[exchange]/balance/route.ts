import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'
import type { BalanceResult } from '@/lib/adapters/types'

const VALID_EXCHANGES = ['binance', 'bybit', 'okx'] as const
type ValidExchange = typeof VALID_EXCHANGES[number]

// ---------------------------------------------------------------------------
// POST /api/exchanges/[exchange]/balance
// Body: { account_id: string }
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

  const { account_id } = body as { account_id?: string }
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

  let result: BalanceResult
  try {
    switch (exchange as ValidExchange) {
      case 'bybit': {
        result = await new BybitAdapter({ apiKey, apiSecret }).fetchBalance()
        break
      }
      case 'binance': {
        result = await new BinanceAdapter({ apiKey, apiSecret }).fetchBalance()
        break
      }
      case 'okx': {
        const passphrase = row.passphrase ? decrypt(row.passphrase) : ''
        result = await new OkxAdapter({ apiKey, apiSecret, passphrase }).fetchBalance()
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
    { ...result!, account_name: row.account_name, exchange },
    { status: 200 },
  )
}
