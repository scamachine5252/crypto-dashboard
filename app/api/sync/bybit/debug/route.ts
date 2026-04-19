import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import * as ccxt from 'ccxt'

/**
 * POST /api/sync/bybit/debug
 * Diagnostic endpoint: calls privateGetV5ExecutionList directly and returns
 * the raw first page so we can see exact field values (execPnl, closedSize, execType).
 *
 * Body: { account_id: string, category?: 'linear'|'inverse', days_ago?: number }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body      = await req.json() as Record<string, unknown>
  const accountId = body.account_id as string | undefined
  const category  = (body.category as string | undefined) ?? 'linear'
  const daysAgo   = typeof body.days_ago === 'number' ? body.days_ago : 7

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id, api_key, api_secret')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const acc = account as Record<string, string>
  const exchange = new ccxt.bybit({
    apiKey: decrypt(acc.api_key),
    secret: decrypt(acc.api_secret),
    options: { defaultType: 'unified' },
  })

  const until = Date.now()
  const since = until - daysAgo * 24 * 60 * 60 * 1000

  // ── Test 1: raw execution list ──────────────────────────────────────────────
  let rawResponse: unknown = null
  let rawError: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawResponse = await (exchange as any).privateGetV5ExecutionList({
      category,
      limit: 10,
      startTime: since,
      endTime:   until,
    })
  } catch (e) {
    rawError = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
  }

  // ── Parse what we got ──────────────────────────────────────────────────────
  const result = (rawResponse as Record<string, unknown>)?.result as Record<string, unknown> | undefined
  const list   = (result?.list ?? []) as Array<Record<string, unknown>>

  const fieldSample = list.slice(0, 3).map(row => ({
    execType:   row['execType'],
    execPnl:    row['execPnl'],
    closedSize: row['closedSize'],
    execQty:    row['execQty'],
    execPrice:  row['execPrice'],
    side:       row['side'],
    symbol:     row['symbol'],
    execTime:   row['execTime'],
  }))

  const execTypeCounts: Record<string, number> = {}
  for (const row of list) {
    const t = String(row['execType'] ?? 'undefined')
    execTypeCounts[t] = (execTypeCounts[t] ?? 0) + 1
  }

  const execPnlValues  = list.map(r => r['execPnl'])
  const nonZeroPnl     = execPnlValues.filter(v => Number(v) !== 0)
  const closedSizeVals = list.map(r => r['closedSize'])

  return NextResponse.json({
    account_id:       accountId,
    category,
    time_window:      { since: new Date(since).toISOString(), until: new Date(until).toISOString(), days_ago: daysAgo },
    api_error:        rawError,
    retCode:          (rawResponse as Record<string, unknown>)?.retCode,
    retMsg:           (rawResponse as Record<string, unknown>)?.retMsg,
    list_count:       list.length,
    next_page_cursor: result?.nextPageCursor,
    exec_type_counts: execTypeCounts,
    exec_pnl_values:  execPnlValues,
    non_zero_pnl_count: nonZeroPnl.length,
    closed_size_values: closedSizeVals,
    field_sample:     fieldSample,
  })
}
