import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import * as ccxt from 'ccxt'

/**
 * POST /api/debug/transactions
 * Reconnaissance endpoint: tests deposits, withdrawals, and transaction-log
 * availability for a given account.
 *
 * Body: { account_id: string, days_ago?: number }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body      = await req.json() as Record<string, unknown>
  const accountId = body.account_id as string | undefined
  const daysAgo        = typeof body.days_ago === 'number' ? body.days_ago : 90
  const snapshotType   = (body.snapshot_type as string | undefined) ?? 'SPOT'

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, api_key, api_secret, passphrase')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const acc      = account as Record<string, string>
  const exchange = acc.exchange

  const until = Date.now()
  const since = until - daysAgo * 24 * 60 * 60 * 1000

  const result: Record<string, unknown> = {
    account_name: acc.account_name,
    exchange,
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString(), days_ago: daysAgo },
  }

  // ── Bybit ────────────────────────────────────────────────────────────────
  if (exchange === 'bybit') {
    const ex = new ccxt.bybit({
      apiKey: decrypt(acc.api_key),
      secret: decrypt(acc.api_secret),
      options: { defaultType: 'unified' },
    }) as ccxt.bybit & Record<string, unknown>

    // 1. Deposits — Bybit raw API (CCXT wrapper has wrong params)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const depRaw = await (ex as any).privateGetV5AssetDepositQueryRecord({
        startTime: since,
        endTime:   until,
        limit:     20,
      }) as Record<string, unknown>
      const depResult = (depRaw?.result ?? {}) as Record<string, unknown>
      const depList   = (depResult.rows ?? []) as Array<Record<string, unknown>>
      result['deposits_raw'] = {
        ok:    true,
        count: depList.length,
        sample: depList.slice(0, 3).map(d => ({
          txID:      d['txID'],
          coin:      d['coin'],
          amount:    d['amount'],
          status:    d['status'],
          depositTime: d['depositFeeTime'] ?? d['createTime'],
        })),
      }
    } catch (e) {
      result['deposits_raw'] = { ok: false, error: String(e) }
    }

    // 2. Withdrawals — Bybit raw API
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wdRaw = await (ex as any).privateGetV5AssetWithdrawQueryRecord({
        startTime: since,
        endTime:   until,
        limit:     20,
      }) as Record<string, unknown>
      const wdResult = (wdRaw?.result ?? {}) as Record<string, unknown>
      const wdList   = (wdResult.rows ?? []) as Array<Record<string, unknown>>
      result['withdrawals_raw'] = {
        ok:    true,
        count: wdList.length,
        sample: wdList.slice(0, 3).map(w => ({
          txID:       w['txID'],
          coin:       w['coin'],
          amount:     w['amount'],
          withdrawFee: w['withdrawFee'],
          status:     w['status'],
          updateTime: w['updateTime'],
        })),
      }
    } catch (e) {
      result['withdrawals_raw'] = { ok: false, error: String(e) }
    }

    // 3. Raw transaction log — gives actual balance after each event
    // Bybit limit: max 7 days per request, paginate with cursor
    try {
      const CHUNK = 7 * 24 * 60 * 60 * 1000
      const chunkEnd   = until
      const chunkStart = chunkEnd - CHUNK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txLog = await (ex as any).privateGetV5AccountTransactionLog({
        accountType: 'UNIFIED',
        startTime:   chunkStart,
        endTime:     chunkEnd,
        limit:       50,
      }) as Record<string, unknown>

      const txResult = (txLog?.result ?? {}) as Record<string, unknown>
      const txList   = (txResult.list ?? []) as Array<Record<string, unknown>>

      // Show unique types present
      const typeCounts: Record<string, number> = {}
      for (const row of txList) {
        const t = String(row['type'] ?? 'unknown')
        typeCounts[t] = (typeCounts[t] ?? 0) + 1
      }

      result['transaction_log_raw'] = {
        ok:         true,
        total_rows: txList.length,
        has_next:   !!(txResult.nextPageCursor),
        type_counts: typeCounts,
        // Show 3 samples to understand structure
        sample: txList.slice(0, 3).map(row => ({
          id:              row['id'],
          symbol:          row['symbol'],
          category:        row['category'],
          side:            row['side'],
          transactionTime: row['transactionTime'],
          type:            row['type'],
          qty:             row['qty'],
          size:            row['size'],
          currency:        row['currency'],
          tradePrice:      row['tradePrice'],
          funding:         row['funding'],
          fee:             row['fee'],
          cashFlow:        row['cashFlow'],
          change:          row['change'],
          cashBalance:     row['cashBalance'],  // ← key field: actual balance after this tx
        })),
      }
    } catch (e) {
      result['transaction_log_raw'] = { ok: false, error: String(e) }
    }

    // 4. fetchLedger via CCXT (alternative mapping)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ledger = await (ex as any).fetchLedger(undefined, since, 20)
      result['ledger_ccxt'] = {
        ok:    true,
        count: ledger.length,
        sample: ledger.slice(0, 3).map((e: Record<string, unknown>) => ({
          id:        e.id,
          direction: e.direction,
          account:   e.account,
          currency:  e.currency,
          amount:    e.amount,
          after:     e.after,   // balance after — if present
          before:    e.before,  // balance before — if present
          type:      e.type,
          timestamp: e.timestamp,
          datetime:  e.datetime,
          info:      e.info,
        })),
      }
    } catch (e) {
      result['ledger_ccxt'] = { ok: false, error: String(e) }
    }

  // ── Binance ───────────────────────────────────────────────────────────────
  } else if (exchange === 'binance') {
    const ex = new ccxt.binance({
      apiKey: decrypt(acc.api_key),
      secret: decrypt(acc.api_secret),
    }) as ccxt.binance & Record<string, unknown>

    // 1. fetchDeposits
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deposits = await (ex as any).fetchDeposits(undefined, since, 20)
      result['deposits_ccxt'] = {
        ok:    true,
        count: deposits.length,
        sample: deposits.slice(0, 3).map((d: Record<string, unknown>) => ({
          id:       d.id,
          currency: d.currency,
          amount:   d.amount,
          status:   d.status,
          datetime: d.datetime,
        })),
      }
    } catch (e) {
      result['deposits_ccxt'] = { ok: false, error: String(e) }
    }

    // 2. fetchWithdrawals
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withdrawals = await (ex as any).fetchWithdrawals(undefined, since, 20)
      result['withdrawals_ccxt'] = {
        ok:    true,
        count: withdrawals.length,
        sample: withdrawals.slice(0, 3).map((w: Record<string, unknown>) => ({
          id:       w.id,
          currency: w.currency,
          amount:   w.amount,
          status:   w.status,
          datetime: w.datetime,
        })),
      }
    } catch (e) {
      result['withdrawals_ccxt'] = { ok: false, error: String(e) }
    }

    // 3. accountSnapshot — daily balance history (up to 30 days)
    try {
      const snapSince = until - 30 * 24 * 60 * 60 * 1000
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snap = await (ex as any).sapiGetAccountSnapshot({
        type:      snapshotType,
        startTime: snapSince,
        endTime:   until,
        limit:     30,
      }) as Record<string, unknown>
      const snapList = (snap?.snapshotVos ?? []) as Array<Record<string, unknown>>
      result['account_snapshot_binance'] = {
        ok:    true,
        count: snapList.length,
        raw_keys: Object.keys(snap ?? {}),
        raw_code: snap?.code,
        raw_msg:  snap?.msg,
        sample: snapList.slice(0, 3).map(s => ({
          type:       s.type,
          updateTime: s.updateTime,
          data:       s.data,
        })),
      }
    } catch (e) {
      result['account_snapshot_binance'] = { ok: false, error: String(e) }
    }

  } else {
    return NextResponse.json({ error: `Exchange ${exchange} not supported in this debug route` }, { status: 400 })
  }

  return NextResponse.json(result, { status: 200 })
}
