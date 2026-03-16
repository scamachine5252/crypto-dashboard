'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { ApiKeyConfig, ExchangeId } from '@/lib/types'
import { EXCHANGES } from '@/lib/mock-data'
import { loadAllApiKeys, saveApiKey, removeApiKey } from '@/lib/api-key-store'
import Header from '@/components/layout/Header'
import ExchangeCard from '@/components/api/ExchangeCard'

export default function ApiSettingsPage() {
  const [configs, setConfigs] = useState<Partial<Record<ExchangeId, ApiKeyConfig>>>({})

  // Load from localStorage on mount (SSR-safe — runs client-side only)
  useEffect(() => {
    setConfigs(loadAllApiKeys())
  }, [])

  const handleSave = useCallback((config: ApiKeyConfig) => {
    saveApiKey(config)
    setConfigs((prev) => ({ ...prev, [config.exchangeId]: config }))
  }, [])

  const handleRemove = useCallback((exchangeId: ExchangeId) => {
    removeApiKey(exchangeId)
    setConfigs((prev) => {
      const next = { ...prev }
      delete next[exchangeId]
      return next
    })
  }, [])

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header totalPnl={0} annualYield={0} />

      {/* Global security warning banner */}
      <div
        className="mx-4 mt-4 flex items-start gap-3 px-4 py-3 text-xs"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderLeft: '3px solid var(--accent-gold)',
          borderRadius: 2,
          color: 'var(--text-secondary)',
        }}
      >
        <AlertTriangle
          className="w-3.5 h-3.5 shrink-0 mt-px"
          style={{ color: 'var(--accent-gold)' }}
        />
        <span>
          API keys are stored locally in your browser.{' '}
          <strong style={{ color: 'var(--accent-gold)' }}>
            Never use keys with withdrawal permissions.
          </strong>
        </span>
      </div>

      <main className="flex-1 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mx-4 mt-4">
          {EXCHANGES.map((ex) => (
            <ExchangeCard
              key={ex.id}
              exchange={ex}
              config={configs[ex.id] ?? null}
              onSave={handleSave}
              onRemove={handleRemove}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
