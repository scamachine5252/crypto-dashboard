/**
 * filimonov-deep-audit.mjs
 * Run: node scripts/filimonov-deep-audit.mjs
 *
 * Deep diagnostic for Filimonov account — finds where the $27K balance came from.
 * Uses the dev server at localhost:3000 to avoid module resolution issues.
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

// 1. Find Filimonov account
const accounts = await get('/api/accounts')
const fil = accounts.find(a => a.account_name?.toLowerCase().includes('filimonov'))
if (!fil) {
  console.error('Filimonov account not found. Available:', accounts.map(a => a.account_name))
  process.exit(1)
}
console.log(`\n✅ Found: ${fil.account_name} (${fil.exchange}, ${fil.instrument}) id=${fil.id}`)

// 2. Run extended debug with 180-day lookback
console.log('\n══════════════════════════════════════')
console.log('2. BINANCE ACCOUNT TYPE / TRANSFER DEBUG (180d)')
console.log('══════════════════════════════════════')
const typeDebug = await post('/api/debug/binance-account-type', { account_id: fil.id, days_ago: 180 })
// Print summary only for non-zero results
for (const [key, val] of Object.entries(typeDebug)) {
  if (key === 'account_name' || key === 'instrument' || key === 'lookback_days') {
    console.log(`  ${key}: ${val}`)
    continue
  }
  const v = val
  if (!v.ok) {
    console.log(`  ❌ ${key}: ${String(v.error).slice(0, 120)}`)
  } else if (v.count === 0 || v.count === 'not array') {
    if (typeof v.count === 'string' || v.count === 0) {
      console.log(`  ⬜ ${key}: ${JSON.stringify(v.sample ?? v.count)}`)
    }
  } else {
    console.log(`  ✅ ${key}: count=${v.count}`)
    console.log(`     sample: ${JSON.stringify(v.sample).slice(0, 500)}`)
  }
}

// 3. Check transactions already in DB
console.log('\n══════════════════════════════════════')
console.log('3. TRANSACTIONS IN DB')
console.log('══════════════════════════════════════')
const txResp = await get(`/api/transactions?account_ids=${fil.id}&since=2000-01-01&until=2099-12-31`)
const txs = txResp.transactions ?? []
console.log(`Total transactions in DB: ${txs.length}`)
for (const t of txs) {
  const sign = t.type === 'deposit' ? '+' : '-'
  console.log(`  ${t.recorded_at?.slice(0,10)}  ${t.type.padEnd(12)} ${sign}${t.amount} ${t.asset}  tx_id=${t.tx_id}`)
}

// 4. Check balances coverage
console.log('\n══════════════════════════════════════')
console.log('4. BALANCE HISTORY IN DB')
console.log('══════════════════════════════════════')
const covResp = await get('/api/debug/balance-coverage').catch(() => null)
if (covResp) {
  const filBal = covResp.find?.(r => r.account_id === fil.id)
  if (filBal) {
    console.log(`  Min date: ${filBal.min_date}`)
    console.log(`  Max date: ${filBal.max_date}`)
    console.log(`  Row count: ${filBal.count}`)
  } else {
    console.log('  No balance rows found for Filimonov')
    console.log('  All accounts:', covResp)
  }
} else {
  console.log('  balance-coverage endpoint not available')
}

// 5. Run the transactions backfill to try to find anything
console.log('\n══════════════════════════════════════')
console.log('5. RUNNING TRANSACTIONS BACKFILL (chunk 0 = oldest 90-day window)')
console.log('══════════════════════════════════════')
const bf = await post('/api/sync/transactions-backfill', { account_id: fil.id, chunk_index: 0 })
console.log(JSON.stringify(bf, null, 2))
