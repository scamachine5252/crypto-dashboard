import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto/encrypt'

// ---------------------------------------------------------------------------
// PATCH /api/accounts/[id] — update mutable account fields
// Only updates fields present in the body; api_key/api_secret are optional
// (blank = keep existing encrypted value).
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Check existence
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('accounts')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!existing)  return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const updates: Record<string, unknown> = {}

  if (typeof body.fund         === 'string' && body.fund.trim())         updates.fund         = body.fund.trim()
  if (typeof body.account_name === 'string' && body.account_name.trim()) updates.account_name = body.account_name.trim()
  if (typeof body.account_id_memo === 'string') updates.account_id_memo = body.account_id_memo.trim() || null
  if (typeof body.kill_switch_enabled === 'boolean') updates.kill_switch_enabled = body.kill_switch_enabled

  const aumRaw = body.initial_aum
  if (aumRaw !== undefined) {
    const n = Number(aumRaw)
    updates.initial_aum = n > 0 ? n : null
  }

  // Keys are optional — only update if non-empty strings provided
  if (typeof body.api_key    === 'string' && body.api_key.trim())    updates.api_key    = encrypt(body.api_key.trim())
  if (typeof body.api_secret === 'string' && body.api_secret.trim()) updates.api_secret = encrypt(body.api_secret.trim())
  if (typeof body.passphrase === 'string' && body.passphrase.trim()) updates.passphrase = encrypt(body.passphrase.trim())

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const row = data as Record<string, unknown>
  const { api_key: _k, api_secret: _s, passphrase: _p, ...safe } = row
  return NextResponse.json(safe, { status: 200 })
}

// ---------------------------------------------------------------------------
// DELETE /api/accounts/[id] — remove an exchange account
// ---------------------------------------------------------------------------
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  // Check existence first
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('accounts')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const { error: deleteError } = await supabaseAdmin
    .from('accounts')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 200 })
}
