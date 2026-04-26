/**
 * diagnose-transactions.mjs
 * Run: node scripts/diagnose-transactions.mjs
 *
 * Calls the local dev server to:
 * 1. List all accounts + IDs
 * 2. Run the debug/transactions endpoint for each Bybit + Binance account
 * 3. Check balances table coverage (via a dedicated check)
 * 4. Run transactions-backfill chunk 12 (most recent 7 days) with dry-run logging
 */

const BASE = 'http://localhost:3000'

async function get(path) {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`)
  return r.json()
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}

// ─── 1. Fetch all accounts ────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════')
console.log('1. ACCOUNTS')
console.log('══════════════════════════════════════')
const accounts = await get('/api/accounts')
for (const a of accounts) {
  console.log(`  ${a.account_name.padEnd(20)} ${a.exchange.padEnd(8)} ${a.instrument ?? '—'} id=${a.id}`)
}

// ─── 2. Balance coverage ──────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════')
console.log('2. BALANCE COVERAGE (via debug endpoint)')
console.log('══════════════════════════════════════')
const balanceCheck = await get('/api/debug/balance-coverage').catch(() => null)
if (balanceCheck) {
  console.log(JSON.stringify(balanceCheck, null, 2))
} else {
  console.log('  (no balance-coverage endpoint — check manually in Supabase:')
  console.log('  SELECT account_id, MIN(recorded_at), MAX(recorded_at), COUNT(*) FROM balances WHERE token_symbol IS NULL GROUP BY account_id;)')
}

// ─── 3. Transactions debug per account ───────────────────────────────────────
console.log('\n══════════════════════════════════════')
console.log('3. TRANSACTIONS DEBUG (most recent 30 days)')
console.log('══════════════════════════════════════')

const supported = accounts.filter(a => a.exchange === 'bybit' || a.exchange === 'binance')

for (const a of supported) {
  console.log(`\n─── ${a.account_name} (${a.exchange}) ───`)
  try {
    const r = await post('/api/debug/transactions', {
      account_id: a.id,
      days_ago: 30,
      snapshot_type: 'FUTURES',
    })

    if (a.exchange === 'bybit') {
      const dep = r.deposits_raw
      const wd  = r.withdrawals_raw
      const tx  = r.transaction_log_raw
      console.log(`  Deposits API:     ok=${dep?.ok} count=${dep?.count} error=${dep?.error ?? '—'}`)
      if (dep?.sample?.length) console.log('    sample:', JSON.stringify(dep.sample[0]))
      console.log(`  Withdrawals API:  ok=${wd?.ok} count=${wd?.count} error=${wd?.error ?? '—'}`)
      if (wd?.sample?.length) console.log('    sample:', JSON.stringify(wd.sample[0]))
      console.log(`  Transaction log:  ok=${tx?.ok} rows=${tx?.total_rows} types=${JSON.stringify(tx?.type_counts)}`)
    } else {
      const dep = r.deposits_ccxt
      const wd  = r.withdrawals_ccxt
      console.log(`  Deposits CCXT:    ok=${dep?.ok} count=${dep?.count} error=${dep?.error ?? '—'}`)
      if (dep?.sample?.length) console.log('    sample:', JSON.stringify(dep.sample[0]))
      console.log(`  Withdrawals CCXT: ok=${wd?.ok} count=${wd?.count} error=${wd?.error ?? '—'}`)
      if (wd?.sample?.length) console.log('    sample:', JSON.stringify(wd.sample[0]))
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`)
  }
}

// ─── 4. Check what transactions-backfill ACTUALLY found ──────────────────────
console.log('\n══════════════════════════════════════')
console.log('4. TRANSACTIONS-BACKFILL CHUNK 12 (most recent 7 days, all accounts)')
console.log('══════════════════════════════════════')

for (const a of supported) {
  console.log(`\n─── ${a.account_name} (${a.exchange}) chunk_index=12 ───`)
  try {
    const r = await post('/api/sync/transactions-backfill', {
      account_id: a.id,
      chunk_index: 12,
    })
    console.log(`  inserted=${r.inserted} skipped=${r.skipped} window=${r.window?.since?.slice(0,10)} → ${r.window?.until?.slice(0,10)} error=${r.error ?? '—'}`)
  } catch (e) {
    console.log(`  ERROR: ${e.message}`)
  }
}

// ─── 5. Bybit internal transfers check ───────────────────────────────────────
console.log('\n══════════════════════════════════════')
console.log('5. BYBIT INTERNAL TRANSFERS (last 30 days)')
console.log('══════════════════════════════════════')
const bybitAccounts = accounts.filter(a => a.exchange === 'bybit')
for (const a of bybitAccounts) {
  console.log(`\n─── ${a.account_name} ───`)
  try {
    const r = await post('/api/debug/internal-transfers', { account_id: a.id })
    console.log(JSON.stringify(r, null, 2))
  } catch (e) {
    console.log(`  (no internal-transfers endpoint yet): ${e.message}`)
  }
}

console.log('\n══════════════════════════════════════')
console.log('DONE')
console.log('══════════════════════════════════════\n')
