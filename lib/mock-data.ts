import type { ExchangeConfig, Trade, DailyPnLEntry, ExchangeId, TradeType } from './types'

// ---------------------------------------------------------------------------
// Seeded deterministic RNG (mulberry32)
// ---------------------------------------------------------------------------
function createRng(seed: number) {
  let s = seed >>> 0
  const next = (): number => {
    s += 0x6d2b79f5
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_295
  }
  return {
    next,
    normal(mean = 0, std = 1): number {
      const u1 = Math.max(next(), 1e-10)
      const u2 = next()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      return mean + z * std
    },
    choice<T>(arr: T[]): T {
      return arr[Math.floor(next() * arr.length)]
    },
    bool(prob = 0.5): boolean {
      return next() < prob
    },
    int(min: number, max: number): number {
      return Math.floor(next() * (max - min + 1)) + min
    },
  }
}

function hashStr(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = (((h << 5) + h) ^ str.charCodeAt(i)) >>> 0
  }
  return h
}

// ---------------------------------------------------------------------------
// Exchange / sub-account definitions
// ---------------------------------------------------------------------------
export const EXCHANGES: ExchangeConfig[] = [
  {
    id: 'binance',
    name: 'Binance',
    color: '#F0B90B',
    subAccounts: [
      { id: 'binance-alpha', name: 'Alpha Fund', exchangeId: 'binance' },
      { id: 'binance-beta', name: 'Beta Fund', exchangeId: 'binance' },
      { id: 'binance-gamma', name: 'Gamma Stable', exchangeId: 'binance' },
    ],
  },
  {
    id: 'bybit',
    name: 'Bybit',
    color: '#FF6B2C',
    subAccounts: [
      { id: 'bybit-delta', name: 'Delta Perps', exchangeId: 'bybit' },
      { id: 'bybit-epsilon', name: 'Epsilon MM', exchangeId: 'bybit' },
    ],
  },
  {
    id: 'okx',
    name: 'OKX',
    color: '#4F8EF7',
    subAccounts: [
      { id: 'okx-zeta', name: 'Zeta Options', exchangeId: 'okx' },
      { id: 'okx-eta', name: 'Eta Arb', exchangeId: 'okx' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Per-sub-account risk / return config
// ---------------------------------------------------------------------------
interface SubCfg {
  meanDaily: number
  stdDaily: number
  jumpProb: number
  jumpMult: number
}

const SUB_CFG: Record<string, SubCfg> = {
  'binance-alpha': { meanDaily: 2200, stdDaily: 19000, jumpProb: 0.04, jumpMult: 2.5 },
  'binance-beta':  { meanDaily:  900, stdDaily: 12000, jumpProb: 0.03, jumpMult: 2.2 },
  'binance-gamma': { meanDaily:  420, stdDaily:  3000, jumpProb: 0.02, jumpMult: 1.8 },
  'bybit-delta':   { meanDaily: 1300, stdDaily: 21000, jumpProb: 0.05, jumpMult: 3.0 },
  'bybit-epsilon': { meanDaily:  360, stdDaily:  2200, jumpProb: 0.01, jumpMult: 1.5 },
  'okx-zeta':      { meanDaily: 1000, stdDaily: 12000, jumpProb: 0.03, jumpMult: 2.5 },
  'okx-eta':       { meanDaily:  210, stdDaily:  1400, jumpProb: 0.01, jumpMult: 1.5 },
}

// ---------------------------------------------------------------------------
// Crypto symbols and typical price ranges
// ---------------------------------------------------------------------------
const SYMBOLS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT',
  'XRP/USDT', 'AVAX/USDT', 'DOGE/USDT', 'MATIC/USDT',
]

const PRICE_RANGE: Record<string, [number, number]> = {
  'BTC/USDT':   [38_000, 72_000],
  'ETH/USDT':   [1_800,   4_200],
  'SOL/USDT':   [60,       220],
  'BNB/USDT':   [220,      620],
  'XRP/USDT':   [0.45,     1.50],
  'AVAX/USDT':  [18,        65],
  'DOGE/USDT':  [0.07,     0.28],
  'MATIC/USDT': [0.50,      2.10],
}

// ---------------------------------------------------------------------------
// Date range: 2025-01-01 → 2025-12-31
// ---------------------------------------------------------------------------
function buildDates(): string[] {
  const dates: string[] = []
  const d = new Date('2025-01-01T00:00:00Z')
  const end = new Date('2025-12-31T00:00:00Z')
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dates
}

const ALL_DATES = buildDates()

// ---------------------------------------------------------------------------
// Daily PnL generation
// ---------------------------------------------------------------------------
function generateDailyPnL(): DailyPnLEntry[] {
  const result: DailyPnLEntry[] = []

  for (const ex of EXCHANGES) {
    for (const sa of ex.subAccounts) {
      const cfg = SUB_CFG[sa.id]
      const rng = createRng(hashStr(sa.id))
      let cumulative = 0

      for (const date of ALL_DATES) {
        let pnl = rng.normal(cfg.meanDaily, cfg.stdDaily)
        if (rng.next() < cfg.jumpProb) {
          pnl *= cfg.jumpMult * (rng.bool(0.55) ? 1 : -1)
        }
        cumulative += pnl
        result.push({
          date,
          pnl: Math.round(pnl),
          cumulativePnl: Math.round(cumulative),
          exchangeId: ex.id as ExchangeId,
          subAccountId: sa.id,
        })
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Trade generation
// ---------------------------------------------------------------------------
function generateTrades(): Trade[] {
  const trades: Trade[] = []
  let tid = 1

  for (const ex of EXCHANGES) {
    for (const sa of ex.subAccounts) {
      const cfg = SUB_CFG[sa.id]
      const rng = createRng(hashStr(sa.id + '_trades'))
      const count = rng.int(170, 210)

      for (let i = 0; i < count; i++) {
        const symbol = rng.choice(SYMBOLS)
        const [lo, hi] = PRICE_RANGE[symbol]
        const side = rng.bool(0.54) ? 'long' : ('short' as const)
        const tradeType: TradeType = rng.choice(['spot', 'futures', 'options'] as TradeType[])

        const dateIdx = rng.int(0, ALL_DATES.length - 1)
        const openedAt = new Date(ALL_DATES[dateIdx] + 'T00:00:00Z')
        openedAt.setUTCHours(rng.int(0, 23), rng.int(0, 59))

        const durMin = rng.int(30, 10_080)
        const closedAt = new Date(openedAt.getTime() + durMin * 60_000)

        const entryPrice = lo + rng.next() * (hi - lo)
        const movePercent = rng.normal(0.008, 0.038)
        const exitPrice = entryPrice * (1 + movePercent)

        const notional = cfg.meanDaily * rng.int(5, 18)
        const quantity = notional / entryPrice

        const rawPnl = (exitPrice - entryPrice) * quantity * (side === 'long' ? 1 : -1)
        const feeRate = 0.0004 + rng.next() * 0.00028
        const fee = (entryPrice + exitPrice) * quantity * feeRate
        const pnl = rawPnl - fee
        const pnlPercent =
          ((exitPrice - entryPrice) / entryPrice) * 100 * (side === 'long' ? 1 : -1)

        trades.push({
          id: `t${tid++}`,
          subAccountId: sa.id,
          exchangeId: ex.id as ExchangeId,
          symbol,
          side,
          tradeType,
          entryPrice: Math.round(entryPrice * 100) / 100,
          exitPrice: Math.round(exitPrice * 100) / 100,
          quantity: Math.round(quantity * 10_000) / 10_000,
          pnl: Math.round(pnl),
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          fee: Math.round(fee),
          durationMin: durMin,
          openedAt: openedAt.toISOString(),
          closedAt: closedAt.toISOString(),
        })
      }
    }
  }

  return trades.sort((a, b) => b.closedAt.localeCompare(a.closedAt))
}

// ---------------------------------------------------------------------------
// Memoized singletons
// ---------------------------------------------------------------------------
let _daily: DailyPnLEntry[] | null = null
let _trades: Trade[] | null = null

export function getAllDailyPnL(): DailyPnLEntry[] {
  if (!_daily) _daily = generateDailyPnL()
  return _daily
}

export function getAllTrades(): Trade[] {
  if (!_trades) _trades = generateTrades()
  return _trades
}

export function filterDailyPnL(exchangeId: string, subAccountId: string): DailyPnLEntry[] {
  return getAllDailyPnL().filter((e) => {
    if (exchangeId !== 'all' && e.exchangeId !== exchangeId) return false
    if (subAccountId !== 'all' && e.subAccountId !== subAccountId) return false
    return true
  })
}

export function filterTrades(exchangeId: string, subAccountId: string): Trade[] {
  return getAllTrades().filter((t) => {
    if (exchangeId !== 'all' && t.exchangeId !== exchangeId) return false
    if (subAccountId !== 'all' && t.subAccountId !== subAccountId) return false
    return true
  })
}
