import cron from 'node-cron'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter } from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter } from '@/lib/adapters/okx'

type AccountRow = {
  id:          string
  exchange:    string
  api_key:     string
  api_secret:  string
  passphrase?: string
  instrument?: string
}

async function pollBalances(): Promise<void> {
  const { data: accounts, error } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange, api_key, api_secret, passphrase, instrument')

  if (error) {
    console.error('[balance-poller] failed to load accounts:', error.message)
    return
  }

  const today = new Date().toISOString().split('T')[0]

  await Promise.allSettled(
    (accounts ?? []).map(async (acct: AccountRow) => {
      try {
        const apiKey    = decrypt(acct.api_key)
        const apiSecret = decrypt(acct.api_secret)

        let balance: { usdt: number } | null = null

        if (acct.exchange === 'bybit') {
          const adapter = new BybitAdapter({ apiKey, apiSecret })
          balance = await adapter.fetchBalance()
        } else if (acct.exchange === 'binance') {
          const adapter = new BinanceAdapter({
            apiKey, apiSecret,
            portfolioMargin: acct.instrument === 'portfolio_margin',
          })
          balance = await adapter.fetchBalance()
        } else if (acct.exchange === 'okx') {
          const passphrase = acct.passphrase ? decrypt(acct.passphrase) : ''
          const adapter = new OkxAdapter({ apiKey, apiSecret, passphrase })
          balance = await adapter.fetchBalance()
        }

        if (!balance) return

        const { error: upsertError } = await supabaseAdmin
          .from('balances')
          .upsert({
            account_id:   acct.id,
            usdt_balance: balance.usdt,
            snapshot_date: today,
            recorded_at:  new Date().toISOString(),
          }, { onConflict: 'account_id,snapshot_date' })

        if (upsertError) {
          console.warn(`[balance-poller] upsert failed for ${acct.id}:`, upsertError.message)
        }
      } catch (e) {
        console.error(`[balance-poller] error for account ${acct.id}:`, (e as Error).message)
      }
    }),
  )
}

export function startBalancePoller(): void {
  // Poll every 15 minutes
  const task = cron.schedule('*/15 * * * *', () => void pollBalances())
  console.log('[balance-poller] started — polling every 15 min')

  // Initial poll on start
  void pollBalances()

  // Graceful shutdown
  process.once('SIGTERM', () => task.stop())
  process.once('SIGINT',  () => task.stop())
}
