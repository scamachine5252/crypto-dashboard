import { createClient } from '@supabase/supabase-js'
import ccxt from 'ccxt'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
)

// inline decrypt (mirrors lib/crypto/decrypt.ts) — format: iv:authTag:ciphertext (hex, colon-separated)
import { createDecipheriv } from 'crypto'
function decrypt(ciphertext) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')
  const [ivHex, authTagHex, encHex] = ciphertext.split(':')
  const iv      = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const enc     = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

const { data: account } = await sb
  .from('accounts')
  .select('account_name, api_key, api_secret')
  .eq('exchange', 'bybit')
  .limit(1)
  .single()

console.log('Account:', account.account_name)

const apiKey    = decrypt(account.api_key)
const apiSecret = decrypt(account.api_secret)

const exchange = new ccxt.bybit({ apiKey, secret: apiSecret })
const raw = await exchange.fetchBalance()

console.log('\n--- raw.info keys ---')
console.log(Object.keys(raw.info ?? {}))

console.log('\n--- raw.info.result keys (if exists) ---')
console.log(Object.keys(raw.info?.result ?? {}))

console.log('\n--- raw.info.result.list[0] ---')
const list = raw.info?.result?.list
console.log(JSON.stringify(list?.[0], null, 2))

console.log('\n--- raw.total[USDT] ---')
console.log(raw.total?.USDT)
