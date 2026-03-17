import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'
import type { ExchangeAdapter } from '@/lib/adapters/types'
import type { DateRange } from '@/lib/types'

// ---------------------------------------------------------------------------
// Shared sync logic
// ---------------------------------------------------------------------------
async function runSync(): Promise<NextResponse> {
  // Fetch all configured accounts
  const { data: accounts, error: accountsError } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, api_key, api_secret, passphrase')

  if (accountsError) {
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 })
  }

  const rows = (accounts ?? []) as Array<{
    id: string
    account_name: string
    exchange: string
    api_key: string
    api_secret: string
    passphrase: string | null
  }>

  let synced = 0
  let errors = 0
  const syncedAccounts: string[] = []
  const dateRange: DateRange = { start: '2000-01-01', end: '2099-12-31' }

  for (const row of rows) {
    try {
      const apiKey    = decrypt(row.api_key)
      const apiSecret = decrypt(row.api_secret)

      let adapter: ExchangeAdapter
      switch (row.exchange) {
        case 'bybit':
          adapter = new BybitAdapter({ apiKey, apiSecret })
          break
        case 'binance':
          adapter = new BinanceAdapter({ apiKey, apiSecret })
          break
        case 'okx': {
          const passphrase = row.passphrase ? decrypt(row.passphrase) : ''
          adapter = new OkxAdapter({ apiKey, apiSecret, passphrase })
          break
        }
        default:
          throw new Error(`Unknown exchange: ${row.exchange}`)
      }

      // Fetch and persist balance
      const balance = await adapter.fetchBalance()
      const recordedAt = new Date().toISOString()

      // One row for USDT
      await supabaseAdmin.from('balances').insert({
        account_id:   row.id,
        usdt_balance: balance.usdt,
        recorded_at:  recordedAt,
      })

      // One row per non-USDT token
      for (const [symbol, amount] of Object.entries(balance.tokens)) {
        await supabaseAdmin.from('balances').insert({
          account_id:    row.id,
          usdt_balance:  0,
          token_symbol:  symbol,
          token_balance: amount,
          recorded_at:   recordedAt,
        })
      }

      // Fetch and upsert trades
      const trades = await adapter.getTrades('all', dateRange)
      console.log('trades count for', row.account_name, ':', trades.length)
      console.log('first trade sample:', JSON.stringify(trades[0]))
      if (trades.length > 0) {
        await supabaseAdmin.from('trades').upsert(
          trades.map((t) => ({
            account_id:  row.id,
            exchange:    row.exchange,
            symbol:      t.symbol,
            side:        t.side === 'long' ? 'buy' : 'sell',
            direction:   t.side === 'long' || t.side === 'short' ? t.side : 'unknown',
            entry_price: t.entryPrice,
            exit_price:  t.exitPrice,
            quantity:    t.quantity,
            pnl:         t.pnl,
            fee:         t.fee,
            opened_at:   t.openedAt,
            closed_at:   t.closedAt,
            trade_type:  t.tradeType,
          })),
          { onConflict: 'account_id,symbol,opened_at' },
        )
      }

      synced++
      syncedAccounts.push(row.account_name)
    } catch (error) {
      console.error(`Sync error for account ${row.account_name}:`, error)
      errors++
    }
  }

  return NextResponse.json(
    { synced, errors, accounts: syncedAccounts },
    { status: 200 },
  )
}

// POST /api/sync — manual trigger
export async function POST(_req: NextRequest): Promise<NextResponse> {
  return runSync()
}

// GET /api/sync — Vercel Cron Job trigger (runs on schedule)
export async function GET(_req: NextRequest): Promise<NextResponse> {
  return runSync()
}
