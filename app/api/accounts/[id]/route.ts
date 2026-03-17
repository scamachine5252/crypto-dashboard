import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'

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
