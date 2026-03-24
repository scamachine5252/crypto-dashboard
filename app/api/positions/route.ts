import 'server-only'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'
import type { Position } from '@/lib/types'
import type { RawPosition } from '@/lib/adapters/types'

type DbAccount = {
  id: string
  account_name: string
  exchange: string
  fund: string
  api_key: string
  api_secret: string
  passphrase: string | null
}

export async function GET(): Promise<NextResponse> {
  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, fund, api_key, api_secret, passphrase')

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ positions: [], accounts: [] })
  }

  const accountMeta = (accounts as DbAccount[]).map((a) => ({
    id: a.id,
    accountName: a.account_name,
    exchange: a.exchange,
    fund: a.fund,
  }))

  // Fetch positions from each account in parallel
  const results = await Promise.allSettled(
    (accounts as DbAccount[]).map(async (acc) => {
      const apiKey    = decrypt(acc.api_key)
      const apiSecret = decrypt(acc.api_secret)

      let rawPositions: RawPosition[]
      switch (acc.exchange) {
        case 'bybit':
          rawPositions = await new BybitAdapter({ apiKey, apiSecret }).fetchPositions()
          break
        case 'binance':
          rawPositions = await new BinanceAdapter({ apiKey, apiSecret }).fetchPositions()
          break
        case 'okx': {
          const passphrase = acc.passphrase ? decrypt(acc.passphrase) : ''
          rawPositions = await new OkxAdapter({ apiKey, apiSecret, passphrase }).fetchPositions()
          break
        }
        default:
          rawPositions = []
      }

      return rawPositions.map((p): Position => ({
        ...p,
        accountId:   acc.id,
        accountName: acc.account_name,
        exchange:    acc.exchange,
      }))
    }),
  )

  const positions: Position[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      positions.push(...result.value)
    }
  }

  // Sort by absolute unrealized PnL descending
  positions.sort((a, b) => Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl))

  return NextResponse.json({ positions, accounts: accountMeta })
}
