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

  // ── Paginate up to 5 pages to find Trade fills (Funding fills may appear first) ──
  let rawError: string | null = null
  const allRows: Array<Record<string, unknown>> = []
  let cursor: string | undefined

  try {
    for (let page = 0; page < 5; page++) {
      const params: Record<string, unknown> = { category, limit: 100, startTime: since, endTime: until }
      if (cursor) params['cursor'] = cursor
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawResponse = await (exchange as any).privateGetV5ExecutionList(params) as Record<string, unknown>
      const res  = (rawResponse?.result ?? {}) as Record<string, unknown>
      const page_list = (res.list ?? []) as Array<Record<string, unknown>>
      allRows.push(...page_list)
      cursor = res.nextPageCursor as string | undefined
      if (!cursor || page_list.length === 0) break
    }
  } catch (e) {
    rawError = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
  }

  const list = allRows

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
    pages_fetched:    Math.ceil(allRows.length / 100) || (rawError ? 0 : 1),
    list_count:       list.length,
    next_page_cursor: cursor ?? null,
    exec_type_counts: execTypeCounts,
    exec_pnl_values:  execPnlValues,
    non_zero_pnl_count: nonZeroPnl.length,
    closed_size_values: closedSizeVals,
    field_sample:     fieldSample,
  })
}
