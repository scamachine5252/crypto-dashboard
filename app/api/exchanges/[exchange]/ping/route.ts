import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'

const VALID_EXCHANGES = ['binance', 'bybit', 'okx'] as const
type ValidExchange = typeof VALID_EXCHANGES[number]

// ---------------------------------------------------------------------------
// POST /api/exchanges/[exchange]/ping
// Body: { account_id: string }
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ exchange: string }> },
): Promise<NextResponse> {
  const { exchange } = await params

  // Validate exchange
  if (!(VALID_EXCHANGES as readonly string[]).includes(exchange)) {
    return NextResponse.json(
      { error: `Invalid exchange. Must be one of: ${VALID_EXCHANGES.join(', ')}` },
      { status: 400 },
    )
  }

  // Parse body
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { account_id } = body as { account_id?: string }
  if (!account_id) {
    return NextResponse.json({ error: 'Missing required field: account_id' }, { status: 400 })
  }

  // Fetch account from Supabase
  const { data: account, error: dbError } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, api_key, api_secret, passphrase')
    .eq('id', account_id)
    .single()

  if (dbError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const row = account as {
    id: string
    account_name: string
    exchange: string
    api_key: string
    api_secret: string
    passphrase: string | null
  }

  // Decrypt credentials — never leave this scope
  const apiKey    = decrypt(row.api_key)
  const apiSecret = decrypt(row.api_secret)

  // Instantiate correct adapter and test connection
  let connected: boolean
  try {
    switch (exchange as ValidExchange) {
      case 'bybit': {
        const adapter = new BybitAdapter({ apiKey, apiSecret })
        connected = await adapter.testConnection()
        break
      }
      case 'binance': {
        const adapter = new BinanceAdapter({ apiKey, apiSecret })
        connected = await adapter.testConnection()
        break
      }
      case 'okx': {
        const passphrase = row.passphrase ? decrypt(row.passphrase) : ''
        const adapter = new OkxAdapter({ apiKey, apiSecret, passphrase })
        connected = await adapter.testConnection()
        break
      }
    }
  } catch (error) {
    console.error('testConnection error:', error)
    console.error('testConnection error message:', (error as Error)?.message)
    console.error('testConnection error stack:', (error as Error)?.stack)
    connected = false
  }

  console.log('testConnection result:', connected!)

  // Return result — never expose decrypted credentials
  return NextResponse.json(
    { connected: connected!, exchange, account_name: row.account_name },
    { status: 200 },
  )
}
