'use client'

import type { ComparisonRow } from '@/lib/types'
import { EXCHANGES, ACCOUNT_COLORS } from '@/lib/mock-data'
import { formatMoney, formatRatio } from '@/lib/utils'

interface ComparisonTableProps {
  rows: ComparisonRow[]
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
type DeltaPolarity = 'higher-better' | 'lower-better'

interface ColDef {
  header: string
  value: (r: ComparisonRow) => number
  format: (v: number) => string
  delta: (r: ComparisonRow) => number | null
  polarity: DeltaPolarity
}

const fmt = {
  pct:    (v: number) => `${v.toFixed(1)}%`,
  ratio:  (v: number) => formatRatio(v),
  money:  (v: number) => formatMoney(v),
  rr:     (v: number) => v.toFixed(2),
  int:    (v: number) => String(Math.round(v)),
}

const COLS: ColDef[] = [
  { header: 'Total PnL',     value: (r) => r.totalPnl,      format: fmt.money,  delta: (r) => r.delta.totalPnl,      polarity: 'higher-better' },
  { header: 'Annual Yield',  value: (r) => r.annualYield,   format: fmt.pct,    delta: (r) => r.delta.annualYield,   polarity: 'higher-better' },
  { header: 'Sharpe',        value: (r) => r.sharpeRatio,   format: fmt.ratio,  delta: (r) => r.delta.sharpeRatio,   polarity: 'higher-better' },
  { header: 'Sortino',       value: (r) => r.sortinoRatio,  format: fmt.ratio,  delta: (r) => r.delta.sortinoRatio,  polarity: 'higher-better' },
  { header: 'Max DD',        value: (r) => r.maxDrawdownPct,format: fmt.pct,    delta: (r) => r.delta.maxDrawdownPct,polarity: 'lower-better'  },
  { header: 'Win Rate',      value: (r) => r.winRate,       format: fmt.pct,    delta: (r) => r.delta.winRate,       polarity: 'higher-better' },
  { header: 'Profit Factor', value: (r) => r.profitFactor,  format: fmt.ratio,  delta: (r) => r.delta.profitFactor,  polarity: 'higher-better' },
  { header: 'Avg Win',       value: (r) => r.averageWin,    format: fmt.money,  delta: (r) => r.delta.averageWin,    polarity: 'higher-better' },
  { header: 'Avg Loss',      value: (r) => r.averageLoss,   format: fmt.money,  delta: (r) => r.delta.averageLoss,   polarity: 'lower-better'  },
  { header: 'Risk/Reward',   value: (r) => r.riskReward,    format: fmt.rr,     delta: (r) => r.delta.riskReward,    polarity: 'higher-better' },
  { header: 'Total Fees',    value: (r) => r.totalFees,     format: fmt.money,  delta: (r) => r.delta.totalFees,     polarity: 'lower-better'  },
  { header: 'Trades',        value: (r) => r.totalTrades,   format: fmt.int,    delta: (r) => r.delta.totalTrades,   polarity: 'higher-better' },
]

// ---------------------------------------------------------------------------
// Exchange color lookup
// ---------------------------------------------------------------------------
const EXCHANGE_COLORS: Record<string, string> = {}
EXCHANGES.forEach((ex) => { EXCHANGE_COLORS[ex.id] = ex.color })

// ---------------------------------------------------------------------------
// Delta cell
// ---------------------------------------------------------------------------
function DeltaCell({ delta, polarity, format }: { delta: number | null; polarity: DeltaPolarity; format: (v: number) => string }) {
  if (delta === null) return null  // baseline row — no delta shown

  if (delta === 0) {
    return (
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>—</div>
    )
  }

  // For lower-better metrics, invert sign for color: negative delta = improvement
  const isGood = polarity === 'higher-better' ? delta > 0 : delta < 0
  const color = isGood ? 'var(--accent-profit)' : 'var(--accent-loss)'
  const prefix = delta > 0 ? '+' : ''

  return (
    <div style={{ fontSize: 9, color, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
      {prefix}{format(delta)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ComparisonTable({ rows }: ComparisonTableProps) {
  if (rows.length === 0) {
    return (
      <div
        className="mx-4 mb-4 flex items-center justify-center"
        style={{ height: 120, border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Select accounts to compare</p>
      </div>
    )
  }

  return (
    <div
      className="mx-4 mb-4 overflow-x-auto"
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {/* Sticky account column header */}
            <th
              className="px-4 py-3 text-left font-medium whitespace-nowrap"
              style={{
                position: 'sticky',
                left: 0,
                zIndex: 1,
                background: 'var(--bg-secondary)',
                color: 'var(--text-muted)',
                borderRight: '1px solid var(--border-subtle)',
              }}
            >
              Account
            </th>
            {COLS.map((col) => (
              <th
                key={col.header}
                className="px-4 py-3 text-right font-medium whitespace-nowrap"
                style={{ color: 'var(--text-muted)', background: 'var(--bg-secondary)' }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const dotColor = ACCOUNT_COLORS[row.subAccountId] ?? EXCHANGE_COLORS[row.exchangeId] ?? '#888'

            return (
              <tr
                key={row.subAccountId}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  borderLeft: row.isBaseline ? '2px solid var(--accent-gold)' : '2px solid transparent',
                  background: row.isBaseline ? 'var(--bg-elevated)' : 'transparent',
                }}
              >
                {/* Sticky account column */}
                <td
                  className="px-4 py-3 whitespace-nowrap"
                  style={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    background: row.isBaseline ? 'var(--bg-elevated)' : 'var(--bg-secondary)',
                    borderRight: '1px solid var(--border-subtle)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: dotColor }}
                    />
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {row.name}
                    </span>
                    {row.isBaseline && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5"
                        style={{
                          color: 'var(--accent-gold)',
                          border: '1px solid var(--accent-gold)',
                          borderRadius: 2,
                          opacity: 0.8,
                        }}
                      >
                        Baseline
                      </span>
                    )}
                  </div>
                </td>

                {/* Metric columns */}
                {COLS.map((col) => {
                  const v = col.value(row)
                  const d = col.delta(row)

                  // Color the main value for PnL and Annual Yield
                  let mainColor: string = 'var(--text-primary)'
                  if (col.header === 'Total PnL' || col.header === 'Annual Yield') {
                    mainColor = v >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)'
                  } else if (col.header === 'Max DD' || col.header === 'Total Fees') {
                    mainColor = 'var(--accent-loss)'
                  }

                  return (
                    <td
                      key={col.header}
                      className="px-4 py-3 text-right whitespace-nowrap"
                      style={{ verticalAlign: 'top' }}
                    >
                      <div
                        className="font-mono font-semibold tabular-nums"
                        style={{ color: mainColor, fontSize: 11 }}
                      >
                        {col.format(v)}
                      </div>
                      <DeltaCell delta={d} polarity={col.polarity} format={col.format} />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
