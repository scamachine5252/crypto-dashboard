import 'server-only'
import * as defaultCcxt from 'ccxt'

type CcxtInstance = {
  fetchBalance: (params?: Record<string, unknown>) => Promise<unknown>
  papiGetBalance: (params?: Record<string, unknown>) => Promise<unknown>
}

type CcxtLike = {
  binance: new (config: Record<string, unknown>) => CcxtInstance
}

/**
 * Probe a Binance account to determine its active instrument type.
 *
 * Detection logic:
 *   - papiGetBalance() succeeds → 'portfolio_margin'
 *   - futures + spot fetchBalance both succeed → 'unified'
 *   - futures only → 'futures'
 *   - spot only → 'spot'
 *   - all fail → 'unified' (safe default)
 *
 * PM probe uses papiGetBalance() — fetchBalance() with portfolioMargin:true
 * does not work reliably for PM accounts and causes false negatives.
 *
 * @param ccxtMod  Injected ccxt module (real by default; pass mock in tests)
 */
export async function detectBinanceInstrument(
  apiKey: string,
  apiSecret: string,
  ccxtMod: CcxtLike = defaultCcxt as unknown as CcxtLike,
): Promise<string> {
  const baseConfig = { apiKey, secret: apiSecret, enableRateLimit: true }

  const pmEx      = new ccxtMod.binance({ ...baseConfig, options: { defaultType: 'future', portfolioMargin: true } })
  const futuresEx = new ccxtMod.binance({ ...baseConfig, options: { defaultType: 'future' } })
  const spotEx    = new ccxtMod.binance({ ...baseConfig })

  const [pmResult, futuresResult, spotResult] = await Promise.allSettled([
    pmEx.papiGetBalance({}),
    futuresEx.fetchBalance(),
    spotEx.fetchBalance(),
  ])

  if (pmResult.status === 'fulfilled')                                             return 'portfolio_margin'
  if (futuresResult.status === 'fulfilled' && spotResult.status === 'fulfilled')   return 'unified'
  if (futuresResult.status === 'fulfilled')                                         return 'futures'
  if (spotResult.status === 'fulfilled')                                            return 'spot'
  return 'unified'
}
