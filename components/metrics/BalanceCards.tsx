'use client'

import { useMemo } from 'react'
import { EXCHANGES } from '@/lib/mock-data'
import { getAllDailyPnL } from '@/lib/mock-data'
import { formatMoney, formatPercent } from '@/lib/utils'

// Approximate initial capital allocation per sub-account
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
    const totalAlloc = 6_800_000
    return { balance: totalBalance, pnl: totalPnl, pnlPct: (totalPnl / totalAlloc) * 100 }
  }, [summaries])

  return (
    <div
      className="px-4 py-2 grid grid-cols-2 lg:grid-cols-4 gap-px"
      style={{ background: 'var(--border-subtle)' }}
    >
      {summaries.map(({ ex, balance, pnl, pnlPct, subCount }) => {
        const isPos = pnl >= 0
        return (
          <div
            key={ex.id}
            className="px-4 py-3 flex flex-col gap-1.5"
            style={{ background: 'var(--bg-secondary)', borderLeft: `2px solid ${ex.color}` }}
          >
            {/* Exchange header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: ex.color }}>
                {ex.name}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {subCount} {subCount === 1 ? 'account' : 'accounts'}
              </span>
            </div>

            {/* Balance */}
            <div className="font-mono text-base font-bold tracking-tight leading-none" style={{ color: 'var(--text-primary)' }}>
              {formatMoney(balance)}
            </div>

            {/* PnL row */}
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-xs"
                style={{ color: isPos ? 'var(--accent-profit)' : 'var(--accent-loss)' }}
              >
                {isPos ? '+' : ''}{formatMoney(pnl)}
              </span>
              <span
                className="text-[10px]"
                style={{ color: isPos ? 'var(--accent-profit)' : 'var(--accent-loss)', opacity: 0.7 }}
              >
                ({isPos ? '+' : ''}{formatPercent(pnlPct)})
              </span>
            </div>
          </div>
        )
      })}

      {/* Total card */}
      <div
        className="px-4 py-3 flex flex-col gap-1.5"
        style={{ background: 'var(--bg-secondary)', borderLeft: '2px solid var(--accent-gold)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'var(--accent-gold)' }}>
            Portfolio
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            7 accounts
          </span>
        </div>

        <div className="font-mono text-base font-bold tracking-tight leading-none" style={{ color: 'var(--text-primary)' }}>
          {formatMoney(total.balance)}
        </div>

        <div className="flex items-center gap-2">
          <span
            className="font-mono text-xs"
            style={{ color: total.pnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)' }}
          >
            {total.pnl >= 0 ? '+' : ''}{formatMoney(total.pnl)}
          </span>
          <span
            className="text-[10px]"
            style={{ color: total.pnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)', opacity: 0.7 }}
          >
            ({total.pnl >= 0 ? '+' : ''}{formatPercent(total.pnlPct)})
          </span>
        </div>
      </div>
    </div>
  )
}
