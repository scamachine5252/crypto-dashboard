import 'server-only'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

// Returns the earliest trade closed_at date across all accounts.
// Used by the "Inception" period selector to anchor the start of the full history.
export async function GET(): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin
    .from('trades')
    .select('closed_at')
    .not('closed_at', 'is', null)
    .order('closed_at', { ascending: true })
    .limit(1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const date = data?.[0]?.closed_at?.slice(0, 10) ?? null
  return NextResponse.json({ date })
}
