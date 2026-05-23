import Link from 'next/link'

interface Anomaly {
  account_name: string
  exchange:     string
  type:         'credentials_broken' | 'sync_failing'
}

async function getAnomalies(): Promise<Anomaly[]> {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const res  = await fetch(`${base}/api/worker-status`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const data = await res.json() as { anomalies?: Anomaly[] }
    return data.anomalies ?? []
  } catch {
    return []
  }
}

export default async function DataAnomalyBanner() {
  const anomalies = await getAnomalies()
  if (anomalies.length === 0) return null

  const messages = anomalies.map(a =>
    a.type === 'credentials_broken'
      ? `${a.account_name} (${a.exchange}): invalid API credentials`
      : `${a.account_name} (${a.exchange}): sync failing`,
  )

  return (
    <div
      role="alert"
      className="w-full bg-yellow-500/10 border-b border-yellow-500/30 px-4 py-2 flex items-center gap-3 text-sm"
    >
      <span className="text-yellow-400 font-semibold shrink-0">⚠ Data Alert:</span>
      <span className="flex-1 text-yellow-200 truncate">
        {messages.join(' · ')}
      </span>
      <Link
        href="/api-settings"
        className="shrink-0 text-yellow-400 underline hover:text-yellow-300 transition-colors whitespace-nowrap"
      >
        View in API Settings →
      </Link>
    </div>
  )
}
