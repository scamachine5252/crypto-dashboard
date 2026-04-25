import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'
import { MexcAdapter }    from '@/lib/adapters/mexc'
import type { ExchangeAdapter } from '@/lib/adapters/types'
import { evaluateRules } from './evaluate'
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
}

export async function runRiskEvaluation(): Promise<{ evaluated: number; violations: number }> {
  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, api_key, api_secret, passphrase, instrument, is_suspended')
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
      if (rules.length === 0) continue

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

      const { data: latestBal } = await supabaseAdmin
        .from('balances')
        .select('usdt_balance')
        .eq('account_id', row.id)
        .is('token_symbol', null)
        .order('recorded_at', { ascending: false })
        .limit(1)

      const currentUsdtBalance = Number(latestBal?.[0]?.usdt_balance ?? 0)

      const { data: athBal } = await supabaseAdmin
        .from('balances')
        .select('usdt_balance')
        .eq('account_id', row.id)
        .is('token_symbol', null)
        .order('usdt_balance', { ascending: false })
        .limit(1)

      const athUsdtBalance = Number(athBal?.[0]?.usdt_balance ?? currentUsdtBalance)

      const violations = evaluateRules({ positions, currentUsdtBalance, athUsdtBalance, rules })
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

        const suspended = v.severity === 'critical' && v.rule.kill_threshold !== null

        if (suspended) {
          await supabaseAdmin.from('accounts').update({ is_suspended: true }).eq('id', row.id)
        }

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

        totalViolations++
      }
    } catch {
      // Skip failed accounts silently
    }
  }

  return { evaluated, violations: totalViolations }
}
