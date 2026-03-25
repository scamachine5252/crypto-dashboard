'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ExchangeId } from '@/lib/types'
import Header from '@/components/layout/Header'

// ---------------------------------------------------------------------------
// Types for API responses (snake_case, no sensitive fields)
// ---------------------------------------------------------------------------
interface AccountRow {
  id: string
  fund: string
  exchange: ExchangeId
  account_name: string
  instrument: string
  account_id_memo?: string
  last_full_sync_at?: string | null        // populated after a full Binance history scan
  full_sync_failed_count?: number | null   // symbols that failed during last full scan
  status: 'connected' | 'error' | 'not_configured'
  passphrase?: never       // never returned by API
  api_key?: never          // never returned by API
  api_secret?: never       // never returned by API
}

// Maps raw error messages / network failures to short user-facing labels
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('err_network') || lower.includes('network changed')) return 'Network error — try again'
  if (lower.includes('aborted') || lower.includes('abort')) return 'Request cancelled'
  if (lower.includes('invalid api') || lower.includes('authentication') || lower.includes('unauthorized') || lower.includes('401')) return 'Invalid API key'
  if (lower.includes('permission') || lower.includes('forbidden') || lower.includes('403')) return 'No API permission'
  if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('429')) return 'Rate limit — wait'
  if (lower.includes('timeout') || lower.includes('timed out')) return 'Request timed out'
  if (lower.includes('markets')) return 'Markets load failed'
  if (lower.includes('chunks')) return 'Chunks load failed'
  if (lower.includes('500') || lower.includes('internal server')) return 'Server error — retry'
  if (lower.includes('404') || lower.includes('not found')) return 'Account not found'
  if (lower.includes('failed to load accounts') || lower.includes('failed to load')) return 'Load failed — retry'
  return 'Error — try again'
}

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit:   '#FF6B2C',
  okx:     '#4F8EF7',
}

const FUNDS = ['Cicada Foundation']

const EMPTY_FORM = {
  fund:          'Cicada Foundation',
  exchangeId:    '' as ExchangeId | '',
  accountName:   '',
  instrument:    'unified',   // account type: unified | spot | futures | options
  apiKey:        '',
  apiSecret:     '',
  passphrase:    '',
  accountIdMemo: '',
}

// Shared input style
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-medium)',
  color: 'var(--text-primary)',
  fontSize: 12,
  padding: '6px 10px',
  outline: 'none',
  borderRadius: 2,
}

function FieldInput({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  optional,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  optional?: boolean
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label
        className="block text-[10px] uppercase tracking-widest mb-1"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
        {optional && <span className="ml-1 normal-case" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>(optional)</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          ...inputStyle,
          borderColor: focused ? 'var(--accent-profit)' : 'var(--border-medium)',
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  )
}

function FieldSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label
        className="block text-[10px] uppercase tracking-widest mb-1"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...inputStyle,
          borderColor: focused ? 'var(--accent-profit)' : 'var(--border-medium)',
          appearance: 'none',
          cursor: 'pointer',
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {children}
      </select>
    </div>
  )
}

export default function ApiSettingsPage() {
  const [accounts, setAccounts]     = useState<AccountRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [testingId, setTestingId]   = useState<string | null>(null)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [newFundDraft, setNewFundDraft] = useState('')

  type ScanEntry = { current: number; total: number; failed: { symbol: string; error: string }[]; completed?: boolean; isError?: boolean; errorMsg?: string }
  const [scanState, setScanState] = useState<Record<string, ScanEntry>>({})


  // ---------------------------------------------------------------------------
  // Load accounts from API on mount
  // ---------------------------------------------------------------------------
  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed to load accounts')
      const data = (await res.json()) as AccountRow[]
      setAccounts(data)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  // ---------------------------------------------------------------------------
  // Full history scan — exchange-aware chunked sync
  // Binance: iterates symbol chunks (shows symbol progress)
  // Bybit/OKX: iterates 30-day time chunks (shows chunk progress)
  // ---------------------------------------------------------------------------
  const handleFullScan = useCallback(async (accountId: string, exchange: string) => {
    setScanState((prev) => ({ ...prev, [accountId]: { current: 0, total: 0, failed: [] } }))

    try {
      const allFailed: { symbol: string; error: string }[] = []

      if (exchange === 'binance') {
        // Binance: symbol-based chunking.
        // Markets route returns the full sorted symbol arrays once — chunk slicing
        // happens here so the full route never needs to call loadMarkets() itself.
        const marketsRes = await fetch(`/api/sync/binance/markets?account_id=${accountId}`)
        if (!marketsRes.ok) throw new Error('Failed to load markets')
        const { spotSymbols, futuresSymbols, totalSymbols } = (await marketsRes.json()) as {
          spotSymbols: string[]; futuresSymbols: string[]
          totalSymbols: number; spotChunks: number; totalChunks: number; chunkSize: number
        }

        const CHUNK = 50
        const allSymbols = [...spotSymbols, ...futuresSymbols]
        const chunks: string[][] = []
        for (let i = 0; i < allSymbols.length; i += CHUNK) {
          chunks.push(allSymbols.slice(i, i + CHUNK))
        }

        setScanState((prev) => ({
          ...prev,
          [accountId]: { current: 0, total: totalSymbols, failed: [] },
        }))

        for (let i = 0; i < chunks.length; i++) {
          const res = await fetch('/api/sync/binance/full', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id: accountId, symbols: chunks[i] }),
          })
          if (res.ok) {
            const data = (await res.json()) as {
              synced: number; failedSymbols: { symbol: string; error: string }[]
            }
            allFailed.push(...data.failedSymbols)
          }
          const symbolsDone = Math.min((i + 1) * CHUNK, totalSymbols)
          setScanState((prev) => ({
            ...prev,
            [accountId]: { current: symbolsDone, total: totalSymbols, failed: allFailed },
          }))
        }

        await fetch('/api/sync/binance/full', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accountId, failed_count: allFailed.length }),
        })

        setScanState((prev) => ({
          ...prev,
          [accountId]: { current: totalSymbols, total: totalSymbols, failed: allFailed, completed: true },
        }))
      } else {
        // Bybit / OKX: time-based chunking (6 × 30-day windows)
        const chunksRes = await fetch(`/api/sync/${exchange}/chunks`)
        if (!chunksRes.ok) throw new Error('Failed to load chunks')
        const { totalChunks } = (await chunksRes.json()) as { totalChunks: number }

        setScanState((prev) => ({
          ...prev,
          [accountId]: { current: 0, total: totalChunks, failed: [] },
        }))

        for (let i = 0; i < totalChunks; i++) {
          const res = await fetch(`/api/sync/${exchange}/full`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id: accountId, chunk_index: i }),
          })
          if (res.ok) {
            const data = (await res.json()) as {
              synced: number
              failedCategories?: { symbol: string; error: string }[]
            }
            allFailed.push(...(data.failedCategories ?? []))
          }
          setScanState((prev) => ({
            ...prev,
            [accountId]: { current: i + 1, total: totalChunks, failed: allFailed },
          }))
        }

        await fetch(`/api/sync/${exchange}/full`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accountId, failed_count: allFailed.length }),
        })

        setScanState((prev) => ({
          ...prev,
          [accountId]: { current: totalChunks, total: totalChunks, failed: allFailed, completed: true },
        }))
      }

      await fetchAccounts()
    } catch (err) {
      setScanState((prev) => ({ ...prev, [accountId]: { current: 0, total: 0, failed: [], isError: true, errorMsg: friendlyError(err) } }))
    }
  }, [fetchAccounts])

  const patch = useCallback((field: keyof typeof EMPTY_FORM, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }, [])

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM)
    setNewFundDraft('')
    setEditingId(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Create / update account via POST
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (!form.exchangeId || !form.accountName.trim()) return
    const resolvedFund = form.fund === '__new__' ? newFundDraft.trim() || 'Cicada Foundation' : form.fund

    const payload = {
      fund:          resolvedFund,
      exchange:      form.exchangeId.toLowerCase(),
      account_name:  form.accountName.trim(),
      instrument:    form.instrument,
      api_key:       form.apiKey,
      api_secret:    form.apiSecret,
      ...(form.passphrase    ? { passphrase:       form.passphrase }          : {}),
      ...(form.accountIdMemo ? { account_id_memo:  form.accountIdMemo.trim() } : {}),
    }

    try {
      const res = await fetch('/api/accounts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(friendlyError(new Error(json.error ?? 'Failed to create account')))
        return
      }
      const json = await res.json() as { id?: string }
      resetForm()
      await fetchAccounts()
      if (json.id) {
        handleFullScan(json.id, form.exchangeId)
      }
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [form, newFundDraft, resetForm, fetchAccounts, handleFullScan])

  // ---------------------------------------------------------------------------
  // Edit — populate form (no API call needed, data is already loaded)
  // ---------------------------------------------------------------------------
  const handleEdit = useCallback((account: AccountRow) => {
    setForm({
      fund:          account.fund,
      exchangeId:    account.exchange,
      accountName:   account.account_name,
      instrument:    account.instrument,
      apiKey:        '',
      apiSecret:     '',
      passphrase:    '',
      accountIdMemo: account.account_id_memo ?? '',
    })
    setEditingId(account.id)
  }, [])

  // ---------------------------------------------------------------------------
  // Delete account via DELETE /api/accounts/[id]
  // ---------------------------------------------------------------------------
  const handleRemove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(friendlyError(new Error(json.error ?? 'Failed to remove account')))
        return
      }
      if (editingId === id) resetForm()
      await fetchAccounts()
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [editingId, resetForm, fetchAccounts])

  // ---------------------------------------------------------------------------
  // Test connection — real ping via /api/exchanges/[exchange]/ping
  // ---------------------------------------------------------------------------
  const handleTest = useCallback(async (account: AccountRow) => {
    setTestingId(account.id)
    try {
      const res = await fetch(`/api/exchanges/${account.exchange}/ping`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ account_id: account.id }),
      })
      const json = await res.json() as { connected?: boolean }
      const status: AccountRow['status'] = json.connected ? 'connected' : 'error'
      setAccounts((prev) => prev.map((a) => a.id === account.id ? { ...a, status } : a))
    } catch {
      setAccounts((prev) => prev.map((a) => a.id === account.id ? { ...a, status: 'error' as const } : a))
    } finally {
      setTestingId(null)
    }
  }, [])

  const canSubmit = !!form.exchangeId && !!form.accountName.trim()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Two-column body */}
      <div className="flex gap-6 px-6 py-5 flex-1 items-start">

        {/* LEFT — Create Account form */}
        <div
          className="shrink-0 flex flex-col gap-4 p-4"
          style={{
            width: 280,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-primary)' }}>
            {editingId ? 'Edit Account' : 'Create Account'}
          </p>

          {/* Fund */}
          {form.fund === '__new__' ? (
            <div>
              <FieldInput
                label="Fund"
                value={newFundDraft}
                onChange={setNewFundDraft}
                placeholder="Enter fund name"
              />
              <button
                onClick={() => { patch('fund', 'Cicada Foundation'); setNewFundDraft('') }}
                className="mt-1 text-[10px] transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <FieldSelect label="Fund" value={form.fund} onChange={(v) => patch('fund', v)}>
              {FUNDS.map((f) => <option key={f} value={f}>{f}</option>)}
              <option value="__new__">+ Add new fund</option>
            </FieldSelect>
          )}

          {/* Exchange */}
          <FieldSelect label="Exchange" value={form.exchangeId} onChange={(v) => patch('exchangeId', v)}>
            <option value="">Choose exchange</option>
            <option value="binance">Binance</option>
            <option value="bybit">Bybit</option>
            <option value="okx">OKX</option>
          </FieldSelect>

          {/* Account Name */}
          <FieldInput
            label="Account Name"
            value={form.accountName}
            onChange={(v) => patch('accountName', v)}
            placeholder="e.g. Alpha Fund"
          />

          {/* Account Type */}
          <FieldSelect label="Account Type" value={form.instrument} onChange={(v) => patch('instrument', v)}>
            <option value="unified">Unified</option>
            <option value="portfolio_margin">Portfolio Margin</option>
            <option value="spot">Spot</option>
            <option value="futures">Futures</option>
            <option value="options">Options</option>
          </FieldSelect>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

          {/* Public Key */}
          <FieldInput
            label="Public Key (API Key)"
            type="password"
            value={form.apiKey}
            onChange={(v) => patch('apiKey', v)}
            placeholder="Enter API key"
          />

          {/* Secret Key */}
          <FieldInput
            label="Secret Key"
            type="password"
            value={form.apiSecret}
            onChange={(v) => patch('apiSecret', v)}
            placeholder="Enter secret key"
          />

          {/* PassPhrase */}
          <FieldInput
            label="PassPhrase (Password)"
            type="password"
            value={form.passphrase}
            onChange={(v) => patch('passphrase', v)}
            placeholder="Enter passphrase"
          />

          {/* AccountID / Memo */}
          <FieldInput
            label="AccountID / Memo"
            value={form.accountIdMemo}
            onChange={(v) => patch('accountIdMemo', v)}
            placeholder="Optional"
            optional
          />

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-2 text-xs font-bold uppercase tracking-widest transition-opacity"
            style={{
              background: canSubmit ? 'var(--accent-profit)' : 'var(--border-medium)',
              color: canSubmit ? '#000' : 'var(--text-muted)',
              borderRadius: 2,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {editingId ? 'Save Changes' : 'Create Account'}
          </button>

          {editingId && (
            <button
              onClick={resetForm}
              className="text-[10px] text-center transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
            >
              Cancel edit
            </button>
          )}
        </div>

        {/* RIGHT — Accounts list */}
        <div
          className="flex-1 overflow-hidden"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {/* Table header */}
          <div
            className="px-5 py-3 flex items-center gap-3"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Accounts
            </p>
            {!loading && !error && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', borderRadius: 2 }}
              >
                {accounts.length}
              </span>
            )}
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div data-testid="accounts-loading" className="p-5 flex flex-col gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 rounded animate-pulse"
                  style={{ background: 'var(--bg-elevated)' }}
                />
              ))}
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div data-testid="accounts-error" className="p-5">
              <p className="text-xs" style={{ color: 'var(--accent-loss)' }}>{error}</p>
              <button
                onClick={fetchAccounts}
                className="mt-2 text-[10px] underline"
                style={{ color: 'var(--text-muted)' }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && accounts.length === 0 && (
            <div className="p-5">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No accounts configured yet.</p>
            </div>
          )}

          {/* Accounts table */}
          {!loading && !error && accounts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {['Account Name', 'Fund', 'Exchange', 'Instrument', 'Status', 'Last Synced', 'Actions'].map((col) => (
                      <th
                        key={col}
                        className="px-5 py-2.5 text-left font-medium whitespace-nowrap"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => {
                    const exColor  = EXCHANGE_COLORS[account.exchange] ?? 'var(--text-secondary)'
                    const isTesting = testingId === account.id
                    const isEditing = editingId === account.id

                    const statusColor =
                      account.status === 'connected' ? 'var(--accent-profit)'
                      : account.status === 'error'   ? 'var(--accent-loss)'
                      : 'var(--text-muted)'

                    const statusLabel =
                      account.status === 'connected' ? 'Connected'
                      : account.status === 'error'   ? 'Error'
                      : 'Not configured'

                    return (
                      <tr
                        key={account.id}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          background: isEditing ? 'rgba(0,255,136,0.04)' : 'transparent',
                        }}
                        onMouseEnter={(e) => {
                          if (!isEditing) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background = isEditing ? 'rgba(0,255,136,0.04)' : 'transparent'
                        }}
                      >
                        {/* Account Name */}
                        <td className="px-5 py-2.5 whitespace-nowrap font-medium" style={{ color: 'var(--text-primary)' }}>
                          {account.account_name}
                        </td>

                        {/* Fund */}
                        <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                          {account.fund}
                        </td>

                        {/* Exchange */}
                        <td className="px-5 py-2.5 whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: exColor }} />
                            <span className="capitalize font-medium" style={{ color: exColor }}>
                              {account.exchange}
                            </span>
                          </span>
                        </td>

                        {/* Instrument */}
                        <td className="px-5 py-2.5 whitespace-nowrap">
                          {account.instrument ? (
                            <span
                              className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                              style={{
                                background: 'var(--bg-elevated)',
                                color: 'var(--accent-blue)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 2,
                              }}
                            >
                              {account.instrument}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--border-medium)' }}>—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-5 py-2.5 whitespace-nowrap">
                          <span className="flex items-center gap-1.5" style={{ color: statusColor }}>
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor }} />
                            {statusLabel}
                          </span>
                        </td>

                        {/* Last Synced */}
                        <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)' }}>
                          {(() => {
                            const state = scanState[account.id]
                            if (state && !state.completed && !state.isError) {
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 10 }}>
                                    ⟳ {state.current} / {state.total}
                                  </span>
                                  <div style={{ width: 100, height: 3, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                                    <div style={{
                                      height: '100%',
                                      background: 'var(--accent-profit)',
                                      width: state.total > 0 ? `${(state.current / state.total) * 100}%` : '0%',
                                      transition: 'width 0.3s ease',
                                    }} />
                                  </div>
                                  {state.failed.length > 0 && (
                                    <span style={{ color: 'var(--accent-loss)', fontSize: 10 }}>
                                      ⚠ {state.failed.length} failed
                                    </span>
                                  )}
                                </div>
                              )
                            }
                            if (state?.completed) return (
                              <span style={{ color: state.failed.length > 0 ? 'var(--accent-gold)' : 'var(--accent-profit)' }}>
                                {state.failed.length > 0 ? `✓ Done · ⚠ ${state.failed.length} failed` : '✓ Done'}
                              </span>
                            )
                            if (state?.isError) return <span style={{ color: 'var(--accent-loss)' }}>{state.errorMsg ?? 'Error — try again'}</span>
                            if (account.last_full_sync_at) {
                              const failedCount = account.full_sync_failed_count ?? 0
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <span style={{ color: 'var(--text-muted)' }}>
                                    {new Date(account.last_full_sync_at).toLocaleDateString()}
                                  </span>
                                  {failedCount > 0 && (
                                    <span style={{ color: 'var(--accent-gold)', fontSize: 10 }}>
                                      ⚠ {failedCount} failed
                                    </span>
                                  )}
                                </div>
                              )
                            }
                            return <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>Never</span>
                          })()}
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-2.5 whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            {/* Full History — all exchanges */}
                            {(!scanState[account.id] || scanState[account.id].isError || scanState[account.id].completed) && (
                              <button
                                onClick={() => handleFullScan(account.id, account.exchange)}
                                style={{
                                  fontSize: 10,
                                  padding: '3px 8px',
                                  border: '1px solid var(--border-medium)',
                                  background: 'transparent',
                                  color: 'var(--accent-blue)',
                                  cursor: 'pointer',
                                  letterSpacing: '0.05em',
                                }}
                              >
                                FULL HISTORY
                              </button>
                            )}

                            {/* Test */}
                            <button
                              onClick={() => handleTest(account)}
                              disabled={isTesting}
                              className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
                              style={{
                                border: '1px solid var(--accent-blue)',
                                color: 'var(--accent-blue)',
                                borderRadius: 2,
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(45,111,255,0.08)' }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                            >
                              {isTesting ? '…' : 'Test'}
                            </button>

                            {/* Edit */}
                            <button
                              onClick={() => handleEdit(account)}
                              className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                              style={{
                                border: '1px solid var(--border-medium)',
                                color: 'var(--text-secondary)',
                                borderRadius: 2,
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-secondary)' }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-medium)' }}
                            >
                              Edit
                            </button>

                            {/* Remove */}
                            <button
                              onClick={() => handleRemove(account.id)}
                              className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                              style={{
                                border: '1px solid var(--accent-loss)',
                                color: 'var(--accent-loss)',
                                borderRadius: 2,
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,59,59,0.08)' }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                            >
                              Remove
                            </button>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
