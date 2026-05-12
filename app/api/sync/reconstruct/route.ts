import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { PositionReconstructor } from '@/worker/position-reconstructor'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body      = await req.json() as Record<string, unknown>
  const accountId = body.account_id as string | undefined

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { data: account, error } = await supabaseAdmin
    .from('accounts')
    .select('id, exchange')
    .eq('id', accountId)
    .single()

  if (error || !account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const reconstructor = new PositionReconstructor()
  try {
    await reconstructor.reconstruct(
      (account as Record<string, string>).id,
      (account as Record<string, string>).exchange,
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[reconstruct] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
