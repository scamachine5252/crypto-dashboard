import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { ConnectorManager } from './connector-manager'
import { startBalancePoller } from './balance-poller'

async function main() {
  console.log('[worker] starting...')

  const manager = new ConnectorManager(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')

  startBalancePoller()

  await manager.start()
  console.log('[worker] all connectors started')

  const shutdown = () => {
    console.log('[worker] shutting down...')
    manager.stop()
    process.exit(0)
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT',  shutdown)
}

main().catch(e => {
  console.error('[worker] fatal error:', e)
  process.exit(1)
})
