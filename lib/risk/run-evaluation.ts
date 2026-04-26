import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'
import { MexcAdapter }    from '@/lib/adapters/mexc'
import type { ExchangeAdapter } from '@/lib/adapters/types'
import { evaluateRules, computeAllMetricValues } from './evaluate'
import { sendTelegramAlert, formatAlertMessage } from '@/lib/telegram'
import type { RiskRule } from './types'

type AccountRow = {
  id: string
  account_name: string
  exchange: string
  api_key: string
  api_secret: string
  passphrase: string | null
  instrument: string | null
  is_suspended: boolean
  kill_switch_enabled: boolean
}

async function computeAdjustedBalances(accountId: string, currentUsdtBalance: number): Promise<{
  peakAdjustedBalance: number
  currentAdjustedBalance: number
}> {
  const [{ data: txns }, { data: allBals }] = await Promise.all([
    supabaseAdmin
      .from('transactions')
      .select('type, amount, recorded_at')
      .eq('account_id', accountId)
      .eq('asset', 'USDT')
      .order('recorded_at', { ascending: true }),
    supabaseAdmin
      .from('balances')
      .select('usdt_balance, recorded_at')
      .eq('account_id', accountId)
      .is('token_symbol', null)
      .order('recorded_at', { ascending: true }),
  ])

  const txList = (txns ?? []) as { type: string; amount: number; recorded_at: string }[]
  let peakAdjustedBalance = 0
  let cumDeps = 0, cumWith = 0, txIdx = 0

  for (const bal of (allBals ?? [])) {
    while (txIdx < txList.length && txList[txIdx].recorded_at <= bal.recorded_at) {
      if (txList[txIdx].type === 'deposit')    cumDeps += Number(txList[txIdx].amount)
      if (txList[txIdx].type === 'withdrawal') cumWith += Number(txList[txIdx].amount)
      txIdx++
    }
    const adj = Number(bal.usdt_balance) - cumDeps + cumWith
    if (adj > peakAdjustedBalance) peakAdjustedBalance = adj
  }

  const totalDeps = txList.filter(t => t.type === 'deposit').reduce((s, t) => s + Number(t.amount), 0)
  const totalWith = txList.filter(t => t.type === 'withdrawal').reduce((s, t) => s + Number(t.amount), 0)
  const currentAdjustedBalance = currentUsdtBalance - totalDeps + totalWith

  return { peakAdjustedBalance, currentAdjustedBalance }
}

export async function runRiskEvaluation(): Promise<{ evaluated: number; violations: number }> {
  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, api_key, api_secret, passphrase, instrument, is_suspended, kill_switch_enabled')
    .eq('is_suspended', false)

  if (accErr || !accounts) return { evaluated: 0, violations: 0 }

  let evaluated = 0
  let totalViolations = 0

  for (const row of accounts as AccountRow[]) {
    try {
      const { data: rulesData } = await supabaseAdmin
        .from('risk_rules')
        .select('id, account_id, rule_type, alert_threshold, kill_threshold, enabled')
        .eq('account_id', row.id)
        .eq('enabled', true)

      const rules = (rulesData ?? []) as RiskRule[]

      const apiKey    = decrypt(row.api_key)
      const apiSecret = decrypt(row.api_secret)
      let adapter: ExchangeAdapter
      switch (row.exchange) {
        case 'bybit':
          adapter = new BybitAdapter({ apiKey, apiSecret })
          break
        case 'binance':
          adapter = new BinanceAdapter({ apiKey, apiSecret, ...(row.instrument === 'portfolio_margin' ? { portfolioMargin: true } : {}) })
          break
        case 'okx':
          adapter = new OkxAdapter({ apiKey, apiSecret, passphrase: row.passphrase ? decrypt(row.passphrase) : '' })
          break
        case 'mexc':
          adapter = new MexcAdapter({ apiKey, apiSecret })
          break
        default:
          continue
      }

      const rawPositions = await adapter.fetchPositions()
      const positions = rawPositions.map(p => ({
        ...p,
        accountId:   row.id,
        accountName: row.account_name,
        exchange:    row.exchange,
      }))

      const [{ data: latestBal }, { data: athBal }] = await Promise.all([
        supabaseAdmin
          .from('balances')
          .select('usdt_balance')
          .eq('account_id', row.id)
          .is('token_symbol', null)
          .order('recorded_at', { ascending: false })
          .limit(1),
        supabaseAdmin
          .from('balances')
          .select('usdt_balance')
          .eq('account_id', row.id)
          .is('token_symbol', null)
          .order('usdt_balance', { ascending: false })
          .limit(1),
      ])

      const currentUsdtBalance = Number(latestBal?.[0]?.usdt_balance ?? 0)
      const athUsdtBalance = Number(athBal?.[0]?.usdt_balance ?? currentUsdtBalance)

      const { peakAdjustedBalance, currentAdjustedBalance } = await computeAdjustedBalances(row.id, currentUsdtBalance)

      const evaluatedAt = new Date().toISOString()
      const allValues = computeAllMetricValues({ positions, currentUsdtBalance, athUsdtBalance, peakAdjustedBalance, currentAdjustedBalance })
      await supabaseAdmin
        .from('risk_metric_snapshots')
        .upsert(
          Object.entries(allValues).map(([rule_type, current_value]) => ({
            account_id: row.id, rule_type, current_value, evaluated_at: evaluatedAt,
          })),
          { onConflict: 'account_id,rule_type' },
        )

      const violations = evaluateRules({ positions, currentUsdtBalance, athUsdtBalance, peakAdjustedBalance, currentAdjustedBalance, rules })
      evaluated++

      for (const v of violations) {
        const today = new Date().toISOString().slice(0, 10)
        const { count } = await supabaseAdmin
          .from('risk_alerts')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', row.id)
          .eq('rule_type', v.rule.rule_type)
          .eq('acknowledged', false)
          .gte('fired_at', today + 'T00:00:00Z')

        if ((count ?? 0) > 0) continue

        await supabaseAdmin.from('risk_alerts').insert({
          account_id:      row.id,
          rule_type:       v.rule.rule_type,
          current_value:   v.current_value,
          alert_threshold: v.rule.alert_threshold,
          kill_threshold:  v.rule.kill_threshold,
          severity:        v.severity,
        })

        const suspended = v.severity === 'critical'
          && v.rule.kill_threshold !== null
          && row.kill_switch_enabled !== false

        if (suspended) {
          await supabaseAdmin.from('accounts').update({ is_suspended: true }).eq('id', row.id)
        }

        try {
          await sendTelegramAlert(formatAlertMessage({
            accountName:    row.account_name,
            exchange:       row.exchange,
            ruleType:       v.rule.rule_type,
            currentValue:   v.current_value,
            alertThreshold: v.rule.alert_threshold,
            severity:       v.severity,
            killThreshold:  v.rule.kill_threshold,
            suspended,
          }))
        } catch (e) {
          console.error('Telegram alert failed:', e)
        }

        totalViolations++
      }
    } catch {
      // Skip failed accounts silently
    }
  }

  return { evaluated, violations: totalViolations }
}
