import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import * as ccxt from 'ccxt'

/**
 * POST /api/debug/binance-account-type
 * Diagnoses whether a Binance account is a sub-account or master account,
 * and what transfer history is accessible with its own API keys.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body      = await req.json() as Record<string, unknown>
  const accountId = body.account_id as string | undefined

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, instrument, api_key, api_secret')
    .eq('id', accountId)
    .single()

  if (error || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const acc = account as Record<string, string>
  if (acc.exchange !== 'binance') return NextResponse.json({ error: 'Binance only' }, { status: 400 })

  const ex = new ccxt.binance({
    apiKey: decrypt(acc.api_key),
    secret: decrypt(acc.api_secret),
  })

  const result: Record<string, unknown> = {
    account_name: acc.account_name,
    instrument:   acc.instrument,
  }

  const daysAgo = typeof body.days_ago === 'number' ? body.days_ago : 90
  const startTime = Date.now() - daysAgo * 24 * 60 * 60 * 1000

  result['lookback_days'] = daysAgo

  // 1a. Sub-user history (sub-account endpoint: shows transfers to/from THIS sub-account)
  for (const type of [1, 2]) {
    const key = type === 1 ? 'subUserHistory_in' : 'subUserHistory_out'
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (ex as any).sapiGetSubAccountTransferSubUserHistory({
        type, startTime, endTime: Date.now(), limit: 500,
      })
      result[key] = { ok: true, count: Array.isArray(resp) ? resp.length : 'not array', sample: Array.isArray(resp) ? resp.slice(0, 5) : resp }
    } catch (e) {
      result[key] = { ok: false, error: String(e).slice(0, 300) }
    }
  }

  // 1b. Master transfer history (master-account endpoint: sees all sub<->master transfers)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (ex as any).sapiGetSubAccountTransferHistory({
      startTime, endTime: Date.now(), limit: 500,
    })
    result['masterTransferHistory'] = { ok: true, count: Array.isArray(resp) ? resp.length : 'not array', sample: Array.isArray(resp) ? resp.slice(0, 5) : resp }
  } catch (e) {
    result['masterTransferHistory'] = { ok: false, error: String(e).slice(0, 300) }
  }

  // 2. PAPI UM income — all income types (not just TRANSFER)
  for (const incomeType of ['TRANSFER', 'REALIZED_PNL', 'FUNDING_FEE', 'COMMISSION']) {
    const key = `papi_um_income_${incomeType.toLowerCase()}`
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (ex as any).papiGetUmIncome({
        incomeType, startTime, endTime: Date.now(), limit: 5,
      })
      result[key] = { ok: true, count: Array.isArray(resp) ? resp.length : 'not array', sample: Array.isArray(resp) ? resp.slice(0, 3) : resp }
    } catch (e) {
      result[key] = { ok: false, error: String(e).slice(0, 300) }
    }
  }

  // 3. PAPI CM income (TRANSFER)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (ex as any).papiGetCmIncome({
      incomeType: 'TRANSFER', startTime, endTime: Date.now(), limit: 10,
    })
    result['papi_cm_income_transfer'] = { ok: true, count: Array.isArray(resp) ? resp.length : 'not array', sample: Array.isArray(resp) ? resp.slice(0, 3) : resp }
  } catch (e) {
    result['papi_cm_income_transfer'] = { ok: false, error: String(e).slice(0, 300) }
  }

  // 4. Universal asset transfer — all PM-related types
  for (const transferType of [
    'MAIN_PORTFOLIO_MARGIN', 'PORTFOLIO_MARGIN_MAIN',
    'MAIN_UMFUTURE', 'UMFUTURE_MAIN',
    'MAIN_MARGIN', 'MARGIN_MAIN',
  ]) {
    const key = `asset_transfer_${transferType}`
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = await (ex as any).sapiGetAssetTransfer({
        type: transferType, startTime, endTime: Date.now(), size: 10,
      })
      const rows = (resp as Record<string, unknown>)?.rows ?? resp
      result[key] = { ok: true, count: Array.isArray(rows) ? rows.length : 'not array', sample: Array.isArray(rows) ? rows.slice(0, 3) : rows }
    } catch (e) {
      result[key] = { ok: false, error: String(e).slice(0, 300) }
    }
  }

  // 5. Blockchain deposits (external)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (ex as any).fetchDeposits(undefined, startTime, 100) as Array<Record<string, unknown>>
    result['blockchain_deposits'] = { ok: true, count: resp.length, sample: resp.slice(0, 5).map(d => ({ currency: d['currency'], amount: d['amount'], datetime: d['datetime'], status: d['status'] })) }
  } catch (e) {
    result['blockchain_deposits'] = { ok: false, error: String(e).slice(0, 300) }
  }

  // 6. Blockchain withdrawals (external)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (ex as any).fetchWithdrawals(undefined, startTime, 100) as Array<Record<string, unknown>>
    result['blockchain_withdrawals'] = { ok: true, count: resp.length, sample: resp.slice(0, 5).map(d => ({ currency: d['currency'], amount: d['amount'], datetime: d['datetime'], status: d['status'] })) }
  } catch (e) {
    result['blockchain_withdrawals'] = { ok: false, error: String(e).slice(0, 300) }
  }

  // 7. Account info (is this a sub-account or master?)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (ex as any).sapiGetSubAccountStatus({}) as unknown
    result['subAccountStatus'] = { ok: true, data: resp }
  } catch (e) {
    result['subAccountStatus'] = { ok: false, error: String(e).slice(0, 300) }
  }

  // 8. PAPI balance
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await (ex as any).papiGetBalance()
    const balances = (Array.isArray(resp) ? resp : []) as Array<Record<string, string>>
    const usdt = balances.find(b => b['asset'] === 'USDT')
    result['papi_balance'] = { ok: true, usdt_balance: usdt ?? null, total_assets: balances.length }
  } catch (e) {
    result['papi_balance'] = { ok: false, error: String(e).slice(0, 300) }
  }

  return NextResponse.json(result)
}
