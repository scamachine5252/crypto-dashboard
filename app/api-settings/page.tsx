'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AccountConfig, ExchangeId } from '@/lib/types'
import { EXCHANGES } from '@/lib/mock-data'
import {
  loadAllAccountConfigs,
  saveAccountConfig,
  removeAccountConfig,
} from '@/lib/api-key-store'
import Header from '@/components/layout/Header'

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit:   '#FF6B2C',
  okx:     '#4F8EF7',
}

const FUNDS = ['Cicada Foundation']

// Seed the initial list from mock EXCHANGES — one row per sub-account
function buildDefaultAccounts(): AccountConfig[] {
  const rows: AccountConfig[] = []
  for (const ex of EXCHANGES) {
    for (const sa of ex.subAccounts) {
      rows.push({
        id:            sa.id,
        fund:          'Cicada Foundation',
        exchangeId:    ex.id,
        accountName:   sa.name,
        instrument:    '',
        apiKey:        '',
        apiSecret:     '',
        passphrase:    '',
        accountIdMemo: '',
        status:        'not_configured',
      })
    }
  }
  return rows
}

const EMPTY_FORM = {
  fund:          'Cicada Foundation',
  exchangeId:    '' as ExchangeId | '',
  accountName:   '',
  instrument:    '',
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
  const [accounts, setAccounts] = useState<AccountConfig[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [newFundDraft, setNewFundDraft] = useState('')

  // Merge mock defaults with localStorage on mount
  useEffect(() => {
    const saved = loadAllAccountConfigs()
    const savedMap = new Map(saved.map((a) => [a.id, a]))
    const defaults = buildDefaultAccounts().map((d) => savedMap.get(d.id) ?? d)
    // Append any saved accounts that aren't in the defaults (user-created)
    const extraSaved = saved.filter((a) => !defaults.find((d) => d.id === a.id))
    setAccounts([...defaults, ...extraSaved])
  }, [])

  const patch = useCallback((field: keyof typeof EMPTY_FORM, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }, [])

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM)
    setNewFundDraft('')
    setEditingId(null)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!form.exchangeId || !form.accountName.trim()) return
    const resolvedFund = form.fund === '__new__' ? newFundDraft.trim() || 'Cicada Foundation' : form.fund

    if (editingId) {
      // Update existing
      const updated: AccountConfig = {
        id:            editingId,
        fund:          resolvedFund,
        exchangeId:    form.exchangeId as ExchangeId,
        accountName:   form.accountName.trim(),
        instrument:    form.instrument.trim(),
        apiKey:        form.apiKey,
        apiSecret:     form.apiSecret,
        passphrase:    form.passphrase,
        accountIdMemo: form.accountIdMemo,
        status:        'not_configured',
      }
      saveAccountConfig(updated)
      setAccounts((prev) => prev.map((a) => (a.id === editingId ? updated : a)))
      resetForm()
    } else {
      const created: AccountConfig = {
        id:            Date.now().toString(),
        fund:          resolvedFund,
        exchangeId:    form.exchangeId as ExchangeId,
        accountName:   form.accountName.trim(),
        instrument:    form.instrument.trim(),
        apiKey:        form.apiKey,
        apiSecret:     form.apiSecret,
        passphrase:    form.passphrase,
        accountIdMemo: form.accountIdMemo,
        status:        'not_configured',
      }
      saveAccountConfig(created)
      setAccounts((prev) => [...prev, created])
      resetForm()
    }
  }, [form, newFundDraft, editingId, resetForm])

  const handleEdit = useCallback((account: AccountConfig) => {
    setForm({
      fund:          account.fund,
      exchangeId:    account.exchangeId,
      accountName:   account.accountName,
      instrument:    account.instrument,
      apiKey:        account.apiKey,
      apiSecret:     account.apiSecret,
      passphrase:    account.passphrase ?? '',
      accountIdMemo: account.accountIdMemo ?? '',
    })
    setEditingId(account.id)
  }, [])

  const handleRemove = useCallback((id: string) => {
    removeAccountConfig(id)
    setAccounts((prev) => {
      // Restore default row if it was a mock account, otherwise remove entirely
      const defaults = buildDefaultAccounts()
      const defaultRow = defaults.find((d) => d.id === id)
      if (defaultRow) {
        return prev.map((a) => (a.id === id ? defaultRow : a))
      }
      return prev.filter((a) => a.id !== id)
    })
    if (editingId === id) resetForm()
  }, [editingId, resetForm])

  const handleTest = useCallback((id: string) => {
    setTestingId(id)
    setTimeout(() => {
      setAccounts((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a
          const updated = { ...a, status: 'connected' as const }
          saveAccountConfig(updated)
          return updated
        })
      )
      setTestingId(null)
    }, 600)
  }, [])

  const canSubmit = !!form.exchangeId && !!form.accountName.trim()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header totalPnl={0} annualYield={0} />

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

          {/* Instrument */}
          <FieldInput
            label="Exchange Instrument"
            value={form.instrument}
            onChange={(v) => patch('instrument', v)}
            placeholder="e.g. BTCUSDT"
          />

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
            <span
              className="text-[10px] font-bold px-1.5 py-0.5"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', borderRadius: 2 }}
            >
              {accounts.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Account Name', 'Fund', 'Exchange', 'Instrument', 'Status', 'Actions'].map((col) => (
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
                  const exColor = EXCHANGE_COLORS[account.exchangeId] ?? 'var(--text-secondary)'
                  const isTesting = testingId === account.id
                  const isEditing = editingId === account.id

                  const statusColor =
                    account.status === 'connected'     ? 'var(--accent-profit)'
                    : account.status === 'error'       ? 'var(--accent-loss)'
                    : 'var(--text-muted)'

                  const statusLabel =
                    account.status === 'connected'     ? 'Connected'
                    : account.status === 'error'       ? 'Error'
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
                        {account.accountName}
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
                            {account.exchangeId}
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

                      {/* Actions */}
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          {/* Test */}
                          <button
                            onClick={() => handleTest(account.id)}
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
        </div>
      </div>
    </div>
  )
}
