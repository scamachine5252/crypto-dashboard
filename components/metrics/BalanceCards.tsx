'use client'

import { useMemo } from 'react'
import { EXCHANGES, getAllDailyPnL } from '@/lib/mock-data'
import { formatMoney, formatPercent } from '@/lib/utils'

const CAPITAL_PER_SUB = 6_800_000 / 7

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
      return { ex, balance, pnl: exPnl, pnlPct, subCount: ex.subAccounts.length }
    })
  }, [])

  const total = useMemo(() => {
    const totalPnl = summaries.reduce((s, r) => s + r.pnl, 0)
    const totalBalance = summaries.reduce((s, r) => s + r.balance, 0)
    return { balance: totalBalance, pnl: totalPnl, pnlPct: (totalPnl / 6_800_000) * 100 }
  }, [summaries])

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px" style={{ background: 'var(--border-subtle)' }}>
      {summaries.map(({ ex, balance, pnl, pnlPct, subCount }) => (
        <ExchangeCard
          key={ex.id}
          label={ex.name}
          accentColor={ex.color}
          balance={balance}
          pnl={pnl}
          pnlPct={pnlPct}
          subCount={subCount}
        />
      ))}
      <ExchangeCard
        label="Portfolio"
        accentColor="var(--accent-gold)"
        balance={total.balance}
        pnl={total.pnl}
        pnlPct={total.pnlPct}
        subCount={7}
      />
    </div>
  )
}

interface ExchangeCardProps {
  label: string
  accentColor: string
  balance: number
  pnl: number
  pnlPct: number
  subCount: number
}

function ExchangeCard({ label, accentColor, balance, pnl, pnlPct, subCount }: ExchangeCardProps) {
  const isPos = pnl >= 0
  const pnlColor = isPos ? 'var(--accent-profit)' : 'var(--accent-loss)'

  return (
    <div
      className="px-4 py-3 flex flex-col gap-2"
      style={{ background: 'var(--bg-secondary)', borderLeft: `2px solid ${accentColor}` }}
    >
      {/* Exchange name + account count */}
      <div className="flex items-center justify-between">
        {/* Bold Inter, larger — institutional terminal look */}
        <span
          className="text-sm font-bold uppercase tracking-widest"
          style={{ color: accentColor, fontFamily: 'var(--font-inter)' }}
        >
          {label}
        </span>
        <span
          className="text-xs tracking-wide"
          style={{ color: 'var(--text-muted)' }}
        >
          {subCount} {subCount === 1 ? 'acct' : 'accts'}
        </span>
      </div>

      {/* Balance — large Geist Mono */}
      <div
        className="font-mono text-2xl font-bold leading-none tabular"
        style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
      >
        {formatMoney(balance)}
      </div>

      {/* PnL row */}
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-sm font-semibold"
          style={{ color: pnlColor }}
        >
          {isPos ? '+' : ''}{formatMoney(pnl)}
        </span>
        <span
          className="text-xs tracking-wide"
          style={{ color: pnlColor, opacity: 0.65 }}
        >
          {isPos ? '+' : ''}{formatPercent(pnlPct)}
        </span>
      </div>
    </div>
  )
}
