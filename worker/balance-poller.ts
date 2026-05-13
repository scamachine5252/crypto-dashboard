import cron from 'node-cron'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter } from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter } from '@/lib/adapters/okx'
import { binanceBanGuard } from './binance-ban-guard'

type AccountRow = {
  id:          string
  exchange:    string
  api_key:     string
  api_secret:  string
  passphrase?: string
  instrument?: string
}

async function saveBalance(acctId: string, usdt: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  await supabaseAdmin.from('balances').delete()
    .eq('account_id', acctId).is('token_symbol', null).eq('snapshot_date', today)
  const { error } = await supabaseAdmin.from('balances').insert({
    account_id:   acctId,
    usdt_balance: usdt,
    recorded_at:  new Date().toISOString(),
  })
  if (error) console.warn(`[balance-poller] insert failed for ${acctId}:`, error.message)
}

async function pollNonBinance(): Promise<void> {
  const { data: accounts, error } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange, api_key, api_secret, passphrase, instrument')
    .not('exchange', 'eq', 'binance')

  if (error) { console.error('[balance-poller] failed to load accounts:', error.message); return }

  await Promise.allSettled(
    (accounts ?? []).map(async (acct: AccountRow) => {
      try {
        const apiKey    = decrypt(acct.api_key)
        const apiSecret = decrypt(acct.api_secret)
        let balance: { usdt: number } | null = null

        if (acct.exchange === 'bybit') {
          balance = await new BybitAdapter({ apiKey, apiSecret }).fetchBalance()
        } else if (acct.exchange === 'okx') {
          const passphrase = acct.passphrase ? decrypt(acct.passphrase) : ''
          balance = await new OkxAdapter({ apiKey, apiSecret, passphrase }).fetchBalance()
        }

        if (balance) await saveBalance(acct.id, balance.usdt)
      } catch (e) {
        console.error(`[balance-poller] error for account ${acct.id}:`, (e as Error).message)
      }
    }),
  )
}

async function pollBinance(): Promise<void> {
  if (binanceBanGuard.isBanned()) {
    console.warn('[balance-poller] Binance IP banned — skipping balance poll')
    return
  }

  const { data: accounts, error } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange, api_key, api_secret, passphrase, instrument')
    .eq('exchange', 'binance')

  if (error) { console.error('[balance-poller] failed to load Binance accounts:', error.message); return }

  // Sequential — Binance rate limits are strict
  for (const acct of (accounts ?? []) as AccountRow[]) {
    try {
      const adapter = new BinanceAdapter({
        apiKey:          decrypt(acct.api_key),
        apiSecret:       decrypt(acct.api_secret),
        portfolioMargin: acct.instrument === 'portfolio_margin',
      })
      const balance = await adapter.fetchBalance()
      if (balance) await saveBalance(acct.id, balance.usdt)
    } catch (e) {
      await binanceBanGuard.recordIfBanned(e)
      console.error(`[balance-poller] error for account ${acct.id}:`, (e as Error).message)
    }
  }
}

export function startBalancePoller(): void {
  // Non-Binance: every 15 min, parallel
  cron.schedule('*/15 * * * *', () => void pollNonBinance())

  // Binance: every 60 min, sequential, ban-aware
  cron.schedule('0 * * * *', () => void pollBinance())

  console.log('[balance-poller] started — polling every 15 min (non-Binance) / 60 min (Binance)')

  void pollNonBinance()
  void pollBinance()

  process.once('SIGTERM', () => { /* cron tasks stop with process */ })
  process.once('SIGINT',  () => { /* cron tasks stop with process */ })
}
