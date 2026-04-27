import 'server-only'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BybitAdapter }   from '@/lib/adapters/bybit'
import { BinanceAdapter } from '@/lib/adapters/binance'
import { OkxAdapter }     from '@/lib/adapters/okx'
import { MexcAdapter }    from '@/lib/adapters/mexc'
import type { Position } from '@/lib/types'
import type { RawPosition } from '@/lib/adapters/types'
import { computeAllMetricValues } from '@/lib/risk/evaluate'
import type { RuleType } from '@/lib/risk/types'

type DbAccount = {
  id: string
  account_name: string
  exchange: string
  fund: string
  api_key: string
  api_secret: string
  passphrase: string | null
  instrument: string | null
}

type TxnRow = { type: string; amount: number; recorded_at: string }
type BalRow = { usdt_balance: number; total_equity_usdt: number | null; recorded_at: string }

async function fetchAdjustedBalances(accountId: string): Promise<{
  currentUsdtBalance: number
  athUsdtBalance: number
  peakAdjustedBalance: number
  currentAdjustedBalance: number
  netDeposits: number
}> {
  const [
    { data: latestBal },
    { data: athBal },
    { data: txns },
    { data: allBals },
  ] = await Promise.all([
    supabaseAdmin
      .from('balances')
      .select('usdt_balance, total_equity_usdt')
      .eq('account_id', accountId)
      .is('token_symbol', null)
      .order('recorded_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('balances')
      .select('usdt_balance, total_equity_usdt')
      .eq('account_id', accountId)
      .is('token_symbol', null)
      .order('usdt_balance', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('transactions')
      .select('type, amount, recorded_at')
      .eq('account_id', accountId)
      .eq('asset', 'USDT')
      .order('recorded_at', { ascending: true }),
    supabaseAdmin
      .from('balances')
      .select('usdt_balance, total_equity_usdt, recorded_at')
      .eq('account_id', accountId)
      .is('token_symbol', null)
      .order('recorded_at', { ascending: true }),
  ])

  const latestRow = (latestBal?.[0] as BalRow | undefined)
  const athRow    = (athBal?.[0]    as BalRow | undefined)
  const currentUsdtBalance = Number(latestRow?.total_equity_usdt ?? latestRow?.usdt_balance ?? 0)
  const athUsdtBalance     = Number(athRow?.total_equity_usdt    ?? athRow?.usdt_balance    ?? currentUsdtBalance)

  const txList = (txns ?? []) as TxnRow[]
  let peakAdjustedBalance = 0
  let cumDeps = 0, cumWith = 0, txIdx = 0

  for (const bal of ((allBals ?? []) as BalRow[])) {
    while (txIdx < txList.length && txList[txIdx].recorded_at <= bal.recorded_at) {
      if (txList[txIdx].type === 'deposit')    cumDeps += Number(txList[txIdx].amount)
      if (txList[txIdx].type === 'withdrawal') cumWith += Number(txList[txIdx].amount)
      txIdx++
    }
    const balValue = Number(bal.total_equity_usdt ?? bal.usdt_balance)
    const adj = balValue - cumDeps + cumWith
    if (adj > peakAdjustedBalance) peakAdjustedBalance = adj
  }

  const totalDeps = txList.filter(t => t.type === 'deposit').reduce((s, t) => s + Number(t.amount), 0)
  const totalWith = txList.filter(t => t.type === 'withdrawal').reduce((s, t) => s + Number(t.amount), 0)
  const currentAdjustedBalance = currentUsdtBalance - totalDeps + totalWith
  const netDeposits = totalDeps - totalWith

  return { currentUsdtBalance, athUsdtBalance, peakAdjustedBalance, currentAdjustedBalance, netDeposits }
}

export async function GET(): Promise<NextResponse> {
  const { data: accounts, error: accErr } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, fund, api_key, api_secret, passphrase, instrument')

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ results: [] })
  }

  const results = await Promise.allSettled(
    (accounts as DbAccount[]).map(async (acc) => {
      const apiKey    = decrypt(acc.api_key)
      const apiSecret = decrypt(acc.api_secret)

      let rawPositions: RawPosition[]
      switch (acc.exchange) {
        case 'bybit':
          rawPositions = await new BybitAdapter({ apiKey, apiSecret }).fetchPositions()
          break
        case 'binance': {
          const isPortfolioMargin = acc.instrument === 'portfolio_margin'
          rawPositions = await new BinanceAdapter({ apiKey, apiSecret, ...(isPortfolioMargin ? { portfolioMargin: true } : {}) }).fetchPositions()
          break
        }
        case 'okx': {
          const passphrase = acc.passphrase ? decrypt(acc.passphrase) : ''
          rawPositions = await new OkxAdapter({ apiKey, apiSecret, passphrase }).fetchPositions()
          break
        }
        case 'mexc':
          rawPositions = await new MexcAdapter({ apiKey, apiSecret }).fetchPositions()
          break
        default:
          rawPositions = []
      }

      const positions: Position[] = rawPositions.map((p) => ({
        ...p,
        accountId:   acc.id,
        accountName: acc.account_name,
        exchange:    acc.exchange,
      }))

      const { currentUsdtBalance, athUsdtBalance, peakAdjustedBalance, currentAdjustedBalance, netDeposits } =
        await fetchAdjustedBalances(acc.id)

      const metrics = computeAllMetricValues({
        positions,
        currentUsdtBalance,
        athUsdtBalance,
        peakAdjustedBalance,
        currentAdjustedBalance,
        netDeposits,
      })

      return {
        account_id:   acc.id,
        account_name: acc.account_name,
        exchange:     acc.exchange,
        fund:         acc.fund,
        metrics:      metrics as Record<RuleType, number>,
        positions,
        currentUsdtBalance,
      }
    }),
  )

  const output = results
    .filter((r): r is PromiseFulfilledResult<NonNullable<(typeof results)[number] extends PromiseFulfilledResult<infer T> ? T : never>> => r.status === 'fulfilled')
    .map(r => r.value)

  return NextResponse.json({ results: output })
}
