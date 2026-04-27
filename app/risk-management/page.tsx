'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/Header'
import type { RiskRule, RiskAlert, RuleType } from '@/lib/risk/types'
import type { Position } from '@/lib/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALERT_COLOR = '#F97316'

const RULE_TYPES: { value: RuleType; label: string; unit: string; invertedAlert?: boolean }[] = [
  { value: 'max_positions',                   label: 'Open Positions',    unit: 'count' },
  { value: 'position_size',                   label: 'Position Size',     unit: 'USD'   },
  { value: 'max_drawdown',                    label: 'Max Drawdown',      unit: '%'     },
  { value: 'max_unrealized_pnl_per_position', label: 'Unrealized Loss',   unit: 'USD'   },
  { value: 'max_net_position_instrument',     label: 'Net Exp (Symbol)',  unit: 'USD'   },
  { value: 'max_net_position_account',        label: 'Net Exp (Account)', unit: 'USD'   },
  { value: 'leverage',                        label: 'Leverage',          unit: 'x'     },
  { value: 'margin_utilization',              label: 'Margin Used',       unit: '%'     },
  { value: 'min_liq_distance',                label: 'Liq Distance',      unit: '%', invertedAlert: true },
]

const MONITOR_COLS = 2 + RULE_TYPES.length  // Account + Exchange + 9 metrics

// Metrics that are meaningless (show "—") when there are no open positions
const POSITION_ONLY_METRICS = new Set<RuleType>([
  'position_size', 'max_unrealized_pnl_per_position',
  'max_net_position_instrument', 'max_net_position_account',
  'leverage', 'margin_utilization', 'min_liq_distance',
])

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

type LiveResult = {
  account_id: string
  account_name: string
  exchange: string
  fund: string
  metrics: Record<RuleType, number>
  positions: Position[]
  currentUsdtBalance: number
}

type RuleFormCell = { alert: string; kill: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCellStyle(
  value: number | undefined,
  rule: RiskRule | undefined,
  inverted = false,
): React.CSSProperties {
  if (value === undefined) return { color: 'var(--text-muted)' }
  if (!rule) return { color: 'var(--text-primary)' }
  if (inverted) {
    if (rule.kill_threshold !== null && value < rule.kill_threshold)
      return { color: 'var(--accent-loss)', fontWeight: 600 }
    if (value < rule.alert_threshold)
      return { color: ALERT_COLOR, fontWeight: 600 }
    return { color: 'var(--accent-profit)' }
  }
  if (rule.kill_threshold !== null && value > rule.kill_threshold)
    return { color: 'var(--accent-loss)', fontWeight: 600 }
  if (value > rule.alert_threshold)
    return { color: ALERT_COLOR, fontWeight: 600 }
  return { color: 'var(--accent-profit)' }
}

function formatValue(value: number | undefined, unit: string): string {
  if (value === undefined) return '—'
  if (unit === '%') return value.toFixed(2) + '%'
  if (unit === 'count') return String(Math.round(value))
  if (unit === 'x') return value.toFixed(2) + 'x'
  if (value >= 1_000_000) return '$' + (value / 1_000_000).toFixed(2) + 'M'
  if (value >= 1_000)     return '$' + (value / 1_000).toFixed(1) + 'K'
  return '$' + value.toFixed(0)
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function getTopPositionsForMetric(
  positions: Position[],
  ruleType: RuleType,
): Position[] {
  if (positions.length === 0) return []

  switch (ruleType) {
    case 'max_positions':
    case 'position_size':
    case 'leverage':
      return [...positions].sort((a, b) => b.notional - a.notional).slice(0, 5)

    case 'max_unrealized_pnl_per_position':
      return [...positions].sort((a, b) => a.unrealizedPnl - b.unrealizedPnl).slice(0, 5)

    case 'max_net_position_instrument': {
      const bySymbol: Record<string, number> = {}
      for (const p of positions)
        bySymbol[p.symbol] = (bySymbol[p.symbol] ?? 0) + (p.side === 'long' ? p.notional : -p.notional)
      const sorted = Object.entries(bySymbol)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 5)
        .map(([sym]) => sym)
      return positions
        .filter(p => sorted.includes(p.symbol))
        .sort((a, b) => b.notional - a.notional)
        .slice(0, 5)
    }

    case 'max_net_position_account':
      return [...positions]
        .sort((a, b) => {
          const av = a.side === 'long' ? a.notional : -a.notional
          const bv = b.side === 'long' ? b.notional : -b.notional
          return bv - av
        })
        .slice(0, 5)

    case 'margin_utilization':
      return [...positions].sort((a, b) => b.margin - a.margin).slice(0, 5)

    case 'min_liq_distance':
      return [...positions]
        .filter(p => p.liquidationPrice > 0 && p.markPrice > 0)
        .sort((a, b) => {
          const da = Math.abs(a.markPrice - a.liquidationPrice) / a.markPrice
          const db = Math.abs(b.markPrice - b.liquidationPrice) / b.markPrice
          return da - db
        })
        .slice(0, 5)

    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RiskManagementPage() {
  const [tab, setTab] = useState<'monitor' | 'settings'>('monitor')

  // Shared data
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [rules, setRules]       = useState<RiskRule[]>([])
  const [alerts, setAlerts]     = useState<RiskAlert[]>([])

  // Live metrics
  const [liveMetrics, setLiveMetrics]   = useState<Record<string, Record<RuleType, number>>>({})
  const [livePositions, setLivePositions] = useState<Record<string, Position[]>>({})
  const [liveLoading, setLiveLoading]   = useState(false)
  const [liveLoadedAt, setLiveLoadedAt] = useState<string | null>(null)

  // Tooltip
  const [expandedCell, setExpandedCell] = useState<{ accountId: string; ruleType: RuleType } | null>(null)

  // Monitor state
  const [refreshing, setRefreshing]   = useState(false)
  const [alertFilter, setAlertFilter] = useState<'all' | 'unread' | 'critical'>('unread')

  // Settings state
  const [form, setForm] = useState<Record<string, Record<RuleType, RuleFormCell>>>({})
  const [accountToggles, setAccountToggles] = useState<Record<string, { monitorEnabled: boolean; killEnabled: boolean }>>({})
  const [saving, setSaving]   = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [killConfirm, setKillConfirm] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const loadLiveMetrics = useCallback(async () => {
    setLiveLoading(true)
    try {
      const res = await fetch('/api/risk/live-metrics')
      const data = await res.json() as { results: LiveResult[] }
      const metricsMap: Record<string, Record<RuleType, number>> = {}
      const positionsMap: Record<string, Position[]> = {}
      for (const r of data.results ?? []) {
        metricsMap[r.account_id]   = r.metrics
        positionsMap[r.account_id] = r.positions
      }
      setLiveMetrics(metricsMap)
      setLivePositions(positionsMap)
      setLiveLoadedAt(new Date().toISOString())
    } finally {
      setLiveLoading(false)
    }
  }, [])

  const loadAll = useCallback(async () => {
    const [accRes, rulesRes, alertRes] = await Promise.all([
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/risk/rules').then(r => r.json()),
      fetch('/api/risk/alerts?acknowledged=false').then(r => r.json()),
    ])

    const accs: AccountRow[] = Array.isArray(accRes) ? accRes : (accRes.accounts ?? [])
    const loadedRules: RiskRule[] = rulesRes.rules ?? []
    const loadedAlerts: RiskAlert[] = alertRes.alerts ?? []

    setAccounts(accs)
    setRules(loadedRules)
    setAlerts(loadedAlerts)

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

  useEffect(() => {
    loadAll().catch(() => {})
    loadLiveMetrics().catch(() => {})
  }, [loadAll, loadLiveMetrics])

  // ---------------------------------------------------------------------------
  // Monitor: Refresh
  // ---------------------------------------------------------------------------

  const handleRefresh = async () => {
    setRefreshing(true)
    setExpandedCell(null)
    try {
      const [, , alertRes] = await Promise.all([
        loadLiveMetrics(),
        fetch('/api/risk/evaluate', { method: 'POST' }),
        fetch('/api/risk/alerts?acknowledged=false').then(r => r.json()),
      ])
      setAlerts((alertRes as { alerts?: RiskAlert[] }).alerts ?? [])
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

  const getRule = (accountId: string, ruleType: RuleType) =>
    rules.find(r => r.account_id === accountId && r.rule_type === ruleType)

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

      <main className="flex-1 p-4 w-full mx-auto" style={{ maxWidth: 'calc(100vw - 32px)' }}>

        {/* ================================================================ */}
        {/* MONITOR TAB                                                       */}
        {/* ================================================================ */}
        {tab === 'monitor' && (
          <div className="flex flex-col gap-5">

            {/* Header row */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={refreshing || liveLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  color: (refreshing || liveLoading) ? 'var(--text-muted)' : 'var(--text-primary)',
                }}
              >
                <span style={{ display: 'inline-block', animation: (refreshing || liveLoading) ? 'spin 1s linear infinite' : 'none' }}>↻</span>
                {(refreshing || liveLoading) ? 'Loading…' : 'Refresh'}
              </button>
              {liveLoadedAt && (
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Live data · {timeAgo(liveLoadedAt)}
                </span>
              )}
              {!liveLoadedAt && !liveLoading && (
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  Click Refresh to load live data
                </span>
              )}
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                · Click any metric cell for position details
              </span>
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
                  {accounts.map((acc, i) => {
                    const accMetrics = liveMetrics[acc.id]
                    const isExpanded = expandedCell?.accountId === acc.id
                    const expandedRt = isExpanded ? expandedCell!.ruleType : null
                    const expandedPositions = expandedRt && expandedRt !== 'max_drawdown'
                      ? getTopPositionsForMetric(livePositions[acc.id] ?? [], expandedRt)
                      : []

                    const hasPositions = (accMetrics?.max_positions ?? 0) > 0

                    return (
                      <React.Fragment key={acc.id}>
                        <tr style={{ background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-elevated)' }}>
                          <td style={{ ...cellBase, color: 'var(--text-primary)', fontWeight: 600 }}>
                            {acc.account_name}
                          </td>
                          <td style={{ ...cellBase, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>
                            {acc.exchange}
                          </td>
                          {RULE_TYPES.map(rt => {
                            const rawValue = accMetrics?.[rt.value]
                            // Show "—" for position-only metrics when account has 0 open positions
                            const value = (!hasPositions && POSITION_ONLY_METRICS.has(rt.value)) ? undefined : rawValue
                            const rule  = getRule(acc.id, rt.value)
                            const isThisExpanded = isExpanded && expandedCell?.ruleType === rt.value
                            return (
                              <td
                                key={rt.value}
                                onClick={() => {
                                  if (value === undefined) return
                                  setExpandedCell(prev =>
                                    prev?.accountId === acc.id && prev?.ruleType === rt.value
                                      ? null
                                      : { accountId: acc.id, ruleType: rt.value },
                                  )
                                }}
                                style={{
                                  ...cellBase,
                                  textAlign: 'right',
                                  fontFamily: '"Geist Mono", "Cascadia Mono", ui-monospace, monospace',
                                  cursor: value !== undefined ? 'pointer' : 'default',
                                  background: isThisExpanded ? 'rgba(255,255,255,0.05)' : undefined,
                                  ...getCellStyle(value, rule, rt.invertedAlert),
                                }}
                              >
                                {liveLoading ? <span style={{ color: 'var(--text-muted)' }}>…</span> : formatValue(value, rt.unit)}
                              </td>
                            )
                          })}
                        </tr>

                        {/* Expanded tooltip row */}
                        {isExpanded && (
                          <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                            <td
                              colSpan={MONITOR_COLS}
                              style={{ padding: '8px 16px 12px', borderBottom: '1px solid var(--border-subtle)' }}
                            >
                              <div className="text-[10px] uppercase tracking-widest mb-2 font-semibold" style={{ color: 'var(--text-muted)' }}>
                                {RULE_TYPES.find(r => r.value === expandedRt)?.label} — Top positions
                                <button
                                  onClick={() => setExpandedCell(null)}
                                  className="ml-3 px-1.5 py-0.5"
                                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 2 }}
                                >
                                  ✕
                                </button>
                              </div>

                              {expandedRt === 'max_drawdown' ? (
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  Drawdown is a balance-level metric — not attributable to individual positions.
                                </p>
                              ) : expandedPositions.length === 0 ? (
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No positions with relevant data.</p>
                              ) : (
                                <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%', maxWidth: 900 }}>
                                  <thead>
                                    <tr>
                                      {['Symbol', 'Side', 'Notional', 'Entry', 'Mark', 'Unreal. PnL', 'Liq Price', 'Liq Dist'].map(col => (
                                        <th key={col} style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-subtle)' }}>
                                          {col}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {expandedPositions.map((p, idx) => {
                                      const liqDist = p.liquidationPrice > 0 && p.markPrice > 0
                                        ? (Math.abs(p.markPrice - p.liquidationPrice) / p.markPrice * 100).toFixed(2) + '%'
                                        : '—'
                                      return (
                                        <tr key={idx}>
                                          <td style={{ padding: '3px 8px', fontFamily: 'var(--font-geist-mono)', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right' }}>{p.symbol}</td>
                                          <td style={{ padding: '3px 8px', textAlign: 'right', color: p.side === 'long' ? 'var(--accent-profit)' : 'var(--accent-loss)', fontWeight: 600, textTransform: 'uppercase', fontSize: 10 }}>{p.side}</td>
                                          <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-primary)' }}>{formatValue(p.notional, 'USD')}</td>
                                          <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-muted)' }}>{p.entryPrice?.toFixed(4) ?? '—'}</td>
                                          <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-primary)' }}>{p.markPrice?.toFixed(4) ?? '—'}</td>
                                          <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-geist-mono)', color: p.unrealizedPnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)' }}>
                                            {p.unrealizedPnl >= 0 ? '+' : ''}{p.unrealizedPnl.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-muted)' }}>{p.liquidationPrice > 0 ? p.liquidationPrice.toFixed(4) : '—'}</td>
                                          <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'var(--font-geist-mono)', color: 'var(--text-primary)' }}>{liqDist}</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan={MONITOR_COLS} style={{ ...cellBase, textAlign: 'center', color: 'var(--text-muted)' }}>
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
              <span><span style={{ color: ALERT_COLOR }}>●</span> Alert threshold exceeded</span>
              <span><span style={{ color: 'var(--accent-loss)' }}>●</span> Kill threshold exceeded</span>
              <span>— No rule / no data</span>
              <span style={{ color: 'var(--text-muted)' }}>Liq Distance: inverted (lower = closer to liquidation)</span>
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
                    const bg         = isCritical ? 'rgba(255,59,59,0.07)' : 'rgba(249,115,22,0.06)'
                    const color      = isCritical ? 'var(--accent-loss)' : ALERT_COLOR
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
            <div style={{ border: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 130 }} />
                  {RULE_TYPES.flatMap((_rt, i) => [
                    <col key={`a${i}`} style={{ width: 54 }} />,
                    <col key={`k${i}`} style={{ width: 54 }} />,
                  ])}
                  <col style={{ width: 58 }} />
                  <col style={{ width: 68 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...headerCell, textAlign: 'left', verticalAlign: 'bottom' }}>
                      Account
                    </th>
                    {RULE_TYPES.map(rt => (
                      <th key={rt.value} colSpan={2} style={{ ...headerCell, textAlign: 'center', borderLeft: '1px solid var(--border-subtle)', fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {rt.label}
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({rt.unit})</span>
                      </th>
                    ))}
                    <th rowSpan={2} style={{ ...headerCell, textAlign: 'center', borderLeft: '1px solid var(--border-subtle)', verticalAlign: 'bottom', fontSize: 9 }}>
                      Mon
                    </th>
                    <th rowSpan={2} style={{ ...headerCell, textAlign: 'center', borderLeft: '1px solid var(--border-subtle)', verticalAlign: 'bottom', fontSize: 9 }}>
                      Kill SW
                    </th>
                  </tr>
                  <tr>
                    {RULE_TYPES.map(rt => (
                      <React.Fragment key={rt.value}>
                        <th style={{ ...headerCell, textAlign: 'center', borderLeft: '1px solid var(--border-subtle)', color: ALERT_COLOR, fontSize: 9 }}>
                          Alert
                        </th>
                        <th style={{ ...headerCell, textAlign: 'center', color: '#FF6B6B', fontSize: 9 }}>
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
                    const isDisabled = !toggles.monitorEnabled
                    return (
                      <tr
                        key={acc.id}
                        style={{ background: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-elevated)' }}
                      >
                        {/* Account name */}
                        <td style={{ ...cellBase, fontWeight: 600 }}>
                          <div style={{ color: isDisabled ? 'var(--text-muted)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {acc.account_name}
                          </div>
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
                              <td style={{ ...cellBase, borderLeft: '1px solid var(--border-subtle)', padding: '4px 3px' }}>
                                <input
                                  type="number"
                                  placeholder="—"
                                  value={cell.alert}
                                  onChange={e => setCell({ alert: e.target.value })}
                                  style={{
                                    background: 'var(--bg-primary)',
                                    border: `1px solid ${ALERT_COLOR}70`,
                                    color: 'var(--text-primary)',
                                    borderRadius: 2,
                                    width: '100%',
                                    outline: 'none',
                                    fontSize: 11,
                                    fontFamily: 'ui-monospace, monospace',
                                    textAlign: 'right',
                                    padding: '2px 4px',
                                  }}
                                />
                              </td>
                              <td style={{ ...cellBase, padding: '4px 3px' }}>
                                <input
                                  type="number"
                                  placeholder="—"
                                  value={cell.kill}
                                  onChange={e => setCell({ kill: e.target.value })}
                                  style={{
                                    background: 'var(--bg-primary)',
                                    border: '1px solid rgba(255,80,80,0.5)',
                                    color: 'var(--text-primary)',
                                    borderRadius: 2,
                                    width: '100%',
                                    outline: 'none',
                                    fontSize: 11,
                                    fontFamily: 'ui-monospace, monospace',
                                    textAlign: 'right',
                                    padding: '2px 4px',
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
                      <td colSpan={1 + RULE_TYPES.length * 2 + 2} style={{ ...cellBase, textAlign: 'center', color: 'var(--text-muted)' }}>
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
