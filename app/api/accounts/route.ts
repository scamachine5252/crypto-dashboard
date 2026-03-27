import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto/encrypt'
import { decrypt } from '@/lib/crypto/decrypt'
import { detectBinanceInstrument } from '@/lib/adapters/binance-detect'

const VALID_EXCHANGES = ['binance', 'bybit', 'okx'] as const

// ---------------------------------------------------------------------------
// POST /api/accounts — create a new exchange account
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { fund, exchange, account_name, api_key, api_secret, passphrase, account_id_memo } = body as Record<string, string | undefined>

  // Required field validation
  if (!fund || !exchange || !account_name || !api_key || !api_secret) {
    return NextResponse.json(
      { error: 'Missing required fields: fund, exchange, account_name, api_key, api_secret' },
      { status: 400 },
    )
  }

  // Exchange validation
  if (!(VALID_EXCHANGES as readonly string[]).includes(exchange)) {
    return NextResponse.json(
      { error: `Invalid exchange. Must be one of: ${VALID_EXCHANGES.join(', ')}` },
      { status: 400 },
    )
  }

  // Encrypt sensitive fields before storage
  const encryptedApiKey = encrypt(api_key)
  const encryptedApiSecret = encrypt(api_secret)
  const encryptedPassphrase = passphrase ? encrypt(passphrase) : null

  const insertPayload: Record<string, unknown> = {
    fund,
    exchange,
    account_name,
    instrument: 'unified', // safe default; will be updated after detection below
    api_key: encryptedApiKey,
    api_secret: encryptedApiSecret,
  }
  if (encryptedPassphrase !== null) {
    insertPayload.passphrase = encryptedPassphrase
  }
  if (account_id_memo) {
    insertPayload.account_id_memo = account_id_memo
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .insert(insertPayload)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const row = data as Record<string, unknown>

  // Auto-detect instrument for Binance accounts; Bybit/OKX always 'unified'
  if (exchange === 'binance') {
    try {
      const detected = await detectBinanceInstrument(
        decrypt(row.api_key as string),
        decrypt(row.api_secret as string),
      )
      if (detected !== 'unified') {
        await supabaseAdmin
          .from('accounts')
          .update({ instrument: detected })
          .eq('id', row.id as string)
        row.instrument = detected
      }
    } catch {
      // Detection failure is non-fatal — account is saved with 'unified' default
    }
  }

  // Strip encrypted fields from response
  const { api_key: _k, api_secret: _s, passphrase: _p, ...safe } = row

  return NextResponse.json(safe, { status: 201 })
}

// ---------------------------------------------------------------------------
// GET /api/accounts — list all accounts (no sensitive fields)
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin.from('accounts').select('*')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const accounts = (data as Record<string, unknown>[]).map(({ api_key: _k, api_secret: _s, passphrase: _p, ...safe }) => safe)

  return NextResponse.json(accounts, { status: 200 })
}
