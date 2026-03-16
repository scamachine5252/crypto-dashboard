'use client'

import { useMemo } from 'react'
import { EXCHANGES, getAllDailyPnL } from '@/lib/mock-data'
import { formatMoney, formatPercent } from '@/lib/utils'

const CAPITAL_PER_SUB = 6_800_000 / 7

// ---------------------------------------------------------------------------
// Exchange logo SVGs (inline, no external deps)
// ---------------------------------------------------------------------------
function BinanceLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M16 4l3.09 3.09L12.18 14l-3.09-3.09L16 4z" fill="#F0B90B" />
      <path d="M20.91 8.91L24 12l-7.09 7.09L9.82 12l3.09-3.09 4 4 4-4z" fill="#F0B90B" />
      <path d="M4 16l3.09-3.09L10.18 16l-3.09 3.09L4 16z" fill="#F0B90B" />
      <path d="M21.82 16l3.09-3.09L28 16l-3.09 3.09L21.82 16z" fill="#F0B90B" />
      <path d="M16 28l-3.09-3.09L19.82 18l3.09 3.09L16 28z" fill="#F0B90B" />
      <path d="M16 12.91L19.09 16 16 19.09 12.91 16 16 12.91z" fill="#F0B90B" />
    </svg>
  )
}

function BybitLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="4" fill="#FF6B2C" fillOpacity="0.15" />
      <text x="7" y="23" fontSize="18" fontWeight="800" fontFamily="Arial,sans-serif" fill="#FF6B2C">B</text>
    </svg>
  )
}

function OkxLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="2" fill="#4F8EF7" />
      <rect x="18" y="2" width="12" height="12" rx="2" fill="#4F8EF7" />
      <rect x="10" y="10" width="12" height="12" rx="2" fill="#4F8EF7" fillOpacity="0.6" />
      <rect x="2" y="18" width="12" height="12" rx="2" fill="#4F8EF7" />
      <rect x="18" y="18" width="12" height="12" rx="2" fill="#4F8EF7" />
    </svg>
  )
}

const EXCHANGE_LOGOS: Record<string, () => JSX.Element> = {
  binance: BinanceLogo,
  bybit:   BybitLogo,
  okx:     OkxLogo,
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function BalanceCards() {
  const summaries = useMemo(() => {
    const daily = getAllDailyPnL()
    return EXCHANGES.map((ex) => {
      const exPnl = daily
        .filter((d) => d.exchangeId === ex.id)
        .reduce((s, d) => s + d.pnl, 0)
      const allocation = ex.subAccounts.length * CAPITAL_PER_SUB
      const balance = allocation + exPnl
      const pnlPct = (exPnl / allocation) * 100
      return { ex, balance, pnl: exPnl, pnlPct }
    })
  }, [])

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      {summaries.map(({ ex, balance, pnl, pnlPct }) => {
        const Logo = EXCHANGE_LOGOS[ex.id]
        return (
          <ExCard
            key={ex.id}
            name={ex.name}
            accentColor={ex.color}
            logo={<Logo />}
            balance={balance}
            pnl={pnl}
            pnlPct={pnlPct}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
interface ExCardProps {
  name: string
  accentColor: string
  logo: React.ReactNode
  balance: number
  pnl: number
  pnlPct: number
}

function ExCard({ name, accentColor, logo, balance, pnl, pnlPct }: ExCardProps) {
  const isPos = pnl >= 0
  const pnlColor = isPos ? 'var(--accent-profit)' : 'var(--accent-loss)'

  return (
    <div
      className="flex-1 min-w-[200px] flex flex-col gap-2 px-3.5 py-2.5"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderTop: `3px solid ${accentColor}`,
        borderRadius: 4,
        alignSelf: 'flex-start',
      }}
    >
      {/* Header: logo + exchange name */}
      <div className="flex items-center gap-2">
        {logo}
        <span
          className="text-sm font-bold uppercase tracking-widest"
          style={{ color: accentColor, fontFamily: 'var(--font-inter)' }}
        >
          {name}
        </span>
      </div>

      {/* Balance */}
      <div
        className="font-mono text-[22px] font-bold leading-none tabular"
        style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
      >
        {formatMoney(balance)}
      </div>

      {/* PnL + yield */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold" style={{ color: pnlColor }}>
          {isPos ? '+' : ''}{formatMoney(pnl)}
        </span>
        <span className="text-xs tracking-wide" style={{ color: pnlColor, opacity: 0.65 }}>
          {isPos ? '+' : ''}{formatPercent(pnlPct)}
        </span>
      </div>
    </div>
  )
}
