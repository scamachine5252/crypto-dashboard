'use client'

import { formatMoney, formatPercent } from '@/lib/utils'
import type { FundSummary } from '@/lib/types'

interface FundCardsProps {
  funds: FundSummary[]
  loading?: boolean
}

export default function FundCards({ funds, loading }: FundCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-24 rounded animate-pulse"
            style={{ background: 'var(--bg-secondary)' }}
          />
        ))}
      </div>
    )
  }

  if (funds.length === 0) {
    return (
      <div
        className="text-center py-8"
        style={{ color: 'var(--text-muted)', fontSize: 13 }}
      >
        No accounts synced yet. Add accounts in API Settings and run Sync.
      </div>
    )
  }

  const totalAum = funds.reduce((s, f) => s + f.aum, 0)
  const totalPnl = funds.reduce((s, f) => s + f.totalPnl, 0)
  const totalPnlPct = totalAum > 0 ? (totalPnl / totalAum) * 100 : 0

  const cols = Math.min(funds.length + (funds.length > 1 ? 1 : 0), 5)

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {funds.map((fund) => (
        <FundCard key={fund.fund} {...fund} />
      ))}
      {funds.length > 1 && (
        <FundCard
          fund="Total Portfolio"
          aum={totalAum}
          totalPnl={totalPnl}
          pnlPct={totalPnlPct}
          isTotal
        />
      )}
    </div>
  )
}

function FundCard({
  fund,
  aum,
  totalPnl,
  pnlPct,
  isTotal,
}: FundSummary & { isTotal?: boolean }) {
  const isPositive = totalPnl >= 0
  const pnlColor = isPositive ? 'var(--accent-profit)' : 'var(--accent-loss)'

  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: `1px solid ${isTotal ? 'var(--border-medium)' : 'var(--border-subtle)'}`,
        padding: '16px 20px',
        borderRadius: 4,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--text-muted)',
          marginBottom: 8,
        }}
      >
        {fund}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          fontFamily: 'var(--font-geist-mono)',
          color: 'var(--text-primary)',
          marginBottom: 4,
        }}
      >
        {formatMoney(aum)}
      </div>
      <div
        style={{
          fontSize: 12,
          color: pnlColor,
          fontFamily: 'var(--font-geist-mono)',
        }}
      >
        {isPositive ? '+' : ''}
        {formatMoney(totalPnl)}
        <span style={{ opacity: 0.7, marginLeft: 6 }}>
          ({isPositive ? '+' : ''}
          {formatPercent(pnlPct / 100)})
        </span>
      </div>
    </div>
  )
}
