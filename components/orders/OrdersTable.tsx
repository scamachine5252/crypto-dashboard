'use client'

import { useState, useMemo } from 'react'
import type { Trade } from '@/lib/types'
import { EXCHANGES } from '@/lib/mock-data'
import { formatMoney, formatPrice, formatDate, cn } from '@/lib/utils'
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

interface OrdersTableProps {
  trades: Trade[]
  pageSize?: number
}

type SortKey = 'closedAt' | 'symbol' | 'pnl' | 'fee' | 'quantity'
type SortDir = 'asc' | 'desc'

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit:   '#FF6B2C',
  okx:     '#4F8EF7',
}

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />
  return sort.dir === 'asc'
    ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--accent-blue)' }} />
    : <ChevronDown className="w-3 h-3" style={{ color: 'var(--accent-blue)' }} />
}

function getSubAccountName(id: string): string {
  for (const ex of EXCHANGES) {
    const sa = ex.subAccounts.find((s) => s.id === id)
    if (sa) return sa.name
  }
  return id
}

const COLUMNS: { label: string; key: SortKey | null }[] = [
  { label: 'Date/Time',         key: 'closedAt' },
  { label: 'Symbol',            key: 'symbol' },
  { label: 'Order Type',        key: null },
  { label: 'Side',              key: null },
  { label: 'Filled Qty',        key: 'quantity' },
  { label: 'Filled Value',      key: null },
  { label: 'Realized PnL',      key: 'pnl' },
  { label: 'Fee',               key: 'fee' },
  { label: 'Exchange / Account', key: null },
]

export default function OrdersTable({ trades, pageSize = 15 }: OrdersTableProps) {
  const PAGE_SIZE = pageSize
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'closedAt', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return trades
    return trades.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.side.toLowerCase().includes(q) ||
        t.tradeType.toLowerCase().includes(q) ||
        t.exchangeId.toLowerCase().includes(q) ||
        getSubAccountName(t.subAccountId).toLowerCase().includes(q)
    )
  }, [trades, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: number | string, vb: number | string
      switch (sort.key) {
        case 'closedAt':  va = a.closedAt;  vb = b.closedAt;  break
        case 'symbol':    va = a.symbol;    vb = b.symbol;    break
        case 'pnl':       va = a.pnl;       vb = b.pnl;       break
        case 'fee':       va = a.fee;       vb = b.fee;       break
        case 'quantity':  va = a.quantity;  vb = b.quantity;  break
        default:          va = a.closedAt;  vb = b.closedAt
      }
      if (va < vb) return sort.dir === 'asc' ? -1 : 1
      if (va > vb) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [filtered, sort])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paginated  = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const handleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
    )
    setPage(1)
  }

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }

  return (
    <div
      className="mx-6 mb-6 overflow-hidden"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
    >
      {/* Table header bar */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Order History</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {filtered.length.toLocaleString()} trades
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search symbol, exchange…"
          className="text-xs px-3 py-1.5 outline-none w-52"
          style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            borderRadius: 2,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)' }}
          onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border-medium)' }}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {COLUMNS.map(({ label, key }) => (
                <th
                  key={label}
                  onClick={() => key && handleSort(key)}
                  className={cn(
                    'px-4 py-3 text-left font-medium whitespace-nowrap select-none',
                    key ? 'cursor-pointer transition-colors' : '',
                  )}
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => { if (key) (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { if (key) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {key && <SortIcon col={key} sort={sort} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center" style={{ color: 'var(--text-muted)' }}>
                  No trades found
                </td>
              </tr>
            ) : (
              paginated.map((trade) => {
                const isWin   = trade.pnl > 0
                const exColor = EXCHANGE_COLORS[trade.exchangeId] ?? 'var(--text-secondary)'
                const filledValue = trade.quantity * trade.entryPrice

                return (
                  <tr
                    key={trade.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    {/* Date/Time */}
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(trade.closedAt)}
                    </td>

                    {/* Symbol */}
                    <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                      {trade.symbol}
                    </td>

                    {/* Order Type */}
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: 'var(--bg-elevated)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {trade.tradeType}
                      </span>
                    </td>

                    {/* Side */}
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: trade.side === 'long'
                            ? 'rgba(0,255,65,0.08)'
                            : 'rgba(255,68,68,0.08)',
                          color: trade.side === 'long'
                            ? 'var(--accent-profit)'
                            : 'var(--accent-loss)',
                        }}
                      >
                        {trade.side}
                      </span>
                    </td>

                    {/* Filled Qty */}
                    <td
                      className="px-4 py-3 tabular-nums whitespace-nowrap"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {trade.quantity.toFixed(4)}
                    </td>

                    {/* Filled Value */}
                    <td
                      className="px-4 py-3 tabular-nums whitespace-nowrap"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {formatMoney(filledValue)}
                    </td>

                    {/* Realized PnL */}
                    <td className="px-4 py-3 font-semibold tabular-nums whitespace-nowrap">
                      <span style={{ color: isWin ? 'var(--accent-profit)' : 'var(--accent-loss)' }}>
                        {isWin ? '+' : ''}{formatMoney(trade.pnl)}
                      </span>
                    </td>

                    {/* Fee */}
                    <td
                      className="px-4 py-3 tabular-nums whitespace-nowrap"
                      style={{ color: 'var(--accent-loss)', opacity: 0.7 }}
                    >
                      -{formatMoney(trade.fee)}
                    </td>

                    {/* Exchange / Account */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: exColor }}
                        />
                        <span className="capitalize font-medium" style={{ color: exColor }}>
                          {trade.exchangeId}
                        </span>
                        <span style={{ color: 'var(--border-medium)' }}>/</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {getSubAccountName(trade.subAccountId)}
                        </span>
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Showing {Math.min((safePage - 1) * PAGE_SIZE + 1, sorted.length)}–
          {Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length.toLocaleString()} trades
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="p-1.5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let p: number
            if (totalPages <= 5)          p = i + 1
            else if (safePage <= 3)       p = i + 1
            else if (safePage >= totalPages - 2) p = totalPages - 4 + i
            else                          p = safePage - 2 + i
            const active = p === safePage
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className="w-7 h-7 text-xs font-medium transition-all"
                style={{
                  background: active ? 'var(--accent-blue)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-secondary)',
                }}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                {p}
              </button>
            )
          })}

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="p-1.5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
