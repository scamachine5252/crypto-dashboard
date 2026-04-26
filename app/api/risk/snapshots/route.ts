import 'server-only'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin
    .from('risk_metric_snapshots')
    .select('account_id, rule_type, current_value, evaluated_at')
    .order('account_id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ snapshots: data ?? [] })
}
