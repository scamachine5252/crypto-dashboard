#!/usr/bin/env node
/**
 * Rebuild all trades from raw_fills.
 *
 * Steps:
 *   1. Fetch all accounts
 *   2. DELETE all rows from `trades`
 *   3. For each account: POST /api/sync/reconstruct — rebuild trades from raw_fills
 *   4. Report success / failure per account
 *
 * Usage:
 *   node scripts/rebuild-trades.mjs
 *   node scripts/rebuild-trades.mjs --dry-run   # show what would happen, no writes
 *
 * Run on Hetzner (uses production Next.js at localhost:3000):
 *   ssh root@116.203.244.97 "cd /app/crypto-dashboard && node scripts/rebuild-trades.mjs"
 *
 * Run locally (uses NEXT_PUBLIC_SUPABASE_URL from .env.local):
 *   node scripts/rebuild-trades.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const DRY_RUN = process.argv.includes('--dry-run')
const SKIP_DELETE = process.argv.includes('--skip-delete')
const RECONSTRUCT_BASE = process.env.RECONSTRUCT_BASE ?? 'http://localhost:3000'
const RETRY_LIMIT = 3
const RETRY_DELAY_MS = 5_000

// ── Load env ──────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '../.env.local')
const envLines = readFileSync(envPath, 'utf8').split('\n')
for (const line of envLines) {
  const [key, ...rest] = line.split('=')
  if (key && rest.length && !process.env[key]) {
    process.env[key] = rest.join('=').trim()
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
)

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`) }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function reconstructAccount(accountId, exchange, attempt = 1) {
  const url = `${RECONSTRUCT_BASE}/api/sync/reconstruct`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function reconstructWithRetry(accountId, exchange) {
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      await reconstructAccount(accountId, exchange)
      return { ok: true }
    } catch (err) {
      if (attempt < RETRY_LIMIT) {
        log(`  ⚠️  attempt ${attempt} failed: ${err.message} — retrying in ${RETRY_DELAY_MS / 1000}s`)
        await sleep(RETRY_DELAY_MS)
      } else {
        return { ok: false, error: err.message }
      }
    }
  }
}

async function main() {
  log('=== rebuild-trades.mjs ===')
  if (DRY_RUN) log('DRY RUN — no writes will happen')

  // ── 1. Fetch accounts ───────────────────────────────────────────────────────
  const { data: accounts, error: accErr } = await sb
    .from('accounts')
    .select('id, account_name, exchange')
    .order('exchange')

  if (accErr) { log('❌ Failed to fetch accounts: ' + accErr.message); process.exit(1) }
  log(`Found ${accounts.length} accounts: ${accounts.map(a => a.exchange + '/' + a.account_name).join(', ')}`)

  // ── 2. Count current trades ─────────────────────────────────────────────────
  const { count: tradesBefore } = await sb
    .from('trades')
    .select('*', { count: 'exact', head: true })
  log(`Current trades in DB: ${tradesBefore}`)

  // ── 3. DELETE all trades + reset last_reconstructed_at ─────────────────────
  if (!DRY_RUN && !SKIP_DELETE) {
    log('Deleting all trades...')
    const { error: delErr } = await sb.from('trades').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (delErr) { log('❌ DELETE failed: ' + delErr.message); process.exit(1) }
    const { count: tradesAfter } = await sb.from('trades').select('*', { count: 'exact', head: true })
    log(`Trades after delete: ${tradesAfter}`)

    // Reset skip guard so reconstruction runs for all accounts
    log('Resetting last_reconstructed_at for all accounts...')
    const { error: resetErr } = await sb.from('accounts').update({ last_reconstructed_at: null }).neq('id', '00000000-0000-0000-0000-000000000000')
    if (resetErr) { log('⚠️  Could not reset last_reconstructed_at: ' + resetErr.message) }
    else log('Reset done.')
  } else if (SKIP_DELETE) {
    log(`--skip-delete: skipping DELETE (trades already empty)`)
  } else {
    log(`[dry-run] Would delete ${tradesBefore} trades`)
  }

  // ── 4. Reconstruct per account ──────────────────────────────────────────────
  const results = []
  for (const acct of accounts) {
    const label = `${acct.exchange}/${acct.account_name} (${acct.id.slice(0, 8)})`
    log(`Reconstructing ${label}...`)

    if (DRY_RUN) {
      log(`  [dry-run] Would POST /api/sync/reconstruct { accountId: ${acct.id} }`)
      results.push({ label, ok: true, dry: true })
      continue
    }

    const result = await reconstructWithRetry(acct.id, acct.exchange)
    if (result.ok) {
      log(`  ✅ done`)
    } else {
      log(`  ❌ FAILED: ${result.error}`)
    }
    results.push({ label, ...result })
  }

  // ── 5. Summary ──────────────────────────────────────────────────────────────
  log('')
  log('=== SUMMARY ===')
  const ok  = results.filter(r => r.ok)
  const bad = results.filter(r => !r.ok)
  log(`✅ Success: ${ok.length}/${results.length}`)
  if (bad.length) {
    log(`❌ Failed:`)
    bad.forEach(r => log(`   ${r.label}: ${r.error}`))
  }

  if (!DRY_RUN) {
    const { count: finalCount } = await sb.from('trades').select('*', { count: 'exact', head: true })
    log(`Final trades in DB: ${finalCount} (was ${tradesBefore})`)
  }

  process.exit(bad.length > 0 ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
