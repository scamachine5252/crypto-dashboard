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

// In-memory cache of last successfully saved equity per account.
// Used to detect anomalous drops (PM adapter returning sub-wallet instead of portfolio equity).
// Cache warms up after the first successful save per cycle; first-run after restart has no guard.
const lastSavedEquity = new Map<string, number>()

// Guard threshold: equity must not drop to <20% of last known value unless it's 0 (real closure).
const EQUITY_DROP_THRESHOLD = 0.20

async function saveBalance(acctId: string, usdt: number, totalEquityUsdt?: number): Promise<void> {
  const equity = totalEquityUsdt ?? usdt
  const lastEquity = lastSavedEquity.get(acctId)

  // Only guard when we have a reference point and the new value is non-zero.
  // Zero is allowed through — it signals a real account closure/withdrawal.
  if (lastEquity !== undefined && lastEquity > 1000 && equity > 0 && equity < lastEquity * EQUITY_DROP_THRESHOLD) {
    console.warn(
      `[balance-poller] anomalous equity drop for ${acctId}: ${Math.round(lastEquity)} → ${Math.round(equity)} ` +
      `(${Math.round(equity / lastEquity * 100)}% of previous) — skipping write`
    )
    return
  }

  const { error } = await supabaseAdmin.rpc('upsert_main_balance', {
    p_account_id:        acctId,
    p_usdt_balance:      usdt,
    p_total_equity_usdt: totalEquityUsdt ?? null,
    p_recorded_at:       new Date().toISOString(),
  })
  if (error) {
    console.warn(`[balance-poller] save failed for ${acctId}:`, error.message)
    return
  }
  lastSavedEquity.set(acctId, equity)
}

async function pollNonBinance(): Promise<void> {
  const { data: accounts, error } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange, api_key, api_secret, passphrase, instrument')
    .not('exchange', 'eq', 'binance')
    .eq('is_suspended', false)

  if (error) { console.error('[balance-poller] failed to load accounts:', error.message); return }

  await Promise.allSettled(
    (accounts ?? []).map(async (acct: AccountRow) => {
      try {
        const apiKey    = decrypt(acct.api_key)
        const apiSecret = decrypt(acct.api_secret)
        let balance: { usdt: number; totalEquityUsdt?: number } | null = null

        if (acct.exchange === 'bybit') {
          balance = await new BybitAdapter({ apiKey, apiSecret }).fetchBalance()
        } else if (acct.exchange === 'okx') {
          const passphrase = acct.passphrase ? decrypt(acct.passphrase) : ''
          balance = await new OkxAdapter({ apiKey, apiSecret, passphrase }).fetchBalance()
        }

        if (balance) await saveBalance(acct.id, balance.usdt, balance.totalEquityUsdt)
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
    .eq('is_suspended', false)

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
      if (balance) await saveBalance(acct.id, balance.usdt, balance.totalEquityUsdt)
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
  // 3-minute startup delay: avoids overlapping with reconciler's Binance startup (5-min delay)
  setTimeout(() => void pollBinance(), 3 * 60 * 1000)

  process.once('SIGTERM', () => { /* cron tasks stop with process */ })
  process.once('SIGINT',  () => { /* cron tasks stop with process */ })
}
