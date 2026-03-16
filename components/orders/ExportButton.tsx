'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import type { Trade } from '@/lib/types'

interface ExportButtonProps {
  trades: Trade[]
  filename: string  // base name without extension, e.g. "trades-2025-01-01"
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
const CSV_HEADERS =
  'id,symbol,side,trade_type,entry_price,exit_price,quantity,pnl,pnl_percent,' +
  'fee,duration_min,leverage,funding_cost,is_overnight,opened_at,closed_at,' +
  'exchange_id,sub_account_id'

function tradeToRow(t: Trade): string {
  return [
    t.id,
    t.symbol,
    t.side,
    t.tradeType,
    t.entryPrice,
    t.exitPrice,
    t.quantity,
    t.pnl,
    t.pnlPercent,
    t.fee,
    t.durationMin,
    t.leverage,
    t.fundingCost,
    t.isOvernight,
    t.openedAt,
    t.closedAt,
    t.exchangeId,
    t.subAccountId,
  ].join(',')
}

function exportCsv(trades: Trade[], filename: string) {
  const rows = [CSV_HEADERS, ...trades.map(tradeToRow)].join('\n')
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
const PDF_HEADERS = [
  'Symbol', 'Side', 'Type', 'Entry', 'Exit', 'Qty',
  'PnL', 'PnL %', 'Fee', 'Dur (min)', 'Leverage',
  'Funding', 'Overnight', 'Opened', 'Closed', 'Exchange', 'Account',
]

function tradeToTableRow(t: Trade): (string | number | boolean)[] {
  return [
    t.symbol, t.side, t.tradeType,
    t.entryPrice, t.exitPrice, t.quantity,
    t.pnl, t.pnlPercent, t.fee,
    t.durationMin, t.leverage, t.fundingCost,
    t.isOvernight, t.openedAt, t.closedAt,
    t.exchangeId, t.subAccountId,
  ]
}

async function exportPdf(trades: Trade[], filename: string) {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('Trade History Export', 14, 16)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(130)
  doc.text(filename, 14, 22)
  doc.setTextColor(0)

  autoTable(doc, {
    head: [PDF_HEADERS],
    body: trades.map(tradeToTableRow),
    startY: 27,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [20, 30, 48], textColor: 200 },
    alternateRowStyles: { fillColor: [245, 247, 252] },
  })

  doc.save(`${filename}.pdf`)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ExportButton({ trades, filename }: ExportButtonProps) {
  const [csvLoading, setCsvLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)

  const handleCsv = async () => {
    setCsvLoading(true)
    try {
      exportCsv(trades, filename)
    } finally {
      setCsvLoading(false)
    }
  }

  const handlePdf = async () => {
    setPdfLoading(true)
    try {
      await exportPdf(trades, filename)
    } finally {
      setPdfLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Btn onClick={handleCsv} loading={csvLoading} label="CSV" />
      <Btn onClick={handlePdf} loading={pdfLoading} label="PDF" />
    </div>
  )
}

function Btn({
  onClick,
  loading,
  label,
}: {
  onClick: () => void
  loading: boolean
  label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: 'transparent',
        borderColor: 'var(--border-medium)',
        color: 'var(--text-muted)',
        borderRadius: 2,
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          const el = e.currentTarget
          el.style.borderColor = 'var(--accent-gold)'
          el.style.color = 'var(--accent-gold)'
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.borderColor = 'var(--border-medium)'
        el.style.color = 'var(--text-muted)'
      }}
    >
      {loading
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <Download className="w-3 h-3" />
      }
      {label}
    </button>
  )
}
