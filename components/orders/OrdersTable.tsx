'use client'

import { useState, useMemo } from 'react'
import type { Trade } from '@/lib/types'
import { EXCHANGES } from '@/lib/mock-data'
import { formatMoney, formatPrice, cn } from '@/lib/utils'
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

interface OrdersTableProps {
  trades: Trade[]
  pageSize?: number
  accountNameMap?: Record<string, string>
}

// ─── Action derivation ────────────────────────────────────────────────────────

type ActionLabel = 'Open Long' | 'Close Long' | 'Open Short' | 'Close Short'

function getActionLabel(side: 'long' | 'short', isOpen: boolean): ActionLabel {
  if (isOpen)  return side === 'long' ? 'Open Long'  : 'Open Short'
  return side === 'long' ? 'Close Long' : 'Close Short'
}

// Open Long  → bullish entry  → green
// Close Long → exiting long   → red
// Open Short → bearish entry  → red
// Close Short→ exiting short  → green
function actionColor(action: ActionLabel): string {
  return action === 'Open Long' || action === 'Close Short'
    ? 'var(--accent-profit)'
    : 'var(--accent-loss)'
}

// ─── Display row ──────────────────────────────────────────────────────────────

interface DisplayRow {
  id:          string
  time:        string   // ISO — used for sorting
  symbol:      string
  action:      ActionLabel
  price:       number
  amount:      number
  usdValue:    number
  fee:         number
  pnl:         number | null  // null for open rows
  exchangeId:  string
  subAccountId: string
  tradeType:   string
}

// A Bybit futures record has a real openedAt ≠ closedAt → expand to 2 rows.
// Binance fills have openedAt === closedAt → pnl=0 means open, pnl≠0 means close.
function toDisplayRows(trades: Trade[]): DisplayRow[] {
  const rows: DisplayRow[] = []

  for (const t of trades) {
    const side = t.side as 'long' | 'short'
    const isBybitPosition = t.tradeType === 'futures' && t.openedAt !== t.closedAt

    if (isBybitPosition) {
      // Open row (virtual)
      rows.push({
        id:          `${t.id}_open`,
        time:        t.openedAt,
        symbol:      t.symbol,
        action:      getActionLabel(side, true),
        price:       t.entryPrice,
        amount:      t.quantity,
        usdValue:    t.quantity * t.entryPrice,
        fee:         0,
        pnl:         null,
        exchangeId:  t.exchangeId,
        subAccountId: t.subAccountId,
        tradeType:   t.tradeType,
      })
      // Close row
      rows.push({
        id:          `${t.id}_close`,
        time:        t.closedAt,
        symbol:      t.symbol,
        action:      getActionLabel(side, false),
        price:       t.exitPrice,
        amount:      t.quantity,
        usdValue:    t.quantity * t.exitPrice,
        fee:         t.fee,
        pnl:         t.pnl,
        exchangeId:  t.exchangeId,
        subAccountId: t.subAccountId,
        tradeType:   t.tradeType,
      })
    } else {
      // Binance / spot fill: pnl=0 → open, pnl≠0 → close
      const isOpen = t.pnl === 0
      rows.push({
        id:          t.id,
        time:        t.closedAt,
        symbol:      t.symbol,
        action:      getActionLabel(side, isOpen),
        price:       t.exitPrice,
        amount:      t.quantity,
        usdValue:    t.quantity * t.exitPrice,
        fee:         t.fee,
        pnl:         isOpen ? null : t.pnl,
        exchangeId:  t.exchangeId,
        subAccountId: t.subAccountId,
        tradeType:   t.tradeType,
      })
    }
  }

  return rows
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit:   '#FF6B2C',
  okx:     '#4F8EF7',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const date = d.toISOString().slice(0, 10)
  const time = d.toISOString().slice(11, 16)
  return `${date} ${time}`
}

function getSubAccountName(id: string, accountNameMap?: Record<string, string>): string {
  if (accountNameMap?.[id]) return accountNameMap[id]
  for (const ex of EXCHANGES) {
    const sa = ex.subAccounts.find((s) => s.id === id)
    if (sa) return sa.name
  }
  return id
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

type SortKey = 'time' | 'symbol' | 'action' | 'price' | 'amount' | 'usdValue' | 'fee' | 'pnl' | 'account'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />
  return sort.dir === 'asc'
    ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--accent-blue)' }} />
    : <ChevronDown className="w-3 h-3" style={{ color: 'var(--accent-blue)' }} />
}

const COLUMNS: { label: string; key: SortKey }[] = [
  { label: 'Time',       key: 'time' },
  { label: 'Symbol',     key: 'symbol' },
  { label: 'Action',     key: 'action' },
  { label: 'Price',      key: 'price' },
  { label: 'Amount',     key: 'amount' },
  { label: 'USD Value',  key: 'usdValue' },
  { label: 'Fee',        key: 'fee' },
  { label: 'PnL',        key: 'pnl' },
  { label: 'Account',    key: 'account' },
]

type ActionFilter = 'all' | ActionLabel

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersTable({ trades, pageSize = 50, accountNameMap }: OrdersTableProps) {
  const PAGE_SIZE = pageSize
  const [sort, setSort]           = useState<{ key: SortKey; dir: SortDir }>({ key: 'time', dir: 'desc' })
  const [page, setPage]           = useState(1)
  const [search, setSearch]       = useState('')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')

  // Expand Trade[] → DisplayRow[]
  const allRows = useMemo(() => toDisplayRows(trades), [trades])

  // Filter by search + action
  const filtered = useMemo(() => {
    let rows = allRows
    if (actionFilter !== 'all') {
      rows = rows.filter((r) => r.action === actionFilter)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (r) =>
          r.symbol.toLowerCase().includes(q) ||
          r.action.toLowerCase().includes(q) ||
          r.exchangeId.toLowerCase().includes(q) ||
          getSubAccountName(r.subAccountId, accountNameMap).toLowerCase().includes(q),
      )
    }
    return rows
  }, [allRows, actionFilter, search, accountNameMap])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: number | string, vb: number | string
      switch (sort.key) {
        case 'time':     va = a.time;     vb = b.time;     break
        case 'symbol':   va = a.symbol;   vb = b.symbol;   break
        case 'action':   va = a.action;   vb = b.action;   break
        case 'price':    va = a.price;    vb = b.price;    break
        case 'amount':   va = a.amount;   vb = b.amount;   break
        case 'usdValue': va = a.usdValue; vb = b.usdValue; break
        case 'fee':      va = a.fee;      vb = b.fee;      break
        case 'pnl':      va = a.pnl ?? 0; vb = b.pnl ?? 0; break
        case 'account':  va = a.exchangeId + a.subAccountId; vb = b.exchangeId + b.subAccountId; break
        default:         va = a.time;     vb = b.time
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
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    )
    setPage(1)
  }

  const handleSearch = (v: string) => { setSearch(v); setPage(1) }
  const handleAction = (v: ActionFilter) => { setActionFilter(v); setPage(1) }

  const selectStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-medium)',
    color: 'var(--text-primary)',
    borderRadius: 2,
  }

  return (
    <div
      className="mx-6 mb-6 overflow-hidden"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
    >
      {/* Header bar */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Order History</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {filtered.length.toLocaleString()} rows
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Action filter */}
          <select
            value={actionFilter}
            onChange={(e) => handleAction(e.target.value as ActionFilter)}
            className="text-xs px-2.5 py-1.5 outline-none cursor-pointer"
            style={selectStyle}
          >
            <option value="all">All Actions</option>
            <option value="Open Long">Open Long</option>
            <option value="Close Long">Close Long</option>
            <option value="Open Short">Open Short</option>
            <option value="Close Short">Close Short</option>
          </select>
          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search symbol, account…"
            className="text-xs px-3 py-1.5 outline-none w-48"
            style={selectStyle}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-blue)' }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--border-medium)' }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {COLUMNS.map(({ label, key }) => (
                <th
                  key={label}
                  onClick={() => handleSort(key)}
                  className="px-4 py-3 text-left font-medium whitespace-nowrap select-none cursor-pointer transition-colors"
                  style={{ color: sort.key === key ? 'var(--text-primary)' : 'var(--text-muted)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = sort.key === key ? 'var(--text-primary)' : 'var(--text-muted)' }}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <SortIcon col={key} sort={sort} />
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
              paginated.map((row) => {
                const exColor  = EXCHANGE_COLORS[row.exchangeId] ?? 'var(--text-secondary)'
                const acColor  = actionColor(row.action)
                const pnlColor = row.pnl === null ? undefined : row.pnl >= 0 ? 'var(--accent-profit)' : 'var(--accent-loss)'

                return (
                  <tr
                    key={row.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    {/* Time */}
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {formatDateTime(row.time)}
                    </td>

                    {/* Symbol */}
                    <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                      {row.symbol}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-semibold" style={{ color: acColor }}>
                        {row.action}
                      </span>
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap font-mono" style={{ color: 'var(--text-secondary)' }}>
                      ${formatPrice(row.price)}
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {row.amount.toFixed(row.amount < 1 ? 6 : row.amount < 100 ? 4 : 2)}
                    </td>

                    {/* USD Value */}
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {formatMoney(row.usdValue)}
                    </td>

                    {/* Fee */}
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap font-mono" style={{ color: row.fee > 0 ? 'var(--accent-loss)' : 'var(--text-muted)', opacity: row.fee > 0 ? 0.8 : 0.4 }}>
                      {row.fee > 0 ? `-$${row.fee.toFixed(4)}` : '$0.0000'}
                    </td>

                    {/* PnL */}
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap font-mono font-semibold">
                      {row.pnl === null ? (
                        <span style={{ color: 'var(--text-muted)', opacity: 0.3 }}>—</span>
                      ) : (
                        <span style={{ color: pnlColor }}>
                          {row.pnl >= 0 ? '+' : ''}{formatMoney(row.pnl, false, 2)}
                        </span>
                      )}
                    </td>

                    {/* Account */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: exColor }} />
                        <span className="capitalize font-medium" style={{ color: exColor }}>
                          {row.exchangeId}
                        </span>
                        <span style={{ color: 'var(--border-medium)' }}>/</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {getSubAccountName(row.subAccountId, accountNameMap)}
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
          {Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length.toLocaleString()} rows
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let p: number
            if (totalPages <= 5)                   p = i + 1
            else if (safePage <= 3)                p = i + 1
            else if (safePage >= totalPages - 2)   p = totalPages - 4 + i
            else                                   p = safePage - 2 + i
            const active = p === safePage
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className="w-7 h-7 text-xs font-medium"
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
            className="p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
