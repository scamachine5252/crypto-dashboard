import 'server-only'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Returns a 401 response if the request does not carry the correct DEBUG_SECRET header.
 * Returns null when the request is authorized.
 *
 * Set DEBUG_SECRET in .env.local (any strong random string).
 * Usage:  const deny = requireDebugAuth(req); if (deny) return deny;
 */
export function requireDebugAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.DEBUG_SECRET
  if (!secret) {
    // If DEBUG_SECRET is not set, block all access in production; allow in development.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'DEBUG_SECRET not configured' }, { status: 401 })
    }
    return null
  }
  const provided = req.headers.get('x-debug-secret') ?? req.nextUrl.searchParams.get('debug_secret')
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
