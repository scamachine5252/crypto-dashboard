import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params       = req.nextUrl.searchParams
  const account_id   = params.get('account_id')
  const acknowledged = params.get('acknowledged')

  let query = supabaseAdmin
    .from('risk_alerts')
    .select('id, account_id, rule_type, current_value, alert_threshold, kill_threshold, severity, acknowledged, fired_at')
    .order('fired_at', { ascending: false })
    .limit(200)

  if (account_id)        query = query.eq('account_id', account_id)
  if (acknowledged !== null) query = query.eq('acknowledged', acknowledged === 'true')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerts: data ?? [] })
}
