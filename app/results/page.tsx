'use client'

import Header from '@/components/layout/Header'
import { GitCompare } from 'lucide-react'

export default function ResultsPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header totalPnl={0} annualYield={0} />
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-sm animate-fade-in">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}
          >
            <GitCompare className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold mb-2 font-heading" style={{ color: 'var(--text-primary)' }}>
            Trading Results
          </h1>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            Overlay equity curves and compare account performance side by side.
          </p>
          <span
            className="inline-block text-xs font-semibold px-3 py-1 rounded-full"
            style={{ background: 'var(--bg-elevated)', color: 'var(--accent-gold)', border: '1px solid var(--border-medium)' }}
          >
            Coming soon
          </span>
        </div>
      </main>
    </div>
  )
}
