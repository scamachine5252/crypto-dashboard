import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { ConnectorManager } from './connector-manager'
import { FullHistorySyncer } from './full-history-syncer'
import { ReconciliationScheduler } from './reconciliation-scheduler'
import { startBalancePoller } from './balance-poller'
import { supabaseAdmin } from '@/lib/supabase/server'

async function main() {
  console.log('[worker] starting...')

  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

  const manager    = new ConnectorManager(redisUrl)
  const syncer     = new FullHistorySyncer(redisUrl)
  const reconciler = new ReconciliationScheduler()

  startBalancePoller()

  await manager.start()
  await syncer.start()
  reconciler.start()

  console.log('[worker] all connectors + full-history syncer + reconciler started')

  // Write initial heartbeat, then refresh every 5 minutes
  const now = new Date().toISOString()
  await supabaseAdmin
    .from('worker_status')
    .update({ last_heartbeat: now, started_at: now })
    .eq('id', 1)
    .then(null, (e: unknown) => console.error('[worker] initial heartbeat failed:', e))

  const heartbeatTimer = setInterval(() => {
    void supabaseAdmin
      .from('worker_status')
      .update({ last_heartbeat: new Date().toISOString() })
      .eq('id', 1)
      .then(null, (e: unknown) => console.error('[worker] heartbeat failed:', e))
  }, 5 * 60 * 1000)
  heartbeatTimer.unref?.()

  const shutdown = async () => {
    console.log('[worker] shutting down...')
    clearInterval(heartbeatTimer)
    manager.stop()
    reconciler.stop()
    await syncer.shutdown()
    process.exit(0)
  }

  process.once('SIGTERM', () => { void shutdown() })
  process.once('SIGINT',  () => { void shutdown() })
}

main().catch(e => {
  console.error('[worker] fatal error:', e)
  process.exit(1)
})
