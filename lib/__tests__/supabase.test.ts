// Mock @supabase/supabase-js before any module loads.
// jest.mock is hoisted so the factory runs before imports.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockReturnValue({ from: jest.fn() }),
}))

// ---------------------------------------------------------------------------
// lib/supabase/client.ts
// ---------------------------------------------------------------------------
describe('lib/supabase/client.ts', () => {
  beforeEach(() => {
    // Reset module registry so each test loads a fresh copy of the module,
    // which re-executes the top-level createClient() call.
    jest.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
  })

  it('calls createClient with the correct URL and publishable key', () => {
    require('../supabase/client')
    // Require the mock AFTER the client module has loaded it (same cache entry)
    const { createClient } = require('@supabase/supabase-js')
    expect(createClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-publishable-key',
    )
  })

  it('exports a client that exposes .from()', () => {
    const { supabase } = require('../supabase/client')
    expect(typeof supabase.from).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// lib/supabase/server.ts
// ---------------------------------------------------------------------------
describe('lib/supabase/server.ts', () => {
  beforeEach(() => {
    jest.resetModules()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'test-secret-key'
  })

  it('calls createClient with the correct URL and secret key', () => {
    require('../supabase/server')
    const { createClient } = require('@supabase/supabase-js')
    expect(createClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'test-secret-key',
    )
  })

  it('exports a supabaseAdmin client that exposes .from()', () => {
    const { supabaseAdmin } = require('../supabase/server')
    expect(typeof supabaseAdmin.from).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// accounts table schema
// ---------------------------------------------------------------------------
describe('accounts table schema', () => {
  it('migration 002 contains correct ALTER TABLE statement', () => {
    const fs = require('fs')
    const sql = fs.readFileSync('supabase/migrations/002_add_instrument_to_accounts.sql', 'utf8')
    expect(sql).toContain('ADD COLUMN instrument')
    expect(sql).toContain("DEFAULT 'spot'")
    expect(sql).toContain("'spot', 'futures', 'options'")
  })

  it('migration 003 fixes all column names', () => {
    const fs = require('fs')
    const sql = fs.readFileSync('supabase/migrations/003_fix_column_names.sql', 'utf8')
    expect(sql).toContain('RENAME COLUMN label TO account_name')
    expect(sql).toContain('RENAME COLUMN api_key_encrypted TO api_key')
    expect(sql).toContain('RENAME COLUMN api_secret_encrypted TO api_secret')
    expect(sql).toContain('RENAME COLUMN passphrase_encrypted TO passphrase')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS fund')
  })

  it('migration 004 adds account_id_memo column', () => {
    const fs = require('fs')
    const sql = fs.readFileSync('supabase/migrations/004_add_account_id_memo.sql', 'utf8')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS account_id_memo')
  })

  it('migration 005 adds direction column to trades', () => {
    const fs = require('fs')
    const sql = fs.readFileSync('supabase/migrations/005_add_direction_to_trades.sql', 'utf8')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS direction')
    expect(sql).toContain("'long', 'short', 'unknown'")
  })
})
