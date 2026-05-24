import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase/server'

interface Anomaly {
  account_name: string
  exchange:     string
  type:         'credentials_broken' | 'sync_failing'
}

async function getAnomalies(): Promise<Anomaly[]> {
  const ALERT_MS = 24 * 60 * 60 * 1000

  const { data } = await supabaseAdmin
    .from('accounts')
    .select('account_name, exchange, reconcile_consecutive_failures, reconcile_first_failure_at')
    .gt('reconcile_consecutive_failures', 0)
    .eq('is_suspended', false)

  return (data ?? []).flatMap((a: {
    account_name: string; exchange: string;
    reconcile_consecutive_failures: number; reconcile_first_failure_at: string | null
  }) => {
    const broken  = a.reconcile_consecutive_failures >= 999
    const agems   = a.reconcile_first_failure_at
      ? Date.now() - new Date(a.reconcile_first_failure_at).getTime()
      : 0
    if (!broken && agems <= ALERT_MS) return []
    return [{ account_name: a.account_name, exchange: a.exchange, type: broken ? 'credentials_broken' as const : 'sync_failing' as const }]
  })
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
      <span className="text-yellow-400 font-semibold shrink-0">Data Alert:</span>
      <span className="flex-1 text-yellow-200 truncate">
        {messages.join(' · ')}
      </span>
      <Link
        href="/api-settings"
        className="shrink-0 text-yellow-400 underline hover:text-yellow-300 transition-colors whitespace-nowrap"
      >
        View in API Settings
      </Link>
    </div>
  )
}
