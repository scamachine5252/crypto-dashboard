/**
 * Diagnoses Binance WebSocket 404 for non-PM accounts.
 * Run on the Hetzner server: node scripts/diag-binance-ws.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { createDecipheriv } from 'crypto'
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { WebSocket } from 'ws'

// ── Load .env.local manually ──────────────────────────────────────────────────
const envFile = readFileSync('.env.local', 'utf8')
const env = Object.fromEntries(
  envFile.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')]
    })
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = env.SUPABASE_SECRET_KEY
const ENC_KEY      = env.ENCRYPTION_KEY   // hex string

if (!SUPABASE_URL || !SUPABASE_KEY || !ENC_KEY) {
  console.error('Missing env vars. Check .env.local')
  process.exit(1)
}

// ── Decrypt (mirrors lib/crypto/decrypt.ts) — format: iv:authTag:ciphertext ──
function decrypt(ciphertext) {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error(`Invalid format (expected iv:tag:data, got ${parts.length} parts)`)
  const [ivHex, tagHex, dataHex] = parts
  const key    = Buffer.from(ENC_KEY, 'hex')
  const iv     = Buffer.from(ivHex, 'hex')
  const tag    = Buffer.from(tagHex, 'hex')
  const data   = Buffer.from(dataHex, 'hex')
  const cipher = createDecipheriv('aes-256-gcm', key, iv)
  cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8')
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Step 1: Check server IP ───────────────────────────────────────────────────
console.log('\n=== STEP 1: Server public IP ===')
try {
  const ipRes = await fetch('https://ifconfig.me/ip')
  const ip = await ipRes.text()
  console.log(`Server IP: ${ip.trim()}`)
  console.log('→ This is the IP Binance sees. Check if it is blocked/restricted.')
} catch (e) {
  console.error('Failed to get IP:', e.message)
}

// ── Step 2: Test Binance REST reachability ────────────────────────────────────
console.log('\n=== STEP 2: Binance REST reachability ===')
for (const [label, url] of [
  ['FAPI ping (non-PM)', 'https://fapi.binance.com/fapi/v1/ping'],
  ['PAPI ping (PM)',     'https://papi.binance.com/papi/v1/ping'],
]) {
  try {
    const r = await fetch(url)
    console.log(`${label}: HTTP ${r.status} ${r.statusText}`)
  } catch (e) {
    console.error(`${label}: FAILED — ${e.message}`)
  }
}

// ── Load Binance accounts ─────────────────────────────────────────────────────
const { data: accounts, error } = await supabase
  .from('accounts')
  .select('id, account_name, instrument, api_key, api_secret')
  .eq('exchange', 'binance')

if (error) { console.error('DB error:', error.message); process.exit(1) }

// ── Step 3: Test listenKey creation per account ───────────────────────────────
console.log('\n=== STEP 3: listenKey creation ===')
const results = []
for (const acct of accounts) {
  const pm      = acct.instrument === 'portfolio_margin'
  const base    = pm ? 'https://papi.binance.com' : 'https://fapi.binance.com'
  const path    = pm ? '/papi/v1/listenKey' : '/fapi/v1/listenKey'
  let apiKey
  try { apiKey = decrypt(acct.api_key) } catch (e) {
    console.log(`  ${acct.account_name}: decrypt failed — ${e.message}`)
    continue
  }

  try {
    const r    = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': apiKey },
    })
    const body = await r.text()
    let listenKey = null
    try { listenKey = JSON.parse(body).listenKey } catch {}

    if (r.ok && listenKey) {
      const wsPrefix = pm ? 'pm/ws' : 'ws'
      const wsUrl    = `wss://fstream.binance.com/${wsPrefix}/${listenKey}`
      console.log(`  ${acct.account_name} (${pm ? 'PM' : 'non-PM'}): listenKey OK → ${wsUrl.slice(0, 60)}...`)
      results.push({ acct, listenKey, wsUrl, pm })
    } else {
      console.log(`  ${acct.account_name}: HTTP ${r.status} — ${body.slice(0, 200)}`)
    }
  } catch (e) {
    console.log(`  ${acct.account_name}: fetch error — ${e.message}`)
  }
}

// ── Step 4: Test WS connection for each account ───────────────────────────────
console.log('\n=== STEP 4: WebSocket connection test (5s timeout) ===')
for (const { acct, wsUrl, pm } of results) {
  await new Promise(resolve => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      ws.terminate()
      console.log(`  ${acct.account_name} (${pm ? 'PM' : 'non-PM'}): ✓ Connected (no 404, received data or timeout)`)
      resolve()
    }, 5000)

    ws.on('open', () => {
      console.log(`  ${acct.account_name} (${pm ? 'PM' : 'non-PM'}): ✓ WS open — connection works!`)
      clearTimeout(timer)
      ws.close()
      resolve()
    })

    ws.on('error', err => {
      clearTimeout(timer)
      console.log(`  ${acct.account_name} (${pm ? 'PM' : 'non-PM'}): ✗ WS error — ${err.message}`)
      resolve()
    })

    ws.on('close', (code, reason) => {
      clearTimeout(timer)
      console.log(`  ${acct.account_name} (${pm ? 'PM' : 'non-PM'}): WS closed — code=${code} reason=${reason.toString()}`)
      resolve()
    })
  })
}

console.log('\n=== DONE ===')
