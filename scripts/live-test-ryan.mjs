/**
 * Live diagnostic test for Ryan's Bybit account.
 * Run: node scripts/live-test-ryan.mjs
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const ccxt = require('ccxt')

const ENCRYPTION_KEY = '7a2dc01dcd2ec9a180da1db302ea8613eaf02bc0ec798505be5290b01fd32b6d'
const ENC_API_KEY    = 'fac7d33165fdcf895206baac:59ef0714588fa23e8b1e92f8068084d4:2f4632582318ff723230a6adab43b243269a'
const ENC_API_SECRET = 'a9e976f00495267449705135:2b328b1f8f08583be37eb5a2fee27a44:28c422779d4ea39bcc957f7e04025b90bd51472f4cdba159ac22a8e6b480f027c9d6a6f8'

function decrypt(encrypted) {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':')
  const key        = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv         = Buffer.from(ivHex, 'hex')
  const authTag    = Buffer.from(authTagHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const decipher   = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

const apiKey    = decrypt(ENC_API_KEY)
const apiSecret = decrypt(ENC_API_SECRET)

console.log('✓ Decrypted API key:', apiKey.slice(0, 6) + '...')

const exchange = new ccxt.bybit({
  apiKey,
  secret: apiSecret,
  options: { defaultType: 'unified' },
})

// Test window: last 30 days in 7-day chunks
const now     = Date.now()
const DAY_MS  = 24 * 60 * 60 * 1000

async function testExecutionList(category, since, until) {
  const label = `${category} ${new Date(since).toISOString().slice(0,10)}..${new Date(until).toISOString().slice(0,10)}`
  try {
    const response = await exchange.privateGetV5ExecutionList({
      category,
      limit: 100,
      startTime: since,
      endTime: until,
    })
    const result = response?.result ?? {}
    const list   = result.list ?? []
    const cursor = result.nextPageCursor

    if (list.length === 0) {
      console.log(`  [${label}] → 0 rows`)
      return { count: 0, nonZeroPnl: 0, sample: null }
    }

    const nonZeroPnl = list.filter(r => Number(r.execPnl) !== 0).length
    const sample     = list[0]

    console.log(`  [${label}] → ${list.length} rows | nonZeroPnl=${nonZeroPnl} | cursor="${cursor}"`)
    console.log(`    sample: execType=${sample.execType} side=${sample.side} execPnl=${sample.execPnl} closedSize=${sample.closedSize} execQty=${sample.execQty} execPrice=${sample.execPrice}`)

    return { count: list.length, nonZeroPnl, sample, cursor }
  } catch (e) {
    console.log(`  [${label}] → ERROR: ${e.constructor.name}: ${e.message}`)
    return { count: 0, nonZeroPnl: 0, error: e.message }
  }
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('LIVE TEST: Ryan Bybit — Execution List Diagnostic')
  console.log('═══════════════════════════════════════════════════\n')

  // ── Test 1: Balance (auth check) ──────────────────────────────────────────
  console.log('【1】 Auth check (fetchBalance)...')
  try {
    const bal = await exchange.fetchBalance()
    const usdt = bal?.total?.USDT ?? bal?.info?.result?.list?.[0]?.totalWalletBalance ?? '?'
    console.log(`  ✓ Connected | USDT balance: ${usdt}\n`)
  } catch (e) {
    console.log(`  ✗ Auth FAILED: ${e.message}\n`)
    return
  }

  // ── Test 2: linear, last 7 days ───────────────────────────────────────────
  console.log('【2】 Linear executions — last 7 days:')
  const r1 = await testExecutionList('linear', now - 7*DAY_MS, now)

  // ── Test 3: linear, 7–14 days ago ────────────────────────────────────────
  console.log('\n【3】 Linear executions — 7–14 days ago:')
  const r2 = await testExecutionList('linear', now - 14*DAY_MS, now - 7*DAY_MS)

  // ── Test 4: linear, 14–21 days ago ───────────────────────────────────────
  console.log('\n【4】 Linear executions — 14–21 days ago:')
  const r3 = await testExecutionList('linear', now - 21*DAY_MS, now - 14*DAY_MS)

  // ── Test 5: linear, 21–30 days ago ───────────────────────────────────────
  console.log('\n【5】 Linear executions — 21–30 days ago:')
  const r4 = await testExecutionList('linear', now - 30*DAY_MS, now - 21*DAY_MS)

  // ── Test 6: inverse ───────────────────────────────────────────────────────
  console.log('\n【6】 Inverse executions — last 30 days:')
  await testExecutionList('inverse', now - 30*DAY_MS, now)

  // ── Test 7: no time filter (see if there's ANY data) ─────────────────────
  console.log('\n【7】 Linear — NO time filter (most recent 100 rows):')
  try {
    const response = await exchange.privateGetV5ExecutionList({ category: 'linear', limit: 5 })
    const list = response?.result?.list ?? []
    console.log(`  rows=${list.length}`)
    for (const r of list.slice(0, 3)) {
      const ts = new Date(Number(r.execTime)).toISOString()
      console.log(`  ${ts} ${r.symbol} ${r.side} qty=${r.execQty} pnl=${r.execPnl} closedSize=${r.closedSize} type=${r.execType}`)
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════')
  const total = [r1, r2, r3, r4].reduce((s, r) => s + (r.count || 0), 0)
  const totalPnl = [r1, r2, r3, r4].reduce((s, r) => s + (r.nonZeroPnl || 0), 0)
  console.log(`SUMMARY (last 30 days linear): ${total} rows, ${totalPnl} non-zero execPnl`)
  if (total === 0) {
    console.log('⚠️  NO DATA from API — check if Ryan has trades in the last 30 days')
    console.log('   Or the account may have a different category (spot only?)')
  } else if (totalPnl === 0) {
    console.log('⚠️  Data exists but ALL execPnl = 0 — opening fills only or all breakeven')
    console.log('   This would mean Variant A fix still returns 0 trades')
  } else {
    console.log('✓  Data looks good — non-zero execPnl found → Variant A fix should work')
  }
  console.log('═══════════════════════════════════════════════════\n')
}

main().catch(console.error)
