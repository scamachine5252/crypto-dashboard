'use client'

import { useState, useMemo } from 'react'
import type { Trade } from '@/lib/types'
import { EXCHANGES } from '@/lib/mock-data'
import { formatMoney, formatPrice, formatDate, cn } from '@/lib/utils'
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'

interface OrdersTableProps {
  trades: Trade[]
}

type SortKey = 'closedAt' | 'symbol' | 'pnl' | 'fee' | 'pnlPercent'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 15

const EXCHANGE_COLORS: Record<string, string> = {
  binance: '#F0B90B',
  bybit: '#FF6B2C',
  okx: '#4F8EF7',
}

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <ChevronsUpDown className="w-3 h-3 opacity-30" />
  return sort.dir === 'asc' ? (
    <ChevronUp className="w-3 h-3 text-blue-400" />
  ) : (
    <ChevronDown className="w-3 h-3 text-blue-400" />
  )
}

function getSubAccountName(id: string): string {
  for (const ex of EXCHANGES) {
    const sa = ex.subAccounts.find((s) => s.id === id)
    if (sa) return sa.name
  }
  return id
}

export default function OrdersTable({ trades }: OrdersTableProps) {
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
        t.exchangeId.toLowerCase().includes(q) ||
        getSubAccountName(t.subAccountId).toLowerCase().includes(q)
    )
  }, [trades, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: number | string, vb: number | string
      switch (sort.key) {
        case 'closedAt': va = a.closedAt; vb = b.closedAt; break
        case 'symbol': va = a.symbol; vb = b.symbol; break
        case 'pnl': va = a.pnl; vb = b.pnl; break
        case 'fee': va = a.fee; vb = b.fee; break
        case 'pnlPercent': va = a.pnlPercent; vb = b.pnlPercent; break
        default: va = a.closedAt; vb = b.closedAt
      }
      if (va < vb) return sort.dir === 'asc' ? -1 : 1
      if (va > vb) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [filtered, sort])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

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
    <div className="mx-6 mb-6 bg-[#0a1628] border border-[#152035] rounded-xl overflow-hidden">
      {/* Table header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#152035]">
        <div>
          <p className="text-[#e8f0fe] text-sm font-semibold">Order History</p>
          <p className="text-[#4d6b8e] text-xs mt-0.5">
            {filtered.length.toLocaleString()} trades
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search symbol, exchange…"
          className="bg-[#0f1e32] border border-[#1a2d45] text-[#e8f0fe] placeholder-[#4d6b8e] rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-500 w-52"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#152035]">
              {[
                { label: 'Symbol', key: 'symbol' as SortKey },
                { label: 'Side', key: null },
                { label: 'Entry', key: null },
                { label: 'Exit', key: null },
                { label: 'PnL', key: 'pnl' as SortKey },
                { label: 'PnL %', key: 'pnlPercent' as SortKey },
                { label: 'Fee', key: 'fee' as SortKey },
                { label: 'Exchange / Account', key: null },
                { label: 'Closed', key: 'closedAt' as SortKey },
              ].map(({ label, key }) => (
                <th
                  key={label}
                  onClick={() => key && handleSort(key)}
                  className={cn(
                    'px-4 py-3 text-left font-medium text-[#4d6b8e] whitespace-nowrap select-none',
                    key ? 'cursor-pointer hover:text-[#8ba3c7] transition-colors' : ''
                  )}
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
                <td colSpan={9} className="px-4 py-10 text-center text-[#4d6b8e]">
                  No trades found
                </td>
              </tr>
            ) : (
              paginated.map((trade) => {
                const isWin = trade.pnl > 0
                const exColor = EXCHANGE_COLORS[trade.exchangeId] ?? '#8ba3c7'
                return (
                  <tr
                    key={trade.id}
                    className="border-b border-[#0f1e32] hover:bg-[#0f1e32] transition-colors"
                  >
                    {/* Symbol */}
                    <td className="px-4 py-3 font-medium text-[#e8f0fe] whitespace-nowrap">
                      {trade.symbol}
                    </td>

                    {/* Side */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
                          trade.side === 'long'
                            ? 'bg-[#0ecb81]/10 text-[#0ecb81]'
                            : 'bg-[#f6465d]/10 text-[#f6465d]'
                        )}
                      >
                        {trade.side}
                      </span>
                    </td>

                    {/* Entry */}
                    <td className="px-4 py-3 text-[#8ba3c7] tabular-nums whitespace-nowrap">
                      ${formatPrice(trade.entryPrice)}
                    </td>

                    {/* Exit */}
                    <td className="px-4 py-3 text-[#8ba3c7] tabular-nums whitespace-nowrap">
                      ${formatPrice(trade.exitPrice)}
                    </td>

                    {/* PnL */}
                    <td className="px-4 py-3 font-semibold tabular-nums whitespace-nowrap">
                      <span className={isWin ? 'text-[#0ecb81]' : 'text-[#f6465d]'}>
                        {isWin ? '+' : ''}
                        {formatMoney(trade.pnl)}
                      </span>
                    </td>

                    {/* PnL % */}
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                      <span className={isWin ? 'text-[#0ecb81]' : 'text-[#f6465d]'}>
                        {trade.pnlPercent > 0 ? '+' : ''}
                        {trade.pnlPercent.toFixed(2)}%
                      </span>
                    </td>

                    {/* Fee */}
                    <td className="px-4 py-3 text-[#f6465d]/70 tabular-nums whitespace-nowrap">
                      -{formatMoney(trade.fee)}
                    </td>

                    {/* Exchange / Account */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: exColor }}
                        />
                        <span style={{ color: exColor }} className="capitalize font-medium">
                          {trade.exchangeId}
                        </span>
                        <span className="text-[#4d6b8e]">/</span>
                        <span className="text-[#8ba3c7]">{getSubAccountName(trade.subAccountId)}</span>
                      </span>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 text-[#4d6b8e] whitespace-nowrap">
                      {formatDate(trade.closedAt)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-[#152035]">
        <p className="text-[#4d6b8e] text-xs">
          Showing {Math.min((safePage - 1) * PAGE_SIZE + 1, sorted.length)}–
          {Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length.toLocaleString()} trades
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="p-1.5 rounded-md text-[#8ba3c7] hover:text-white hover:bg-[#0f1e32] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let p: number
            if (totalPages <= 5) {
              p = i + 1
            } else if (safePage <= 3) {
              p = i + 1
            } else if (safePage >= totalPages - 2) {
              p = totalPages - 4 + i
            } else {
              p = safePage - 2 + i
            }
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn(
                  'w-7 h-7 rounded-md text-xs font-medium transition-all',
                  p === safePage
                    ? 'bg-blue-600 text-white'
                    : 'text-[#8ba3c7] hover:text-white hover:bg-[#0f1e32]'
                )}
              >
                {p}
              </button>
            )
          })}

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="p-1.5 rounded-md text-[#8ba3c7] hover:text-white hover:bg-[#0f1e32] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
