import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { requireDebugAuth } from '@/lib/debug-auth'
import * as ccxt from 'ccxt'

/**
 * POST /api/debug/internal-transfers
 * Checks Bybit internal (sub-account) transfers for an account.
 * These do NOT appear in the regular deposit endpoint.
 * Requires x-debug-secret header matching DEBUG_SECRET env var.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const deny = requireDebugAuth(req)
  if (deny) return deny

  const body      = await req.json() as Record<string, unknown>
  const accountId = body.account_id as string | undefined
  const daysAgo   = typeof body.days_ago === 'number' ? body.days_ago : 30

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error } = await supabaseAdmin
    .from('accounts')
    .select('id, account_name, exchange, api_key, api_secret')
    .eq('id', accountId)
    .single()

  if (error || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const acc = account as Record<string, string>
  if (acc.exchange !== 'bybit') {
    return NextResponse.json({ error: 'Bybit only' }, { status: 400 })
  }

  const until = Date.now()
  const since = until - daysAgo * 24 * 60 * 60 * 1000

  const ex = new ccxt.bybit({
    apiKey: decrypt(acc.api_key),
    secret: decrypt(acc.api_secret),
    options: { defaultType: 'unified' },
  })

  const result: Record<string, unknown> = {
    account_name: acc.account_name,
    window: { since: new Date(since).toISOString(), until: new Date(until).toISOString() },
  }

  // Universal transfer history (between accounts/wallets)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (ex as any).privateGetV5AssetTransferQueryUniversalTransferList({
      startTime: since,
      endTime:   until,
      limit:     50,
    }) as Record<string, unknown>
    const res  = (raw?.result ?? {}) as Record<string, unknown>
    const list = (res.list ?? []) as Array<Record<string, unknown>>
    result['universal_transfers'] = {
      ok:    true,
      count: list.length,
      sample: list.slice(0, 5).map(t => ({
        transferId: t['transferId'],
        coin:       t['coin'],
        amount:     t['amount'],
        fromMember: t['fromMemberId'],
        toMember:   t['toMemberId'],
        fromAccount: t['fromAccountType'],
        toAccount:   t['toAccountType'],
        status:     t['status'],
        timestamp:  t['timestamp'],
      })),
    }
  } catch (e) {
    result['universal_transfers'] = { ok: false, error: String(e) }
  }

  // Internal transfer history (within same UID, between account types)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (ex as any).privateGetV5AssetTransferQueryInterTransferList({
      startTime: since,
      endTime:   until,
      limit:     50,
    }) as Record<string, unknown>
    const res  = (raw?.result ?? {}) as Record<string, unknown>
    const list = (res.list ?? []) as Array<Record<string, unknown>>
    result['inter_transfers'] = {
      ok:    true,
      count: list.length,
      sample: list.slice(0, 5).map(t => ({
        transferId:  t['transferId'],
        coin:        t['coin'],
        amount:      t['amount'],
        fromAccount: t['fromAccountType'],
        toAccount:   t['toAccountType'],
        status:      t['status'],
        timestamp:   t['timestamp'],
      })),
    }
  } catch (e) {
    result['inter_transfers'] = { ok: false, error: String(e) }
  }

  // Sub-account transfer history (master → sub or sub → master)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (ex as any).privateGetV5AssetTransferQuerySubMemberTransferList({
      startTime: since,
      endTime:   until,
      limit:     50,
    }) as Record<string, unknown>
    const res  = (raw?.result ?? {}) as Record<string, unknown>
    const list = (res.list ?? []) as Array<Record<string, unknown>>
    result['sub_transfers'] = {
      ok:    true,
      count: list.length,
      sample: list.slice(0, 5).map(t => ({
        transferId:  t['transferId'],
        coin:        t['coin'],
        amount:      t['amount'],
        fromMember:  t['fromMemberId'],
        toMember:    t['toMemberId'],
        status:      t['status'],
        timestamp:   t['timestamp'],
      })),
    }
  } catch (e) {
    result['sub_transfers'] = { ok: false, error: String(e) }
  }

  return NextResponse.json(result)
}
