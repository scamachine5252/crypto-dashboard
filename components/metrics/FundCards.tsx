'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMoney, formatPercent } from '@/lib/utils'
import type { FundSummary } from '@/lib/types'

type NavVariant = 'arrows' | 'scroll'

interface FundCardsProps {
  funds: FundSummary[]
  loading?: boolean
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function pnlColor(pnl: number) {
  return pnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)'
}

function PnlLine({ aum, pnl, pnlPct }: { aum: number; pnl: number; pnlPct: number }) {
  const isPos = pnl >= 0
  return (
    <span style={{ color: pnlColor(pnl), fontFamily: 'var(--font-geist-mono)', fontSize: 12 }}>
      {isPos ? '+' : ''}{formatMoney(pnl)}
      {aum >= 1 && (
        <span style={{ opacity: 0.7, marginLeft: 6 }}>
          ({formatPercent(pnlPct)})
        </span>
      )}
    </span>
  )
}

function CardName({ name, bold }: { name: string; bold?: boolean }) {
  return (
    <div style={{
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: 'var(--text-muted)',
      marginBottom: 6,
      fontWeight: bold ? 700 : 500,
      opacity: bold ? 1 : 0.85,
    }}>
      {name}
    </div>
  )
}

function CardAum({ aum }: { aum: number }) {
  return (
    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-geist-mono)', color: 'var(--text-primary)', marginBottom: 4 }}>
      {formatMoney(aum)}
    </div>
  )
}

// cardFlex: true  → flex:1 (fills remaining space in a flex row)
// cardFlex: false → flex:'0 0 calc(20% - 6.4px)' (fixed 1/5-column for scroll variant)
function AccountCard({ fund, isTotal, cardFlex }: { fund: FundSummary; isTotal?: boolean; cardFlex?: boolean }) {
  return (
    <div style={{
      ...(cardFlex
        ? { flex: 1, minWidth: 0 }
        : { flex: '0 0 calc(20% - 6.4px)', minWidth: 130 }
      ),
      background: 'var(--bg-secondary)',
      border: `1px solid ${isTotal ? 'var(--accent-gold)' : 'var(--border-subtle)'}`,
      borderTop: `3px solid ${isTotal ? 'var(--accent-gold)' : 'var(--border-subtle)'}`,
      padding: '12px 14px',
      borderRadius: 4,
      flexShrink: cardFlex ? undefined : 0,
    }}>
      <CardName name={fund.fund} bold={isTotal} />
      <CardAum aum={fund.aum} />
      <PnlLine aum={fund.aum} pnl={fund.totalPnl} pnlPct={fund.pnlPct} />
    </div>
  )
}

const Divider = () => (
  <div style={{ width: 1, flexShrink: 0, background: 'var(--border-medium)', margin: '4px 0' }} />
)

// ─── A1: Arrow navigation ─────────────────────────────────────────────────────
// Outer layout: [←] [5 cards flex:1 each | flex:5 total] [→] [|] [Total flex:1]
// Cards container flex:5, Total flex:1 → each card ≈ same width as Total

const VISIBLE = 5

function LayoutArrows({ sorted, total }: { sorted: FundSummary[]; total: FundSummary }) {
  const [offset, setOffset] = useState(0)
  const canPrev = offset > 0
  const canNext = offset + VISIBLE < sorted.length
  const visible = sorted.slice(offset, offset + VISIBLE)

  const ArrowBtn = ({ dir }: { dir: 'prev' | 'next' }) => {
    const disabled = dir === 'prev' ? !canPrev : !canNext
    return (
      <button
        onClick={() => setOffset((o) => dir === 'prev' ? o - 1 : o + 1)}
        disabled={disabled}
        style={{
          flexShrink: 0,
          width: 28,
          alignSelf: 'stretch',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 4,
          cursor: disabled ? 'default' : 'pointer',
          color: disabled ? 'var(--border-medium)' : 'var(--text-muted)',
        }}
        onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = disabled ? 'var(--border-medium)' : 'var(--text-muted)' }}
      >
        {dir === 'prev' ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      {sorted.length > VISIBLE && <ArrowBtn dir="prev" />}

      {/* 5 visible accounts — flex:5 so each card ≈ same width as Total (flex:1) */}
      <div style={{ display: 'flex', gap: 8, flex: 5, minWidth: 0 }}>
        {visible.map((f) => (
          <AccountCard key={f.fund} fund={f} cardFlex />
        ))}
        {/* Ghost spacers when fewer than VISIBLE accounts */}
        {visible.length < VISIBLE && Array.from({ length: VISIBLE - visible.length }).map((_, i) => (
          <div key={i} style={{ flex: 1 }} />
        ))}
      </div>

      {sorted.length > VISIBLE && <ArrowBtn dir="next" />}

      {sorted.length > 1 && <Divider />}

      {/* Total — flex:1, matches visual width of one account card */}
      {sorted.length > 1 && <AccountCard fund={total} isTotal cardFlex />}
    </div>
  )
}

// ─── A2: Scrollbar navigation ─────────────────────────────────────────────────
// Outer layout: [scroll section flex:5] [|] [Total flex:1]
// Each account card: flex:'0 0 calc(20% - 6.4px)' → top-5 fill viewport, rest accessible via scroll
// Total flex:1 in outer ≈ same visual width as one account card

function LayoutScroll({ sorted, total }: { sorted: FundSummary[]; total: FundSummary }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      {/* Scrollable accounts — flex:5 so Total (flex:1) matches one card width */}
      <div style={{ flex: 5, minWidth: 0, display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {sorted.map((f) => (
          <AccountCard key={f.fund} fund={f} />
        ))}
      </div>

      {sorted.length > 1 && <Divider />}

      {/* Total — same visual width as one account card */}
      {sorted.length > 1 && <AccountCard fund={total} isTotal cardFlex />}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function FundCards({ funds, loading }: FundCardsProps) {
  const [nav, setNav] = useState<NavVariant>('arrows')

  if (loading) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="animate-pulse" style={{ height: 80, flex: 1, borderRadius: 4, background: 'var(--bg-secondary)' }} />
          ))}
          <div className="animate-pulse" style={{ height: 80, flex: 1, borderRadius: 4, background: 'var(--bg-secondary)', opacity: 0.5 }} />
        </div>
      </div>
    )
  }

  if (funds.length === 0) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        No accounts synced yet. Add accounts in API Settings and run Sync.
      </div>
    )
  }

  const sorted = [...funds].sort((a, b) => (b.tradeCount ?? 0) - (a.tradeCount ?? 0))
  const totalAum = funds.reduce((s, f) => s + f.aum, 0)
  const totalPnl = funds.reduce((s, f) => s + f.totalPnl, 0)
  const totalPct = totalAum >= 1 ? (totalPnl / totalAum) * 100 : 0
  const totalFund: FundSummary = { fund: 'Total Portfolio', aum: totalAum, totalPnl, pnlPct: totalPct }

  return (
    <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
      {/* Nav sub-variant toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Nav
        </span>
        {(['arrows', 'scroll'] as NavVariant[]).map((v) => (
          <button
            key={v}
            onClick={() => setNav(v)}
            style={{
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.05em',
              border: '1px solid var(--border-subtle)',
              borderRadius: 3,
              cursor: 'pointer',
              background: nav === v ? 'var(--bg-elevated)' : 'transparent',
              color: nav === v ? 'var(--text-primary)' : 'var(--text-muted)',
              outline: nav === v ? '1px solid var(--accent-profit)' : 'none',
              outlineOffset: -1,
            }}
          >
            {v === 'arrows' ? '‹ ›' : '⋯'}
          </button>
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {nav === 'arrows' ? '— arrow navigation' : '— scrollbar'}
        </span>
      </div>

      {nav === 'arrows'
        ? <LayoutArrows sorted={sorted} total={totalFund} />
        : <LayoutScroll sorted={sorted} total={totalFund} />
      }
    </div>
  )
}
