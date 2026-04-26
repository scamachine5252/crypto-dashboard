'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import type { RiskRule, RiskAlert, RuleType } from '@/lib/risk/types'

const RULE_TYPES: { value: RuleType; label: string; unit: string; description: string }[] = [
  { value: 'position_size',                   label: 'Max Position Size',          unit: 'USD',   description: 'Largest single position notional' },
  { value: 'max_drawdown',                    label: 'Max Drawdown',               unit: '%',     description: 'Drop from all-time-high balance' },
  { value: 'max_positions',                   label: 'Max Open Positions',         unit: 'count', description: 'Total open positions count' },
  { value: 'max_unrealized_pnl_per_position', label: 'Max Unrealized Loss',        unit: 'USD',   description: 'Worst single-position unrealized loss' },
  { value: 'max_net_position_instrument',     label: 'Max Net Exposure (Symbol)',  unit: 'USD',   description: 'Net long−short notional per symbol' },
  { value: 'max_net_position_account',        label: 'Max Net Exposure (Account)', unit: 'USD',   description: 'Total net long−short notional' },
]

type AccountRow = { id: string; account_name: string; exchange: string; fund: string }
type RuleFormState = { alert: string; kill: string; enabled: boolean }

export default function RiskManagementPage() {
  const [tab, setTab]               = useState<'settings' | 'alerts'>('settings')
  const [accounts, setAccounts]     = useState<AccountRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rules, setRules]           = useState<RiskRule[]>([])
  const [alerts, setAlerts]         = useState<RiskAlert[]>([])
  const [form, setForm]             = useState<Record<RuleType, RuleFormState>>(
    () => Object.fromEntries(RULE_TYPES.map(r => [r.value, { alert: '', kill: '', enabled: false }])) as Record<RuleType, RuleFormState>
  )
  const [saving, setSaving]         = useState(false)
  const [saveMsg, setSaveMsg]       = useState<string | null>(null)
  const [alertFilter, setAlertFilter] = useState<'all' | 'unread' | 'critical'>('unread')

  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then((d: AccountRow[] | { accounts?: AccountRow[] }) => {
        const accs = Array.isArray(d) ? d : (d.accounts ?? [])
        setAccounts(accs)
        if (accs.length > 0) setSelectedId(accs[0].id)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedId) return
    fetch(`/api/risk/rules?account_id=${selectedId}`)
      .then(r => r.json())
      .then((d: { rules?: RiskRule[] }) => {
        const loaded = d.rules ?? []
        setRules(loaded)
        const next = { ...form }
        for (const rt of RULE_TYPES) {
          const existing = loaded.find(r => r.rule_type === rt.value)
          next[rt.value] = existing
            ? { alert: String(existing.alert_threshold), kill: existing.kill_threshold != null ? String(existing.kill_threshold) : '', enabled: existing.enabled }
            : { alert: '', kill: '', enabled: false }
        }
        setForm(next)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const loadAlerts = useCallback(() => {
    fetch('/api/risk/alerts?acknowledged=false')
      .then(r => r.json())
      .then((d: { alerts?: RiskAlert[] }) => setAlerts(d.alerts ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadAlerts() }, [loadAlerts])

  const handleSave = async () => {
    if (!selectedId) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await Promise.all(RULE_TYPES.map(rt => {
        const f = form[rt.value]
        if (f.enabled && f.alert) {
          return fetch('/api/risk/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_id: selectedId, rule_type: rt.value,
              alert_threshold: Number(f.alert),
              kill_threshold: f.kill ? Number(f.kill) : null,
              enabled: true,
            }),
          })
        }
        const existing = rules.find(r => r.rule_type === rt.value)
        if (existing) {
          return fetch('/api/risk/rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              account_id: selectedId, rule_type: rt.value,
              alert_threshold: existing.alert_threshold,
              kill_threshold: existing.kill_threshold,
              enabled: false,
            }),
          })
        }
        return Promise.resolve()
      }))
      setSaveMsg('Saved')
    } catch {
      setSaveMsg('Error saving')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 2500)
    }
  }

  const handleAcknowledge = async (id: string) => {
    const res = await fetch(`/api/risk/alerts/${id}/acknowledge`, { method: 'PATCH' })
    if (res.ok) setAlerts(prev => prev.filter(a => a.id !== id))
  }

  const visibleAlerts = alerts.filter(a => {
    if (alertFilter === 'unread')   return !a.acknowledged
    if (alertFilter === 'critical') return a.severity === 'critical'
    return true
  })
  const unreadCount = alerts.filter(a => !a.acknowledged).length

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      <div
        className="px-4 flex items-center"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        {(['settings', 'alerts'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-5 py-3 text-xs font-semibold uppercase tracking-widest transition-colors"
            style={{
              color:        tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--accent-profit)' : '2px solid transparent',
            }}
          >
            {t === 'alerts' && unreadCount > 0 ? `Alerts (${unreadCount})` : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <main className="flex-1 p-4 max-w-5xl w-full mx-auto">
        {tab === 'settings' && (
          <div className="flex gap-4">
            <div style={{ width: 200, flexShrink: 0 }}>
              <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Account</p>
              <div style={{ border: '1px solid var(--border-subtle)' }}>
                {accounts.map(acc => (
                  <button
                    key={acc.id}
                    onClick={() => setSelectedId(acc.id)}
                    className="w-full px-3 py-2.5 text-left text-xs transition-colors"
                    style={{
                      background:   selectedId === acc.id ? 'var(--bg-elevated)' : 'var(--bg-secondary)',
                      color:        selectedId === acc.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div className="font-semibold">{acc.account_name}</div>
                    <div className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>{acc.exchange}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1" style={{ border: '1px solid var(--border-subtle)' }}>
              <div
                className="px-4 py-2.5 flex items-center justify-between"
                style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
              >
                <p className="text-xs font-semibold tracking-wide font-heading" style={{ color: 'var(--text-primary)' }}>Risk Rules</p>
                <div className="flex items-center gap-2">
                  {saveMsg && (
                    <span className="text-xs" style={{ color: saveMsg === 'Saved' ? 'var(--accent-profit)' : 'var(--accent-loss)' }}>
                      {saveMsg}
                    </span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || !selectedId}
                    className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
                    style={{ background: 'var(--accent-profit)', color: '#000', opacity: saving ? 0.6 : 1 }}
                  >
                    {saving ? 'Saving…' : 'Save Rules'}
                  </button>
                </div>
              </div>

              {RULE_TYPES.map(rt => {
                const f = form[rt.value]
                const setF = (patch: Partial<RuleFormState>) =>
                  setForm(prev => ({ ...prev, [rt.value]: { ...prev[rt.value], ...patch } }))
                return (
                  <div
                    key={rt.value}
                    className="px-4 py-3 flex items-center gap-4"
                    style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', opacity: f.enabled ? 1 : 0.5 }}
                  >
                    <input
                      type="checkbox" checked={f.enabled} onChange={e => setF({ enabled: e.target.checked })}
                      className="cursor-pointer" style={{ accentColor: 'var(--accent-profit)', width: 14, height: 14 }}
                    />
                    <div style={{ width: 220, flexShrink: 0 }}>
                      <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{rt.label}</div>
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{rt.description}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase" style={{ color: 'var(--text-muted)', width: 36 }}>Alert</span>
                      <input
                        type="number" placeholder="—" value={f.alert} onChange={e => setF({ alert: e.target.value })}
                        disabled={!f.enabled} className="px-2 py-1 text-xs font-mono text-right"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', width: 90 }}
                      />
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)', width: 36 }}>{rt.unit}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase" style={{ color: 'var(--accent-loss)', width: 36 }}>Kill</span>
                      <input
                        type="number" placeholder="—" value={f.kill} onChange={e => setF({ kill: e.target.value })}
                        disabled={!f.enabled} className="px-2 py-1 text-xs font-mono text-right"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,59,59,0.4)', color: 'var(--text-primary)', width: 90 }}
                      />
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)', width: 36 }}>{rt.unit}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'alerts' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              {(['unread', 'critical', 'all'] as const).map(f => (
                <button
                  key={f} onClick={() => setAlertFilter(f)}
                  className="px-3 py-1 text-[10px] uppercase tracking-wider font-semibold"
                  style={{
                    background: alertFilter === f ? 'var(--bg-elevated)' : 'transparent',
                    color:      alertFilter === f ? 'var(--text-primary)' : 'var(--text-muted)',
                    border:     '1px solid var(--border-subtle)',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>

            {visibleAlerts.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                No alerts
              </div>
            ) : (
              <div style={{ border: '1px solid var(--border-subtle)' }}>
                {visibleAlerts.map(alert => {
                  const ruleLabel  = RULE_TYPES.find(r => r.value === alert.rule_type)?.label ?? alert.rule_type
                  const accName    = accounts.find(a => a.id === alert.account_id)?.account_name ?? alert.account_id.slice(0, 8)
                  const isCritical = alert.severity === 'critical'
                  const bg         = isCritical ? 'rgba(255,59,59,0.08)' : 'rgba(255,215,0,0.07)'
                  const color      = isCritical ? 'var(--accent-loss)' : '#FFD700'
                  return (
                    <div
                      key={alert.id}
                      className="px-4 py-3 flex items-center gap-4"
                      style={{ borderBottom: '1px solid var(--border-subtle)', background: bg }}
                    >
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider flex-shrink-0"
                        style={{ color, background: bg, borderRadius: 2 }}
                      >
                        {alert.severity}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {accName} — {ruleLabel}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          Value: <span style={{ color: 'var(--text-primary)' }}>{Number(alert.current_value).toFixed(2)}</span>
                          {' '}| Alert: {Number(alert.alert_threshold).toFixed(2)}
                          {alert.kill_threshold != null && ` | Kill: ${Number(alert.kill_threshold).toFixed(2)}`}
                        </div>
                      </div>
                      <div className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {alert.fired_at.slice(0, 16).replace('T', ' ')}
                      </div>
                      {!alert.acknowledged && (
                        <button
                          onClick={() => handleAcknowledge(alert.id)}
                          className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider flex-shrink-0"
                          style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
