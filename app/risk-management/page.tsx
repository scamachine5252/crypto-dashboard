'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import type { RiskRule, RiskAlert, RuleType } from '@/lib/risk/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RULE_TYPES: { value: RuleType; label: string; unit: string }[] = [
  { value: 'position_size',                   label: 'Position Size',       unit: 'USD'   },
  { value: 'max_drawdown',                    label: 'Max Drawdown',        unit: '%'     },
  { value: 'max_positions',                   label: 'Open Positions',      unit: 'count' },
  { value: 'max_unrealized_pnl_per_position', label: 'Unrealized Loss',     unit: 'USD'   },
  { value: 'max_net_position_instrument',     label: 'Net Exp (Symbol)',    unit: 'USD'   },
  { value: 'max_net_position_account',        label: 'Net Exp (Account)',   unit: 'USD'   },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AccountRow = {
  id: string
  account_name: string
  exchange: string
  fund: string
  kill_switch_enabled: boolean
}

type SnapshotRow = {
  account_id: string
  rule_type: RuleType
  current_value: number
  evaluated_at: string
}

type RuleFormCell = { alert: string; kill: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCellStyle(
  value: number | undefined,
  rule: RiskRule | undefined,
): React.CSSProperties {
  if (value === undefined) return { color: 'var(--text-muted)' }
  if (!rule) return { color: 'var(--text-primary)' }           // value exists, no rule → show neutral
  if (rule.kill_threshold !== null && value > rule.kill_threshold)
    return { color: 'var(--accent-loss)', fontWeight: 600 }
  if (value > rule.alert_threshold)
    return { color: '#FFD700', fontWeight: 600 }
  return { color: 'var(--accent-profit)' }
}

function formatValue(value: number | undefined, unit: string): string {
  if (value === undefined) return '—'
  if (unit === '%') return value.toFixed(2) + '%'
  if (unit === 'count') return String(Math.round(value))
  if (value >= 1_000_000) return '$' + (value / 1_000_000).toFixed(2) + 'M'
  if (value >= 1_000)     return '$' + (value / 1_000).toFixed(1) + 'K'
  return '$' + value.toFixed(0)
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RiskManagementPage() {
  const [tab, setTab] = useState<'monitor' | 'settings'>('monitor')

  // Shared data
  const [accounts, setAccounts]   = useState<AccountRow[]>([])
  const [rules, setRules]         = useState<RiskRule[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([])
  const [alerts, setAlerts]       = useState<RiskAlert[]>([])

  // Monitor state
  const [refreshing, setRefreshing]     = useState(false)
  const [alertFilter, setAlertFilter]   = useState<'all' | 'unread' | 'critical'>('unread')

  // Settings state
  // form[accountId][ruleType] = { alert, kill }
  const [form, setForm] = useState<Record<string, Record<RuleType, RuleFormCell>>>({})
  // accountToggles[accountId] = { monitorEnabled, killEnabled }
  const [accountToggles, setAccountToggles] = useState<Record<string, { monitorEnabled: boolean; killEnabled: boolean }>>({})
  const [saving, setSaving]     = useState(false)
  const [saveMsg, setSaveMsg]   = useState<string | null>(null)
  // Kill switch confirmation: stores account id awaiting confirmation
  const [killConfirm, setKillConfirm] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load shared data
  // ---------------------------------------------------------------------------

  const loadAll = useCallback(async () => {
    const [accRes, rulesRes, snapRes, alertRes] = await Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/risk/rules').then(r => r.json()),
      fetch('/api/risk/snapshots').then(r => r.json()),
      fetch('/api/risk/alerts?acknowledged=false').then(r => r.json()),
    ])

    const accs: AccountRow[] = Array.isArray(accRes) ? accRes : (accRes.accounts ?? [])
    const loadedRules: RiskRule[] = rulesRes.rules ?? []
    const loadedSnaps: SnapshotRow[] = snapRes.snapshots ?? []
    const loadedAlerts: RiskAlert[] = alertRes.alerts ?? []

    setAccounts(accs)
    setRules(loadedRules)
    setSnapshots(loadedSnaps)
    setAlerts(loadedAlerts)

    // Build Settings form state from loaded rules
    const newForm: Record<string, Record<RuleType, RuleFormCell>> = {}
    const newToggles: Record<string, { monitorEnabled: boolean; killEnabled: boolean }> = {}
    for (const acc of accs) {
      const accRules = loadedRules.filter(r => r.account_id === acc.id)
      const cells = {} as Record<RuleType, RuleFormCell>
      for (const rt of RULE_TYPES) {
        const r = accRules.find(x => x.rule_type === rt.value)
        cells[rt.value] = r
          ? { alert: String(r.alert_threshold), kill: r.kill_threshold != null ? String(r.kill_threshold) : '' }
          : { alert: '', kill: '' }
      }
      newForm[acc.id] = cells
      newToggles[acc.id] = {
        monitorEnabled: accRules.some(r => r.enabled),
        killEnabled: acc.kill_switch_enabled ?? true,
      }
    }
    setForm(newForm)
    setAccountToggles(newToggles)
  }, [])

  useEffect(() => { loadAll().catch(() => {}) }, [loadAll])

  // ---------------------------------------------------------------------------
  // Monitor: Refresh
  // ---------------------------------------------------------------------------

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetch('/api/risk/evaluate', { method: 'POST' })
      const [snapRes, alertRes] = await Promise.all([
        fetch('/api/risk/snapshots').then(r => r.json()),
        fetch('/api/risk/alerts?acknowledged=false').then(r => r.json()),
      ])
      setSnapshots(snapRes.snapshots ?? [])
      setAlerts(alertRes.alerts ?? [])
    } finally {
      setRefreshing(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Monitor: Acknowledge alert
  // ---------------------------------------------------------------------------

  const handleAcknowledge = async (id: string) => {
    const res = await fetch(`/api/risk/alerts/${id}/acknowledge`, { method: 'PATCH' })
    if (res.ok) setAlerts(prev => prev.filter(a => a.id !== id))
  }

  // ---------------------------------------------------------------------------
  // Settings: Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      await Promise.all(accounts.flatMap(acc => {
        const toggles = accountToggles[acc.id] ?? { monitorEnabled: true, killEnabled: true }
        const accForm = form[acc.id] ?? {}
        const accRules = rules.filter(r => r.account_id === acc.id)

        const ruleOps = RULE_TYPES.map(rt => {
          const cell = accForm[rt.value] ?? { alert: '', kill: '' }
          if (cell.alert) {
            return fetch('/api/risk/rules', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                account_id: acc.id,
                rule_type: rt.value,
                alert_threshold: Number(cell.alert),
                kill_threshold: cell.kill ? Number(cell.kill) : null,
                enabled: toggles.monitorEnabled,
              }),
            })
          }
          const existing = accRules.find(r => r.rule_type === rt.value)
          if (existing) {
            return fetch('/api/risk/rules', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                account_id: acc.id,
                rule_type: rt.value,
                alert_threshold: existing.alert_threshold,
                kill_threshold: existing.kill_threshold,
                enabled: false,
              }),
            })
          }
          return Promise.resolve()
        })

        const killOp = fetch(`/api/accounts/${acc.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kill_switch_enabled: toggles.killEnabled }),
        })

        return [...ruleOps, killOp]
      }))

      setSaveMsg('Saved')
      await loadAll()
    } catch {
      setSaveMsg('Error saving')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 2500)
    }
  }

  // ---------------------------------------------------------------------------
  // Derived helpers
  // ---------------------------------------------------------------------------

  const getSnapshot = (accountId: string, ruleType: RuleType) =>
    snapshots.find(s => s.account_id === accountId && s.rule_type === ruleType)

  const getRule = (accountId: string, ruleType: RuleType) =>
    rules.find(r => r.account_id === accountId && r.rule_type === ruleType)

  const lastEvaluated = snapshots.length > 0
    ? snapshots.reduce((latest, s) =>
        s.evaluated_at > latest ? s.evaluated_at : latest,
        snapshots[0].evaluated_at,
      )
    : null

  const visibleAlerts = alerts.filter(a => {
    if (alertFilter === 'unread')   return !a.acknowledged
    if (alertFilter === 'critical') return a.severity === 'critical'
    return true
  })

  const unreadCount = alerts.filter(a => !a.acknowledged).length

  // ---------------------------------------------------------------------------
  // Shared styles
  // ---------------------------------------------------------------------------

  const cellBase: React.CSSProperties = {
    borderBottom: '1px solid var(--border-subtle)',
    padding: '8px 10px',
    whiteSpace: 'nowrap',
  }

  const headerCell: React.CSSProperties = {
    ...cellBase,
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header />

      {/* Tab bar */}
      <div
        className="px-4 flex items-center"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        {(['monitor', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-5 py-3 text-xs font-semibold uppercase tracking-widest transition-colors"
            style={{
              color:        tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--accent-profit)' : '2px solid transparent',
            }}
          >
            {t === 'monitor' && unreadCount > 0 ? `Monitor (${unreadCount})` : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <main className="flex-1 p-4 w-full mx-auto max-w-[1400px]">

        {/* ================================================================ */}
        {/* MONITOR TAB                                                       */}
        {/* ================================================================ */}
        {tab === 'monitor' && (
          <div className="flex flex-col gap-5">

            {/* Header row */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  color: refreshing ? 'var(--text-muted)' : 'var(--text-primary)',
                }}
              >
                <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>↻</span>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              {lastEvaluated && (
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Last updated: {timeAgo(lastEvaluated)}
                </span>
              )}
              {!lastEvaluated && !refreshing && (
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  No data yet — click Refresh to load
                </span>
              )}
            </div>

            {/* Metrics table */}
            <div style={{ border: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ ...headerCell, textAlign: 'left', minWidth: 140 }}>Account</th>
                    <th style={{ ...headerCell, textAlign: 'left', width: 80 }}>Exchange</th>
                    {RULE_TYPES.map(rt => (
                      <th key={rt.value} style={{ ...headerCell, textAlign: 'right', minWidth: 110 }}>
                        {rt.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc, i) => (
                    <tr
                      key={acc.id}
                      style={{ background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-elevated)' }}
                    >
                      <td style={{ ...cellBase, color: 'var(--text-primary)', fontWeight: 600 }}>
                        {acc.account_name}
                      </td>
                      <td style={{ ...cellBase, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>
                        {acc.exchange}
                      </td>
                      {RULE_TYPES.map(rt => {
                        const snap = getSnapshot(acc.id, rt.value)
                        const rule = getRule(acc.id, rt.value)
                        return (
                          <td
                            key={rt.value}
                            style={{
                              ...cellBase,
                              textAlign: 'right',
                              fontFamily: 'var(--font-geist-mono, monospace)',
                              ...getCellStyle(snap?.current_value, rule),
                            }}
                          >
                            {formatValue(snap?.current_value, rt.unit)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ ...cellBase, textAlign: 'center', color: 'var(--text-muted)' }}>
                        No accounts configured
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <span><span style={{ color: 'var(--accent-profit)' }}>●</span> OK</span>
              <span><span style={{ color: '#FFD700' }}>●</span> Alert threshold exceeded</span>
              <span><span style={{ color: 'var(--accent-loss)' }}>●</span> Kill threshold exceeded</span>
              <span style={{ color: 'var(--text-muted)' }}>— No rule set / no data</span>
            </div>

            {/* Alerts section */}
            <div>
              <p className="text-[10px] uppercase tracking-widest mb-2 font-semibold" style={{ color: 'var(--text-muted)' }}>
                Alerts
              </p>
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
                <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                  No alerts
                </div>
              ) : (
                <div style={{ border: '1px solid var(--border-subtle)' }}>
                  {visibleAlerts.map(alert => {
                    const ruleLabel  = RULE_TYPES.find(r => r.value === alert.rule_type)?.label ?? alert.rule_type
                    const accName    = accounts.find(a => a.id === alert.account_id)?.account_name ?? alert.account_id.slice(0, 8)
                    const isCritical = alert.severity === 'critical'
                    const bg    = isCritical ? 'rgba(255,59,59,0.07)' : 'rgba(255,215,0,0.06)'
                    const color = isCritical ? 'var(--accent-loss)' : '#FFD700'
                    return (
                      <div
                        key={alert.id}
                        className="px-4 py-3 flex items-center gap-4"
                        style={{ borderBottom: '1px solid var(--border-subtle)', background: bg }}
                      >
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider flex-shrink-0"
                          style={{ color, borderRadius: 2 }}>
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
          </div>
        )}

        {/* ================================================================ */}
        {/* SETTINGS TAB                                                      */}
        {/* ================================================================ */}
        {tab === 'settings' && (
          <div>
            {/* Save header */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Fill in thresholds for the metrics you want to monitor. Leave empty to disable a rule.
              </p>
              <div className="flex items-center gap-3">
                {saveMsg && (
                  <span className="text-xs" style={{ color: saveMsg === 'Saved' ? 'var(--accent-profit)' : 'var(--accent-loss)' }}>
                    {saveMsg}
                  </span>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-1.5 text-xs font-semibold uppercase tracking-wider"
                  style={{ background: 'var(--accent-profit)', color: '#000', opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? 'Saving…' : 'Save All'}
                </button>
              </div>
            </div>

            {/* Settings table */}
            <div style={{ border: '1px solid rgba(255,255,255,0.12)', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...headerCell, textAlign: 'left', minWidth: 140, verticalAlign: 'bottom' }}>
                      Account
                    </th>
                    {RULE_TYPES.map(rt => (
                      <th key={rt.value} colSpan={2} style={{ ...headerCell, textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
                        {rt.label}
                        <span className="ml-1" style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({rt.unit})</span>
                      </th>
                    ))}
                    <th rowSpan={2} style={{ ...headerCell, textAlign: 'center', minWidth: 70, borderLeft: '1px solid rgba(255,255,255,0.1)', verticalAlign: 'bottom' }}>
                      Monitor
                    </th>
                    <th rowSpan={2} style={{ ...headerCell, textAlign: 'center', minWidth: 70, borderLeft: '1px solid rgba(255,255,255,0.1)', verticalAlign: 'bottom' }}>
                      Kill SW
                    </th>
                  </tr>
                  <tr>
                    {RULE_TYPES.map(rt => (
                      <React.Fragment key={rt.value}>
                        <th style={{ ...headerCell, textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.1)', color: '#FFD700', minWidth: 80 }}>
                          Alert
                        </th>
                        <th style={{ ...headerCell, textAlign: 'center', color: '#FF6B6B', minWidth: 80 }}>
                          Kill
                        </th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc, i) => {
                    const toggles = accountToggles[acc.id] ?? { monitorEnabled: true, killEnabled: true }
                    const accForm = form[acc.id] ?? {}
                    const rowOpacity = toggles.monitorEnabled ? 1 : 0.5
                    return (
                      <tr
                        key={acc.id}
                        style={{
                          background: i % 2 === 0 ? 'var(--bg-secondary)' : '#1e1e2a',
                          opacity: rowOpacity,
                        }}
                      >
                        {/* Account name */}
                        <td style={{ ...cellBase, color: 'var(--text-primary)', fontWeight: 600 }}>
                          <div>{acc.account_name}</div>
                          <div className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>{acc.exchange}</div>
                        </td>

                        {/* Threshold cells */}
                        {RULE_TYPES.map(rt => {
                          const cell = accForm[rt.value] ?? { alert: '', kill: '' }
                          const setCell = (patch: Partial<RuleFormCell>) =>
                            setForm(prev => ({
                              ...prev,
                              [acc.id]: { ...prev[acc.id], [rt.value]: { ...prev[acc.id]?.[rt.value], ...patch } },
                            }))
                          return (
                            <React.Fragment key={rt.value}>
                              <td style={{ ...cellBase, borderLeft: '1px solid rgba(255,255,255,0.08)', padding: '5px 6px' }}>
                                <input
                                  type="number"
                                  placeholder="—"
                                  value={cell.alert}
                                  onChange={e => setCell({ alert: e.target.value })}
                                  className="w-full px-1.5 py-1 text-xs font-mono text-right"
                                  style={{
                                    background: '#252535',
                                    border: '1px solid rgba(255,215,0,0.5)',
                                    color: '#fff',
                                    borderRadius: 2,
                                    width: 76,
                                    outline: 'none',
                                  }}
                                />
                              </td>
                              <td style={{ ...cellBase, padding: '5px 6px' }}>
                                <input
                                  type="number"
                                  placeholder="—"
                                  value={cell.kill}
                                  onChange={e => setCell({ kill: e.target.value })}
                                  className="w-full px-1.5 py-1 text-xs font-mono text-right"
                                  style={{
                                    background: '#252535',
                                    border: '1px solid rgba(255,80,80,0.55)',
                                    color: '#fff',
                                    borderRadius: 2,
                                    width: 76,
                                    outline: 'none',
                                  }}
                                />
                              </td>
                            </React.Fragment>
                          )
                        })}

                        {/* Monitor toggle */}
                        <td style={{ ...cellBase, textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                          <button
                            onClick={() =>
                              setAccountToggles(prev => ({
                                ...prev,
                                [acc.id]: { ...prev[acc.id], monitorEnabled: !toggles.monitorEnabled },
                              }))
                            }
                            className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                              background: toggles.monitorEnabled ? 'rgba(0,255,136,0.15)' : 'var(--bg-elevated)',
                              color:      toggles.monitorEnabled ? 'var(--accent-profit)' : 'var(--text-muted)',
                              border:     `1px solid ${toggles.monitorEnabled ? 'var(--accent-profit)' : 'var(--border-subtle)'}`,
                              borderRadius: 3,
                              minWidth: 40,
                            }}
                          >
                            {toggles.monitorEnabled ? 'ON' : 'OFF'}
                          </button>
                        </td>

                        {/* Kill toggle */}
                        <td style={{ ...cellBase, textAlign: 'center', borderLeft: '1px solid var(--border-subtle)', minWidth: 110 }}>
                          {killConfirm === acc.id ? (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: 'var(--accent-loss)' }}>
                                Enable kill?
                              </span>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => {
                                    setKillConfirm(null)
                                    setAccountToggles(prev => ({
                                      ...prev,
                                      [acc.id]: { ...prev[acc.id], killEnabled: true },
                                    }))
                                  }}
                                  className="px-2 py-0.5 text-[10px] font-semibold uppercase"
                                  style={{ background: 'rgba(255,59,59,0.2)', color: 'var(--accent-loss)', border: '1px solid var(--accent-loss)', borderRadius: 2 }}
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => setKillConfirm(null)}
                                  className="px-2 py-0.5 text-[10px] font-semibold uppercase"
                                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                if (!toggles.killEnabled) {
                                  setKillConfirm(acc.id)
                                } else {
                                  setAccountToggles(prev => ({
                                    ...prev,
                                    [acc.id]: { ...prev[acc.id], killEnabled: false },
                                  }))
                                }
                              }}
                              className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                              style={{
                                background: toggles.killEnabled ? 'rgba(255,59,59,0.15)' : 'var(--bg-elevated)',
                                color:      toggles.killEnabled ? 'var(--accent-loss)' : 'var(--text-muted)',
                                border:     `1px solid ${toggles.killEnabled ? 'var(--accent-loss)' : 'var(--border-subtle)'}`,
                                borderRadius: 3,
                                minWidth: 40,
                              }}
                            >
                              {toggles.killEnabled ? 'ON' : 'OFF'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={15} style={{ ...cellBase, textAlign: 'center', color: 'var(--text-muted)' }}>
                        No accounts configured
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
