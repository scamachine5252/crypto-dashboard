'use client'

import { useState, useMemo } from 'react'
import { Loader2, Zap, Save, Trash2 } from 'lucide-react'
import type { ApiKeyConfig, ConnectionStatus, ExchangeConfig, ExchangeId } from '@/lib/types'
import { ACCOUNT_COLORS } from '@/lib/mock-data'
import StatusBadge from './StatusBadge'
import ApiKeyInput from './ApiKeyInput'

interface ExchangeCardProps {
  exchange: ExchangeConfig
  config: ApiKeyConfig | null
  onSave: (config: ApiKeyConfig) => void
  onRemove: (exchangeId: ExchangeId) => void
}

export default function ExchangeCard({ exchange, config, onSave, onRemove }: ExchangeCardProps) {
  const [apiKey,     setApiKey]     = useState(config?.apiKey     ?? '')
  const [apiSecret,  setApiSecret]  = useState(config?.apiSecret  ?? '')
  const [passphrase, setPassphrase] = useState(config?.passphrase ?? '')
  const [status,     setStatus]     = useState<ConnectionStatus>(config ? 'connected' : 'not_configured')
  const [testing,    setTesting]    = useState(false)

  const dirty = useMemo(
    () =>
      apiKey     !== (config?.apiKey     ?? '') ||
      apiSecret  !== (config?.apiSecret  ?? '') ||
      passphrase !== (config?.passphrase ?? ''),
    [apiKey, apiSecret, passphrase, config],
  )

  const canTest = apiKey.trim().length > 0 && apiSecret.trim().length > 0 && !testing
  const canSave = apiKey.trim().length > 0 && apiSecret.trim().length > 0

  const handleTest = () => {
    if (!canTest) return
    setTesting(true)
    // TODO: replace with fetch(`/api/exchanges/${exchange.id}/ping`) when real adapters are connected
    setTimeout(() => {
      setStatus('connected')
      setTesting(false)
    }, 600)
  }

  const handleSave = () => {
    if (!canSave) return
    const next: ApiKeyConfig = {
      exchangeId: exchange.id,
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      ...(exchange.id === 'okx' && passphrase.trim() ? { passphrase: passphrase.trim() } : {}),
    }
    onSave(next)
  }

  const handleRemove = () => {
    setApiKey('')
    setApiSecret('')
    setPassphrase('')
    setStatus('not_configured')
    onRemove(exchange.id)
  }

  return (
    <div
      className="flex flex-col"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 4,
      }}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: exchange.color }}
        />
        <span
          className="text-sm font-bold font-heading"
          style={{ color: exchange.color }}
        >
          {exchange.name}
        </span>
        <div className="ml-auto">
          <StatusBadge status={dirty ? 'not_configured' : status} />
        </div>
      </div>

      {/* Key fields */}
      <div className="flex flex-col gap-3 px-4 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <ApiKeyInput
          label="API Key"
          placeholder="Paste your API key…"
          value={apiKey}
          onChange={setApiKey}
        />
        <ApiKeyInput
          label="API Secret"
          placeholder="Paste your API secret…"
          value={apiSecret}
          onChange={setApiSecret}
        />
        {exchange.id === 'okx' && (
          <ApiKeyInput
            label="Passphrase"
            placeholder="OKX passphrase…"
            value={passphrase}
            onChange={setPassphrase}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <ActionBtn
          onClick={handleTest}
          disabled={!canTest}
          loading={testing}
          icon={<Zap className="w-3 h-3" />}
          label="Test"
        />
        <ActionBtn
          onClick={handleSave}
          disabled={!canSave}
          icon={<Save className="w-3 h-3" />}
          label="Save"
          accent={exchange.color}
        />
        <button
          onClick={handleRemove}
          disabled={!config && !apiKey && !apiSecret}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: 'transparent',
            borderColor: 'var(--accent-loss)',
            color: 'var(--accent-loss)',
            borderRadius: 2,
            opacity: (!config && !apiKey && !apiSecret) ? 0.3 : 1,
          }}
        >
          <Trash2 className="w-3 h-3" />
          Remove
        </button>
      </div>

      {/* Sub-accounts */}
      <div className="px-4 py-3">
        <p
          className="text-[10px] uppercase tracking-widest mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          Sub-accounts
        </p>
        <div className="flex flex-col gap-1.5">
          {exchange.subAccounts.map((sa) => (
            <div key={sa.id} className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: ACCOUNT_COLORS[sa.id] ?? exchange.color }}
              />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {sa.name}
              </span>
            </div>
          ))}
        </div>
        <p
          className="text-[10px] mt-2"
          style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}
        >
          Live fetch after connection
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared action button
// ---------------------------------------------------------------------------
function ActionBtn({
  onClick,
  disabled,
  loading = false,
  icon,
  label,
  accent,
}: {
  onClick: () => void
  disabled: boolean
  loading?: boolean
  icon: React.ReactNode
  label: string
  accent?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        background: 'transparent',
        borderColor: accent ?? 'var(--border-medium)',
        color: accent ?? 'var(--text-muted)',
        borderRadius: 2,
      }}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      {label}
    </button>
  )
}
