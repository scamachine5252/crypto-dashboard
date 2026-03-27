import 'server-only'
import * as defaultCcxt from 'ccxt'

type CcxtLike = {
  binance: new (config: Record<string, unknown>) => {
    fetchBalance: (params?: Record<string, unknown>) => Promise<unknown>
  }
}

/**
 * Probe a Binance account to determine its active instrument type.
 *
 * Detection logic:
 *   - PM probe succeeds  → 'portfolio_margin'
 *   - futures + spot     → 'unified'
 *   - futures only       → 'futures'
 *   - spot only          → 'spot'
 *   - all fail           → 'unified' (safe default; account will be re-detected on next ping)
 *
 * @param ccxtMod  Injected ccxt module (real by default; pass mock in tests)
 */
export async function detectBinanceInstrument(
  apiKey: string,
  apiSecret: string,
  ccxtMod: CcxtLike = defaultCcxt,
): Promise<string> {
  const [spotResult, futuresResult, pmResult] = await Promise.allSettled([
    new ccxtMod.binance({ apiKey, secret: apiSecret }).fetchBalance(),
    new ccxtMod.binance({ apiKey, secret: apiSecret, options: { defaultType: 'future' } }).fetchBalance(),
    new ccxtMod.binance({ apiKey, secret: apiSecret, options: { defaultType: 'future', portfolioMargin: true } }).fetchBalance(),
  ])

  if (pmResult.status === 'fulfilled')                                             return 'portfolio_margin'
  if (futuresResult.status === 'fulfilled' && spotResult.status === 'fulfilled')   return 'unified'
  if (futuresResult.status === 'fulfilled')                                         return 'futures'
  if (spotResult.status === 'fulfilled')                                            return 'spot'
  return 'unified'
}
