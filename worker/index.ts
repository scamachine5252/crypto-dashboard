import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { ConnectorManager } from './connector-manager'
import { FullHistorySyncer } from './full-history-syncer'
import { startBalancePoller } from './balance-poller'

async function main() {
  console.log('[worker] starting...')

  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

  const manager = new ConnectorManager(redisUrl)
  const syncer  = new FullHistorySyncer(redisUrl)

  startBalancePoller()

  await manager.start()
  await syncer.start()

  console.log('[worker] all connectors + full-history syncer started')

  const shutdown = () => {
    console.log('[worker] shutting down...')
    manager.stop()
    syncer.stop()
    process.exit(0)
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT',  shutdown)
}

main().catch(e => {
  console.error('[worker] fatal error:', e)
  process.exit(1)
})
