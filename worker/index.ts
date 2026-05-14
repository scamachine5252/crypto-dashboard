import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { ConnectorManager } from './connector-manager'
import { FullHistorySyncer } from './full-history-syncer'
import { ReconciliationScheduler } from './reconciliation-scheduler'
import { startBalancePoller } from './balance-poller'
import { supabaseAdmin } from '@/lib/supabase/server'

function assertEnv() {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'ENCRYPTION_KEY',
  ]
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(`[worker] FATAL: missing required env vars: ${missing.join(', ')}`)
    process.exit(1)
  }
}

async function main() {
  assertEnv()
  console.log('[worker] starting...')

  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

  const manager    = new ConnectorManager(redisUrl)
  const syncer     = new FullHistorySyncer(redisUrl)
  const reconciler = new ReconciliationScheduler(redisUrl)

  startBalancePoller()

  await manager.start()
  await syncer.start()
  reconciler.start()

  console.log('[worker] all connectors + full-history syncer + reconciler started')

  // Write initial heartbeat, then refresh every 5 minutes
  const now = new Date().toISOString()
  const { error: initHbErr } = await supabaseAdmin
    .from('worker_status')
    .upsert({ id: 1, last_heartbeat: now, started_at: now }, { onConflict: 'id' })
  if (initHbErr) console.error('[worker] initial heartbeat failed:', initHbErr.message)

  let heartbeatFailures = 0
  const heartbeatTimer = setInterval(() => {
    void supabaseAdmin
      .from('worker_status')
      .upsert({ id: 1, last_heartbeat: new Date().toISOString() }, { onConflict: 'id' })
      .then(({ error }) => {
        if (error) {
          heartbeatFailures++
          console.error(`[worker] heartbeat failed (${heartbeatFailures} in a row):`, error.message)
          if (heartbeatFailures >= 3) {
            console.error('[worker] ALERT: heartbeat has failed 3+ consecutive times — watchdog may declare worker stale')
          }
        } else {
          heartbeatFailures = 0
        }
      })
  }, 5 * 60 * 1000)
  heartbeatTimer.unref?.()

  const shutdown = async () => {
    console.log('[worker] shutting down...')
    clearInterval(heartbeatTimer)
    reconciler.stop()
    await syncer.shutdown()
    // Wait up to 30s for in-flight WS gap fills / writes to complete before exit
    await manager.stopAndWait(30_000)
    process.exit(0)
  }

  process.once('SIGTERM', () => { void shutdown() })
  process.once('SIGINT',  () => { void shutdown() })
}

main().catch(e => {
  console.error('[worker] fatal error:', e)
  process.exit(1)
})
