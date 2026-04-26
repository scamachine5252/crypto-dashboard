import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

const VALID_RULE_TYPES = [
  'position_size', 'max_drawdown', 'max_positions',
  'max_unrealized_pnl_per_position', 'max_net_position_instrument', 'max_net_position_account',
  'leverage', 'margin_utilization', 'min_liq_distance',
] as const

export async function GET(req: NextRequest): Promise<NextResponse> {
  const account_id = req.nextUrl.searchParams.get('account_id')

  let query = supabaseAdmin
    .from('risk_rules')
    .select('id, account_id, rule_type, alert_threshold, kill_threshold, enabled, created_at, updated_at')
    .order('account_id')
    .order('rule_type')

  if (account_id) query = query.eq('account_id', account_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data ?? [] })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as {
    account_id: string; rule_type: string; alert_threshold: number
    kill_threshold?: number | null; enabled?: boolean
  }
  const { account_id, rule_type, alert_threshold, kill_threshold, enabled } = body

  if (!account_id || !rule_type || alert_threshold === undefined)
    return NextResponse.json({ error: 'account_id, rule_type, alert_threshold required' }, { status: 400 })

  if (!VALID_RULE_TYPES.includes(rule_type as typeof VALID_RULE_TYPES[number]))
    return NextResponse.json({ error: 'invalid rule_type' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('risk_rules')
    .upsert(
      {
        account_id, rule_type, alert_threshold,
        kill_threshold: kill_threshold ?? null,
        enabled: enabled ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,rule_type' },
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data })
}
