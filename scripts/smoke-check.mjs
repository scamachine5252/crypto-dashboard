#!/usr/bin/env node
/**
 * Post-deploy smoke check.
 * Run on the server after every deployment:
 *   node scripts/smoke-check.mjs
 *
 * Exits 0 if all checks pass, 1 if any fail.
 * Add to deploy workflow or run manually:
 *   ssh root@116.203.244.97 "cd /app/crypto-dashboard && node scripts/smoke-check.mjs"
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── Load env ──────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '../.env.local')
const envLines = readFileSync(envPath, 'utf8').split('\n')
for (const line of envLines) {
  const [k, ...rest] = line.split('=')
  if (k && rest.length) process.env[k.trim()] = rest.join('=').trim()
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
)

// ── Check harness ─────────────────────────────────────────────────────────────
const results = []
let failed = 0

async function check(name, fn) {
  try {
    const msg = await fn()
    console.log(`  ✓ ${name}${msg ? ': ' + msg : ''}`)
    results.push({ name, ok: true })
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    results.push({ name, ok: false, error: err.message })
    failed++
  }
}

// ── Checks ────────────────────────────────────────────────────────────────────

console.log('\n=== Schema ===')

await check('latest_fill_per_account RPC exists (migration 031)', async () => {
  const { error } = await sb.rpc('latest_fill_per_account', { account_ids: [] })
  if (error) throw new Error(error.message)
  return 'callable'
})

await check('last_reconstructed_at column exists (migration 032)', async () => {
  const { error } = await sb.from('accounts').select('last_reconstructed_at').limit(1)
  if (error) throw new Error(error.message)
  return 'column present'
})

await check('snapshot_date column exists on balances (migration 029)', async () => {
  const { error } = await sb.from('balances').select('snapshot_date').limit(1)
  if (error) throw new Error(error.message)
  return 'column present'
})

await check('worker_status table exists (migration 031)', async () => {
  const { data, error } = await sb.from('worker_status').select('id').limit(1)
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('worker_status has no rows — worker never started')
  return 'singleton row present'
})

await check('binance_ban_until column exists on worker_status (migration 031)', async () => {
  const { error } = await sb.from('worker_status').select('binance_ban_until').limit(1)
  if (error) throw new Error(error.message)
  return 'column present'
})

await check('retry_count column exists on full_sync_jobs (migration 031)', async () => {
  const { error } = await sb.from('full_sync_jobs').select('retry_count').limit(1)
  if (error) throw new Error(error.message)
  return 'column present'
})

console.log('\n=== Data writes ===')

await check('balances upsert with onConflict account_id,snapshot_date works', async () => {
  // Use a sentinel account ID that won't match real data; we just need the constraint to resolve
  const testRow = {
    account_id:   '00000000-0000-0000-0000-000000000001',
    usdt_balance: 0,
    recorded_at:  new Date().toISOString(),
  }
  const { error } = await sb.from('balances')
    .upsert(testRow, { onConflict: 'account_id,snapshot_date' })
  if (error) throw new Error(error.message)
  // Clean up sentinel row
  await sb.from('balances').delete().eq('account_id', '00000000-0000-0000-0000-000000000001')
  return 'insert + conflict resolution OK'
})

await check('raw_fills RPC returns data for real accounts', async () => {
  const { data: accts } = await sb.from('accounts').select('id').limit(5)
  const ids = (accts ?? []).map(a => a.id)
  if (ids.length === 0) throw new Error('no accounts found')
  const { data, error } = await sb.rpc('latest_fill_per_account', { account_ids: ids })
  if (error) throw new Error(error.message)
  return `${data?.length ?? 0} accounts with fills out of ${ids.length}`
})

console.log('\n=== Data freshness ===')

await check('raw_fills table has data', async () => {
  const { count, error } = await sb.from('raw_fills').select('*', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  if (!count || count === 0) throw new Error('raw_fills is empty — full history sync needed')
  return `${count.toLocaleString()} rows`
})

await check('trades table has data', async () => {
  const { count, error } = await sb.from('trades').select('*', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  if (!count || count === 0) throw new Error('trades is empty — reconstruction needed')
  return `${count.toLocaleString()} rows`
})

await check('balances written in last 24h', async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await sb.from('balances')
    .select('*', { count: 'exact', head: true })
    .gte('recorded_at', cutoff)
  if (error) throw new Error(error.message)
  if (!count || count === 0) throw new Error('no balance snapshots in last 24h — balance-poller broken')
  return `${count} snapshots`
})

await check('worker heartbeat is fresh (< 10 min)', async () => {
  const { data, error } = await sb.from('worker_status').select('last_heartbeat').eq('id', 1).single()
  if (error) throw new Error(error.message)
  const ageMin = (Date.now() - new Date(data.last_heartbeat).getTime()) / 60_000
  if (ageMin > 10) throw new Error(`last heartbeat ${ageMin.toFixed(1)} min ago — worker may be down`)
  return `${ageMin.toFixed(1)} min ago`
})

await check('no active Binance IP ban', async () => {
  const { data, error } = await sb.from('worker_status').select('binance_ban_until').eq('id', 1).single()
  if (error) throw new Error(error.message)
  if (data.binance_ban_until && new Date(data.binance_ban_until) > new Date()) {
    throw new Error(`Binance banned until ${data.binance_ban_until}`)
  }
  return 'not banned'
})

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50))
if (failed === 0) {
  console.log(`✓ All ${results.length} checks passed\n`)
  process.exit(0)
} else {
  console.error(`✗ ${failed} of ${results.length} checks FAILED\n`)
  process.exit(1)
}
