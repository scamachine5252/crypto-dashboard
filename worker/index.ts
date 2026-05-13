import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { ConnectorManager } from './connector-manager'
import { FullHistorySyncer } from './full-history-syncer'
import { ReconciliationScheduler } from './reconciliation-scheduler'
import { startBalancePoller } from './balance-poller'

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

  const shutdown = async () => {
    console.log('[worker] shutting down...')
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
