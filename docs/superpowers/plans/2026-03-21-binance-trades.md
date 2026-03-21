# Binance Trades Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full Binance trade history fetching: quick sync (48h, balance-derived symbols) and client-side orchestrated full scan (180d, all USDT pairs).

**Architecture:** Quick sync runs inside `BinanceAdapter.getTrades()` (no ExchangeAdapter interface change). Full scan uses a Binance-specific `getFullTrades(symbols)` method — note: `accountId` is NOT a parameter; the route owns account ID and only passes the symbol slice to the adapter. Two new API routes handle the full scan: `/api/sync/binance/markets` (chunk metadata) and `/api/sync/binance/full` (POST: sync one chunk; PATCH: write `last_full_sync_at`). The browser drives chunked requests sequentially to stay within Vercel's 10-second timeout. A new `last_full_sync_at` column on `accounts` tracks scan state.

**Tech Stack:** Next.js App Router, TypeScript, CCXT (Binance), Supabase (PostgreSQL), Jest

---

## Files Changed

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/008_add_last_full_sync_at.sql` | Create | Add nullable `last_full_sync_at` column to accounts |
| `lib/adapters/binance.ts` | Modify | `getTrades()` quick sync + `getFullTrades()` full scan |
| `lib/adapters/__tests__/exchange.test.ts` | Modify | Tests for `getTrades()` and `getFullTrades()` in BinanceAdapter section |
| `app/api/sync/route.ts` | Modify | Pass `since=48h` when calling Binance `getTrades()` |
| `app/api/sync/binance/markets/route.ts` | Create | GET: call `loadMarkets()`, return chunk metadata |
| `app/api/sync/binance/full/route.ts` | Create | POST: sync one chunk; PATCH: write `last_full_sync_at` |
| `app/api/sync/binance/__tests__/markets.test.ts` | Create | Unit tests for markets route |
| `app/api/sync/binance/__tests__/full.test.ts` | Create | Unit tests for full sync route |
| `app/api/accounts/route.ts` | No change | GET uses `select('*')` — `last_full_sync_at` included automatically after migration |
| `components/layout/Header.tsx` | Modify | Fetch accounts on mount; show notice for Binance accounts without full scan |
| `app/api-settings/page.tsx` | Modify | Last Synced column + Load Full History button + progress bar |

---

## Task 1: Migration 008 — last_full_sync_at

**Files:**
- Create: `supabase/migrations/008_add_last_full_sync_at.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Migration 008: track when a full 180-day trade scan was last completed
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_full_sync_at timestamptz;
```

- [ ] **Step 2: Apply migration in Supabase Dashboard**

Open Supabase Dashboard → SQL Editor → paste and run the file contents.
Expected: no errors; column `last_full_sync_at timestamptz` appears in the accounts table.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/008_add_last_full_sync_at.sql
git commit -m "feat: migration 008 — add last_full_sync_at to accounts"
```

---

## Task 2: BinanceAdapter — getTrades() quick sync (TDD)

**Files:**
- Modify: `lib/adapters/__tests__/exchange.test.ts` (BinanceAdapter section)
- Modify: `lib/adapters/binance.ts`

Implement `getTrades()` with quick sync (balance tokens + top-50 hardcoded pairs). Add `getFullTrades()` as a stub (returns empty) — it will be filled in Task 3.

- [ ] **Step 1: Add failing tests to the existing BinanceAdapter describe block**

In `lib/adapters/__tests__/exchange.test.ts`, find the `describe('BinanceAdapter', ...)` block. Add these tests at the end of the block (after the existing `fetchBalance` tests):

```typescript
  describe('getTrades (quick sync)', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      mockFetchBalance.mockReset()
      mockFetchTrades.mockReset()
    })

    it('calls fetchBalance({type: spot}) to derive token symbol list', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100, BTC: 0.5 } })
      mockFetchTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(mockFetchBalance).toHaveBeenCalledWith({ type: 'spot' })
    })

    it('includes token-derived symbol in the fetch list', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100, SOL: 10 } })
      mockFetchTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      const calledSymbols = mockFetchTrades.mock.calls.map((c) => c[0] as string)
      expect(calledSymbols).toContain('SOL/USDT')
    })

    it('always includes BTC/USDT and ETH/USDT from hardcoded top-50 list', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } }) // no tokens in balance
      mockFetchTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      const calledSymbols = mockFetchTrades.mock.calls.map((c) => c[0] as string)
      expect(calledSymbols).toContain('BTC/USDT')
      expect(calledSymbols).toContain('ETH/USDT')
    })

    it('deduplicates symbols — BTC in balance AND top-50 is fetched only once', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100, BTC: 0.1 } })
      mockFetchTrades.mockResolvedValue([])

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      const calledSymbols = mockFetchTrades.mock.calls.map((c) => c[0] as string)
      expect(calledSymbols.filter((s) => s === 'BTC/USDT')).toHaveLength(1)
    })

    it('passes since parameter to every fetchMyTrades call', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } })
      mockFetchTrades.mockResolvedValue([])
      const since = Date.now() - 48 * 3600_000

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, since)

      mockFetchTrades.mock.calls.forEach((call) => {
        expect(call[1]).toBe(since)
      })
    })

    it('maps returned ccxt trades to Trade objects', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } })
      mockFetchTrades.mockImplementation((symbol: string) => {
        if (symbol === 'BTC/USDT') return Promise.resolve([{ ...sampleCcxtTrade, symbol: 'BTC/USDT' }])
        return Promise.resolve([])
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(trades.length).toBeGreaterThan(0)
      expect(trades[0].symbol).toBe('BTC/USDT')
    })

    it('skips a symbol silently if fetchMyTrades throws — does not crash', async () => {
      mockFetchBalance.mockResolvedValue({ total: { USDT: 100 } })
      mockFetchTrades.mockRejectedValue(new Error('invalid symbol'))

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const trades = await adapter.getTrades('all', { start: '2025-01-01', end: '2025-12-31' }, Date.now() - 48 * 3600_000)

      expect(trades).toEqual([])
    })
  })
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test lib/adapters/__tests__/exchange.test.ts -- --testNamePattern="quick sync"
```

Expected: FAIL — current `getTrades()` returns `[]`.

- [ ] **Step 3: Implement getTrades() and stub getFullTrades() in binance.ts**

Replace `lib/adapters/binance.ts` with:

```typescript
import 'server-only'
import * as ccxt from 'ccxt'
import type { ExchangeAdapter, BalanceResult } from './types'
import type { DailyPnLEntry, Trade, DateRange } from '../types'
import { mapCcxtTrade } from './ccxt-utils'

interface BinanceCredentials {
  apiKey: string
  apiSecret: string
}

export interface FullTradesResult {
  trades: Trade[]
  failedSymbols: { symbol: string; error: string }[]
}

// Top-50 most-traded USDT pairs — always included in quick sync
const TOP_50_SYMBOLS = [
  'BTC/USDT',   'ETH/USDT',   'BNB/USDT',   'SOL/USDT',   'XRP/USDT',
  'DOGE/USDT',  'ADA/USDT',   'AVAX/USDT',  'SHIB/USDT',  'TRX/USDT',
  'TON/USDT',   'LINK/USDT',  'DOT/USDT',   'MATIC/USDT', 'DAI/USDT',
  'LTC/USDT',   'BCH/USDT',   'UNI/USDT',   'ATOM/USDT',  'XLM/USDT',
  'FIL/USDT',   'NEAR/USDT',  'APT/USDT',   'ARB/USDT',   'OP/USDT',
  'ALGO/USDT',  'HBAR/USDT',  'CRO/USDT',   'QNT/USDT',   'EGLD/USDT',
  'FLOW/USDT',  'SAND/USDT',  'MANA/USDT',  'AXS/USDT',   'THETA/USDT',
  'XTZ/USDT',   'EOS/USDT',   'FTM/USDT',   'GALA/USDT',  'ENJ/USDT',
  'CHZ/USDT',   'BAT/USDT',   'ZIL/USDT',   'CRV/USDT',   'AAVE/USDT',
  'SUSHI/USDT', 'COMP/USDT',  'MKR/USDT',   'SNX/USDT',   'YFI/USDT',
]

export class BinanceAdapter implements ExchangeAdapter {
  private exchange: ccxt.binance

  constructor(credentials: BinanceCredentials) {
    this.exchange = new ccxt.binance({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
    })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.fetchBalance()
      return true
    } catch {
      return false
    }
  }

  async fetchBalance(): Promise<BalanceResult> {
    const walletTypes = ['spot', 'future', 'delivery'] as const

    const results = await Promise.allSettled(
      walletTypes.map((type) => this.exchange.fetchBalance({ type }))
    )

    let usdt = 0
    const tokens: Record<string, number> = {}
    let anySucceeded = false

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      anySucceeded = true
      const total = (result.value.total ?? {}) as unknown as Record<string, number>
      usdt += total['USDT'] ?? 0
      for (const [symbol, amount] of Object.entries(total)) {
        if (symbol !== 'USDT' && typeof amount === 'number' && amount > 0) {
          tokens[symbol] = (tokens[symbol] ?? 0) + amount
        }
      }
    }

    if (!anySucceeded) {
      const firstRejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      throw firstRejected.reason
    }

    return { usdt, tokens }
  }

  async getDailyPnL(_subAccountId: string, _dateRange: DateRange): Promise<DailyPnLEntry[]> {
    return []
  }

  async getTrades(
    _subAccountId: string,
    _dateRange: DateRange,
    since?: number,
    _limit?: number,
  ): Promise<Trade[]> {
    // Fetch spot balance to derive token-based symbol list
    let balanceTokens: string[] = []
    try {
      const bal = await this.exchange.fetchBalance({ type: 'spot' })
      const total = (bal.total ?? {}) as unknown as Record<string, number>
      balanceTokens = Object.entries(total)
        .filter(([sym, amt]) => sym !== 'USDT' && typeof amt === 'number' && amt > 0)
        .map(([sym]) => `${sym}/USDT`)
    } catch {
      // If balance fetch fails, proceed with top-50 only
    }

    const symbolSet = new Set([...TOP_50_SYMBOLS, ...balanceTokens])
    const symbols = Array.from(symbolSet)

    const trades: Trade[] = []
    for (const symbol of symbols) {
      try {
        const raw = await this.exchange.fetchMyTrades(symbol, since, 1000)
        for (const t of raw) trades.push(mapCcxtTrade(t, 'binance'))
      } catch {
        // Skip symbol on error — not fatal for quick sync
      }
    }
    return trades
  }

  // Full 180-day scan — called by /api/sync/binance/full only (not on ExchangeAdapter interface).
  // Note: accountId is intentionally NOT a parameter — the route owns account identity;
  // this method only receives the symbol slice for the current chunk.
  async getFullTrades(_symbols: string[]): Promise<FullTradesResult> {
    // Stub — implemented in the next task
    return { trades: [], failedSymbols: [] }
  }
}
```

- [ ] **Step 4: Run quick sync tests — verify they pass**

```bash
npm test lib/adapters/__tests__/exchange.test.ts -- --testNamePattern="quick sync"
```

Expected: all new tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add lib/adapters/binance.ts lib/adapters/__tests__/exchange.test.ts
git commit -m "feat: BinanceAdapter getTrades quick sync (balance + top-50, stub getFullTrades)"
```

---

## Task 3: BinanceAdapter — getFullTrades() implementation (TDD)

**Files:**
- Modify: `lib/adapters/__tests__/exchange.test.ts` (add getFullTrades tests to BinanceAdapter section)
- Modify: `lib/adapters/binance.ts` (replace stub with real implementation)

- [ ] **Step 1: Add failing tests for getFullTrades**

In `lib/adapters/__tests__/exchange.test.ts`, inside `describe('BinanceAdapter', ...)`, add after the `getTrades` describe block:

```typescript
  describe('getFullTrades (full scan)', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      mockFetchTrades.mockReset()
    })

    it('calls fetchMyTrades for each symbol with a ~180-day since window', async () => {
      mockFetchTrades.mockResolvedValue([])
      const before = Date.now()

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      await adapter.getFullTrades(['BTC/USDT', 'ETH/USDT'])

      expect(mockFetchTrades).toHaveBeenCalledTimes(2)
      const sinceArg = mockFetchTrades.mock.calls[0][1] as number
      const expected180d = before - 180 * 24 * 3600_000
      expect(sinceArg).toBeGreaterThanOrEqual(expected180d - 1000)
      expect(sinceArg).toBeLessThanOrEqual(expected180d + 5000)
    })

    it('retries a failed symbol exactly once before marking it failed', async () => {
      let callCount = 0
      mockFetchTrades.mockImplementation(() => {
        callCount++
        return Promise.reject(new Error('rate limit'))
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades(['BTC/USDT'])

      expect(callCount).toBe(2) // 1 original + 1 retry
      expect(result.failedSymbols).toHaveLength(1)
      expect(result.failedSymbols[0].symbol).toBe('BTC/USDT')
      expect(result.failedSymbols[0].error).toMatch(/rate limit/)
    }, 10_000)

    it('succeeds on retry if first attempt fails', async () => {
      let callCount = 0
      mockFetchTrades.mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject(new Error('timeout'))
        return Promise.resolve([{ ...sampleCcxtTrade, symbol: 'BTC/USDT' }])
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades(['BTC/USDT'])

      expect(result.trades).toHaveLength(1)
      expect(result.failedSymbols).toHaveLength(0)
    }, 10_000)

    it('continues loop when one symbol fails — does not stop', async () => {
      mockFetchTrades.mockImplementation((symbol: string) => {
        if (symbol === 'ETH/USDT') return Promise.reject(new Error('symbol error'))
        return Promise.resolve([{ ...sampleCcxtTrade, symbol }])
      })

      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades(['BTC/USDT', 'ETH/USDT', 'SOL/USDT'])

      expect(result.trades).toHaveLength(2) // BTC + SOL fetched; ETH failed
      expect(result.failedSymbols).toHaveLength(1)
      expect(result.failedSymbols[0].symbol).toBe('ETH/USDT')
    }, 10_000)

    it('returns empty result for empty symbol list without calling fetchMyTrades', async () => {
      const { BinanceAdapter } = await import('../binance')
      const adapter = new BinanceAdapter({ apiKey: 'key', apiSecret: 'secret' })
      const result = await adapter.getFullTrades([])

      expect(result.trades).toEqual([])
      expect(result.failedSymbols).toEqual([])
      expect(mockFetchTrades).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test lib/adapters/__tests__/exchange.test.ts -- --testNamePattern="full scan"
```

Expected: FAIL — stub returns `{ trades: [], failedSymbols: [] }` without calling `fetchMyTrades`.

- [ ] **Step 3: Replace the getFullTrades stub with real implementation**

In `lib/adapters/binance.ts`, replace the `getFullTrades` method with:

```typescript
  async getFullTrades(symbols: string[]): Promise<FullTradesResult> {
    const since = Date.now() - 180 * 24 * 60 * 60 * 1000
    const trades: Trade[] = []
    const failedSymbols: { symbol: string; error: string }[] = []

    for (const symbol of symbols) {
      let succeeded = false
      let lastError = ''

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const raw = await this.exchange.fetchMyTrades(symbol, since, 1000)
          for (const t of raw) trades.push(mapCcxtTrade(t, 'binance'))
          succeeded = true
          break
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
          if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
        }
      }

      if (!succeeded) failedSymbols.push({ symbol, error: lastError })
    }

    return { trades, failedSymbols }
  }
```

- [ ] **Step 4: Run full scan tests — verify they pass**

```bash
npm test lib/adapters/__tests__/exchange.test.ts -- --testNamePattern="full scan"
```

Expected: all PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add lib/adapters/binance.ts lib/adapters/__tests__/exchange.test.ts
git commit -m "feat: BinanceAdapter getFullTrades — 180d scan with per-symbol retry"
```

---

## Task 4: GET /api/sync/binance/markets route

**Files:**
- Create: `app/api/sync/binance/markets/route.ts`
- Create: `app/api/sync/binance/__tests__/markets.test.ts`

Note: do NOT add `jest.mock('server-only', () => ({}))` to test files — the project-level `moduleNameMapper` in `jest.config.ts` already maps `server-only` to `__mocks__/server-only.ts`. Adding an inline mock is redundant and inconsistent with the rest of the codebase.

- [ ] **Step 1: Write failing tests**

Create `app/api/sync/binance/__tests__/markets.test.ts`:

```typescript
const mockLoadMarkets = jest.fn()

jest.mock('ccxt', () => ({
  binance: jest.fn(() => ({ loadMarkets: mockLoadMarkets })),
}))

import { NextRequest } from 'next/server'

describe('GET /api/sync/binance/markets', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns totalChunks, chunkSize, and totalSymbols', async () => {
    // 55 USDT spot markets → ceil(55/50) = 2 chunks
    const markets: Record<string, unknown> = {}
    for (let i = 0; i < 55; i++) {
      markets[`TOKEN${i}/USDT`] = { symbol: `TOKEN${i}/USDT`, quote: 'USDT', type: 'spot', active: true }
    }
    // 5 BTC-quoted — must be excluded
    for (let i = 0; i < 5; i++) {
      markets[`TOKEN${i}/BTC`] = { symbol: `TOKEN${i}/BTC`, quote: 'BTC', type: 'spot', active: true }
    }
    mockLoadMarkets.mockResolvedValue(markets)

    const { GET } = await import('../markets/route')
    const req = new NextRequest('http://localhost/api/sync/binance/markets')
    const res = await GET(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.totalSymbols).toBe(55)
    expect(json.chunkSize).toBe(50)
    expect(json.totalChunks).toBe(2)
  })

  it('includes inactive (delisted) USDT markets', async () => {
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT':  { symbol: 'BTC/USDT',  quote: 'USDT', type: 'spot',   active: true  },
      'LUNA/USDT': { symbol: 'LUNA/USDT', quote: 'USDT', type: 'spot',   active: false }, // delisted
    })

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    const json = await res.json()

    expect(json.totalSymbols).toBe(2)
  })

  it('includes linear (USDT-M futures) markets alongside spot', async () => {
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT':      { symbol: 'BTC/USDT',      quote: 'USDT', type: 'spot',   active: true },
      'BTC/USDT:USDT': { symbol: 'BTC/USDT:USDT', quote: 'USDT', type: 'swap',   active: true, linear: true },
      'ETH/BTC':       { symbol: 'ETH/BTC',        quote: 'BTC',  type: 'spot',   active: true }, // excluded
    })

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    const json = await res.json()

    expect(json.totalSymbols).toBe(2) // spot + linear, not BTC-quoted
  })

  it('excludes non-USDT quoted markets', async () => {
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT': { symbol: 'BTC/USDT', quote: 'USDT', type: 'spot', active: true },
      'ETH/BTC':  { symbol: 'ETH/BTC',  quote: 'BTC',  type: 'spot', active: true },
    })

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    const json = await res.json()

    expect(json.totalSymbols).toBe(1)
  })

  it('returns totalChunks=0 and totalSymbols=0 if no USDT markets', async () => {
    mockLoadMarkets.mockResolvedValue({})

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))
    const json = await res.json()

    expect(json.totalSymbols).toBe(0)
    expect(json.totalChunks).toBe(0)
  })

  it('returns 500 if loadMarkets throws', async () => {
    mockLoadMarkets.mockRejectedValue(new Error('network error'))

    const { GET } = await import('../markets/route')
    const res = await GET(new NextRequest('http://localhost/api/sync/binance/markets'))

    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test app/api/sync/binance/__tests__/markets.test.ts
```

Expected: FAIL — route file does not exist.

- [ ] **Step 3: Create the route**

Create `app/api/sync/binance/markets/route.ts`:

```typescript
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import * as ccxt from 'ccxt'

const CHUNK_SIZE = 50

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const exchange = new ccxt.binance()
    const markets = await exchange.loadMarkets()

    const symbols = Object.values(markets)
      .filter((m) => m.quote === 'USDT')
      .map((m) => m.symbol)

    const totalSymbols = symbols.length
    const totalChunks = totalSymbols === 0 ? 0 : Math.ceil(totalSymbols / CHUNK_SIZE)

    return NextResponse.json({ totalChunks, chunkSize: CHUNK_SIZE, totalSymbols })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test app/api/sync/binance/__tests__/markets.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add app/api/sync/binance/markets/route.ts app/api/sync/binance/__tests__/markets.test.ts
git commit -m "feat: GET /api/sync/binance/markets — returns chunk metadata"
```

---

## Task 5: POST+PATCH /api/sync/binance/full route

**Files:**
- Create: `app/api/sync/binance/full/route.ts`
- Create: `app/api/sync/binance/__tests__/full.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/api/sync/binance/__tests__/full.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockLoadMarkets   = jest.fn()
const mockGetFullTrades = jest.fn()

jest.mock('ccxt', () => ({
  binance: jest.fn(() => ({ loadMarkets: mockLoadMarkets })),
}))

// Mock supabase
const mockSelectEqSingle = jest.fn()
const mockUpdateEq       = jest.fn()
const mockUpsert         = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'accounts') {
        return {
          select: jest.fn(() => ({ eq: jest.fn(() => ({ single: mockSelectEqSingle })) })),
          update: jest.fn(() => ({ eq: mockUpdateEq })),
        }
      }
      // trades table
      return { upsert: mockUpsert }
    }),
  },
}))

jest.mock('@/lib/crypto/decrypt', () => ({
  decrypt: jest.fn((s: string) => `dec:${s}`),
}))

jest.mock('@/lib/adapters/binance', () => ({
  BinanceAdapter: jest.fn().mockImplementation(() => ({
    getFullTrades: mockGetFullTrades,
  })),
}))

import { NextRequest } from 'next/server'

function makePost(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/binance/full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/sync/binance/full', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------
describe('POST /api/sync/binance/full', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 400 if account_id is missing', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ chunk_index: 0 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 if chunk_index is missing', async () => {
    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 if account not found in Supabase', async () => {
    mockSelectEqSingle.mockResolvedValue({ data: null, error: null })
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT': { symbol: 'BTC/USDT', quote: 'USDT' },
    })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'not-found', chunk_index: 0 }))
    expect(res.status).toBe(404)
  })

  it('calls getFullTrades with the correct 50-symbol slice for chunk_index=1', async () => {
    // 75 sorted symbols → chunk 0 = first 50, chunk 1 = last 25
    const markets: Record<string, unknown> = {}
    for (let i = 0; i < 75; i++) {
      const sym = `TOKEN${String(i).padStart(3, '0')}/USDT`
      markets[sym] = { symbol: sym, quote: 'USDT' }
    }
    mockLoadMarkets.mockResolvedValue(markets)
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'enc-key', api_secret: 'enc-sec' },
      error: null,
    })
    mockGetFullTrades.mockResolvedValue({ trades: [], failedSymbols: [] })
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    await POST(makePost({ account_id: 'uuid-1', chunk_index: 1 }))

    const calledSymbols = mockGetFullTrades.mock.calls[0][0] as string[]
    expect(calledSymbols).toHaveLength(25) // 75 - 50
  })

  it('upserts fetched trades and returns synced count', async () => {
    mockLoadMarkets.mockResolvedValue({
      'BTC/USDT': { symbol: 'BTC/USDT', quote: 'USDT' },
    })
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'key', api_secret: 'sec' },
      error: null,
    })
    mockGetFullTrades.mockResolvedValue({
      trades: [{
        id: 't1', symbol: 'BTC/USDT', side: 'long', tradeType: 'spot',
        entryPrice: 50000, exitPrice: 50000, quantity: 0.1, pnl: 10,
        pnlPercent: 0.2, fee: 5, durationMin: 0, leverage: 1,
        fundingCost: 0, isOvernight: false,
        openedAt: '2025-01-01T00:00:00.000Z',
        closedAt: '2025-01-01T00:00:00.000Z',
        subAccountId: 'binance', exchangeId: 'binance',
      }],
      failedSymbols: [],
    })
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))

    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalled()
    const json = await res.json()
    expect(json.synced).toBe(1)
    expect(json.failedSymbols).toEqual([])
  })

  it('returns failedSymbols from getFullTrades in the response', async () => {
    mockLoadMarkets.mockResolvedValue({
      'BAD/USDT': { symbol: 'BAD/USDT', quote: 'USDT' },
    })
    mockSelectEqSingle.mockResolvedValue({
      data: { id: 'uuid-1', api_key: 'key', api_secret: 'sec' },
      error: null,
    })
    mockGetFullTrades.mockResolvedValue({
      trades: [],
      failedSymbols: [{ symbol: 'BAD/USDT', error: 'invalid symbol' }],
    })
    mockUpsert.mockResolvedValue({ error: null })

    const { POST } = await import('../full/route')
    const res = await POST(makePost({ account_id: 'uuid-1', chunk_index: 0 }))
    const json = await res.json()

    expect(json.failedSymbols).toHaveLength(1)
    expect(json.failedSymbols[0].symbol).toBe('BAD/USDT')
  })
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('PATCH /api/sync/binance/full', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('returns 400 if account_id is missing', async () => {
    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ done: true }))
    expect(res.status).toBe(400)
  })

  it('writes last_full_sync_at to accounts and returns { ok: true }', async () => {
    mockUpdateEq.mockResolvedValue({ error: null })

    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ account_id: 'uuid-1', done: true }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'uuid-1')
  })

  it('writes last_full_sync_at even when previous chunks had failedSymbols', async () => {
    // Timestamp is written regardless of symbol-level failures (per spec)
    mockUpdateEq.mockResolvedValue({ error: null })

    const { PATCH } = await import('../full/route')
    const res = await PATCH(makePatch({ account_id: 'uuid-with-some-failures', done: true }))

    expect(res.status).toBe(200)
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'uuid-with-some-failures')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test app/api/sync/binance/__tests__/full.test.ts
```

Expected: FAIL — route file does not exist.

- [ ] **Step 3: Create the route**

Create `app/api/sync/binance/full/route.ts`:

```typescript
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import * as ccxt from 'ccxt'
import { supabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto/decrypt'
import { BinanceAdapter } from '@/lib/adapters/binance'
import type { Trade } from '@/lib/types'

const CHUNK_SIZE = 50

async function loadSortedUsdtSymbols(): Promise<string[]> {
  const exchange = new ccxt.binance()
  const markets = await exchange.loadMarkets()
  return Object.values(markets)
    .filter((m) => m.quote === 'USDT')
    .map((m) => m.symbol)
    .sort()
}

// ---------------------------------------------------------------------------
// POST — sync one chunk of symbols for one account
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as Record<string, unknown>
  const accountId  = body.account_id  as string | undefined
  const chunkIndex = body.chunk_index as number | undefined

  if (!accountId)               return NextResponse.json({ error: 'account_id required' }, { status: 400 })
  if (chunkIndex === undefined) return NextResponse.json({ error: 'chunk_index required' }, { status: 400 })

  const { data: account, error: accountError } = await supabaseAdmin
    .from('accounts')
    .select('id, api_key, api_secret')
    .eq('id', accountId)
    .single()

  if (accountError || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const allSymbols = await loadSortedUsdtSymbols()
  const start  = chunkIndex * CHUNK_SIZE
  const symbols = allSymbols.slice(start, start + CHUNK_SIZE)

  if (symbols.length === 0) {
    return NextResponse.json({ synced: 0, failedSymbols: [] })
  }

  const adapter = new BinanceAdapter({
    apiKey:    decrypt((account as Record<string, string>).api_key),
    apiSecret: decrypt((account as Record<string, string>).api_secret),
  })

  const { trades, failedSymbols } = await adapter.getFullTrades(symbols)

  let synced = 0
  if (trades.length > 0) {
    const seen = new Set<string>()
    const rows = trades
      .filter((t: Trade) => {
        const key = `${accountId}|${t.symbol}|${t.openedAt}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((t: Trade) => ({
        account_id:  accountId,
        exchange:    'binance',
        symbol:      t.symbol,
        side:        t.side === 'long' ? 'buy' : 'sell',
        direction:   t.side === 'long' || t.side === 'short' ? t.side : 'unknown',
        entry_price: t.entryPrice,
        exit_price:  t.exitPrice,
        quantity:    t.quantity,
        pnl:         t.pnl,
        fee:         t.fee,
        opened_at:   t.openedAt,
        closed_at:   t.closedAt,
        trade_type:  t.tradeType,
      }))

    const { error: upsertError } = await supabaseAdmin
      .from('trades')
      .upsert(rows, { onConflict: 'account_id,symbol,opened_at' })

    if (!upsertError) synced = rows.length
  }

  return NextResponse.json({ synced, failedSymbols })
}

// ---------------------------------------------------------------------------
// PATCH — mark full scan complete, write last_full_sync_at
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as Record<string, unknown>
  const accountId = body.account_id as string | undefined

  if (!accountId) return NextResponse.json({ error: 'account_id required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('accounts')
    .update({ last_full_sync_at: new Date().toISOString() })
    .eq('id', accountId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test app/api/sync/binance/__tests__/full.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add app/api/sync/binance/full/route.ts app/api/sync/binance/__tests__/full.test.ts
git commit -m "feat: POST+PATCH /api/sync/binance/full — chunked trade sync"
```

---

## Task 6: Wire Binance quick sync into existing /api/sync

**Files:**
- Modify: `app/api/sync/route.ts`

The current sync route calls `adapter.getTrades('all', dateRange)` with no `since`. Pass `since = Date.now() - 48h` for Binance to trigger the quick symbol-list logic.

- [ ] **Step 1: Update the getTrades call in runSync()**

In `app/api/sync/route.ts`, find this line:

```typescript
      const trades = await adapter.getTrades('all', dateRange)
```

Replace with:

```typescript
      const since = row.exchange === 'binance'
        ? Date.now() - 48 * 60 * 60 * 1000
        : undefined
      const trades = await adapter.getTrades('all', dateRange, since)
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat: pass since=48h for Binance quick sync in /api/sync"
```

---

## Task 7: Header — notice for Binance accounts without full scan

**Files:**
- Modify: `components/layout/Header.tsx`

The Header needs to know if any Binance account has `last_full_sync_at === null`. It already has a `handleSync` function — add a fetch on mount and a pre-check before syncing.

Note: `last_full_sync_at` is already returned by `GET /api/accounts` (uses `select('*')`) — no route change needed.

- [ ] **Step 1: Update Header.tsx**

Replace the entire contents of `components/layout/Header.tsx` with:

```typescript
'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import { useRouter } from 'next/navigation'
import { TrendingUp, LogOut, User, ChevronDown, Sun, Moon, RefreshCw } from 'lucide-react'
import NavDropdown from './NavDropdown'

interface AccountMeta {
  id: string
  exchange: string
  last_full_sync_at: string | null
}

export default function Header() {
  const { user, logout } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()
  const router = useRouter()

  const [navOpen, setNavOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openNav = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setNavOpen(true)
  }, [])

  const closeNav = useCallback(() => {
    closeTimer.current = setTimeout(() => setNavOpen(false), 300)
  }, [])

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountMeta[]>([])

  // Load account metadata once on mount — used to detect Binance accounts without full scan
  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AccountMeta[]) => setAccounts(data))
      .catch(() => { /* non-critical — notice simply won't show */ })
  }, [])

  const handleSync = useCallback(async () => {
    // Block sync if any Binance account hasn't had its first full scan
    const needsFullScan = accounts.some(
      (a) => a.exchange === 'binance' && a.last_full_sync_at === null
    )
    if (needsFullScan) {
      setSyncMsg('Load full history in API Settings first')
      setTimeout(() => setSyncMsg(null), 4000)
      return
    }

    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const json = await res.json()
      setSyncMsg(res.ok ? `Synced ${json.synced} accounts` : 'Sync failed')
    } catch {
      setSyncMsg('Sync failed')
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(null), 3000)
    }
  }, [accounts])

  return (
    <header
      className="sticky top-0 z-50 px-6 flex items-center justify-between h-14"
      style={{
        background: theme === 'light' ? 'rgba(240,242,245,0.95)' : 'rgba(10,10,10,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Logo + nav trigger */}
      <div
        ref={navRef}
        className="relative flex items-center gap-3 cursor-pointer select-none"
        onMouseEnter={openNav}
        onMouseLeave={closeNav}
      >
        <div
          className="w-7 h-7 rounded flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-blue)' }}
        >
          <TrendingUp className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="hidden sm:block">
          <p
            className="font-bold text-sm tracking-tight leading-none font-heading"
            style={{ color: 'var(--text-primary)' }}
          >
            CICADA FOUNDATION
          </p>
          <p
            className="text-[10px] tracking-widest uppercase leading-none mt-0.5"
            style={{ color: 'var(--text-muted)' }}
          >
            PnL Dashboard
          </p>
        </div>
        <ChevronDown
          className="w-3 h-3 hidden sm:block"
          style={{
            color: 'var(--text-muted)',
            transform: navOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        />
        {navOpen && <NavDropdown />}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {/* Sync Now */}
        <div className="relative flex items-center">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border"
            style={{
              background: 'var(--bg-secondary)',
              borderColor: syncMsg === 'Sync failed' ? 'var(--accent-loss)' : syncMsg ? 'var(--accent-profit)' : 'var(--border-subtle)',
              color: syncMsg === 'Sync failed' ? 'var(--accent-loss)' : syncMsg ? 'var(--accent-profit)' : 'var(--text-muted)',
              opacity: syncing ? 0.7 : 1,
              cursor: syncing ? 'not-allowed' : 'pointer',
            }}
            title="Sync exchange data now"
          >
            <RefreshCw
              className="w-3 h-3"
              style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }}
            />
            <span className="hidden sm:inline font-mono tracking-widest uppercase text-[10px]">
              {syncMsg ?? 'Sync Now'}
            </span>
          </button>
        </div>

        {/* User pill */}
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <User className="w-3 h-3" />
          <span className="text-xs font-medium">{user?.username}</span>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-7 h-7 border"
          style={{
            background: 'var(--bg-secondary)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-muted)',
          }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onMouseEnter={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--accent-gold)'
            el.style.borderColor = 'var(--accent-gold)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--text-muted)'
            el.style.borderColor = 'var(--border-subtle)'
          }}
        >
          {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-transparent"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--accent-loss)'
            el.style.background = 'rgba(255,59,59,0.07)'
            el.style.borderColor = 'rgba(255,59,59,0.18)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget
            el.style.color = 'var(--text-muted)'
            el.style.background = 'transparent'
            el.style.borderColor = 'transparent'
          }}
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 3: Manual spot check**

```bash
npm run dev
```

Open any page. With a Binance account that has `last_full_sync_at = null`: clicking Sync Now shows "Load full history in API Settings first" for 4 seconds instead of syncing. With no Binance accounts or all Binance accounts having a `last_full_sync_at`: Sync Now proceeds normally.

- [ ] **Step 4: Commit**

```bash
git add components/layout/Header.tsx
git commit -m "feat: Header notice for Binance accounts without full scan"
```

---

## Task 8: API Settings — Last Synced column + Load Full History button

**Files:**
- Modify: `app/api-settings/page.tsx`

Note: `fetchAccounts` in `api-settings/page.tsx` is already wrapped in `useCallback` (line ~145 of the existing file) — `handleFullScan` can safely use it as a dependency.

- [ ] **Step 1: Add last_full_sync_at to AccountRow type**

In `app/api-settings/page.tsx`, find the `AccountRow` interface and add:

```typescript
interface AccountRow {
  id: string
  fund: string
  exchange: ExchangeId
  account_name: string
  instrument: string
  account_id_memo?: string
  last_full_sync_at?: string | null   // ← add this line
  status: 'connected' | 'error' | 'not_configured'
  passphrase?: never
  api_key?: never
  api_secret?: never
}
```

- [ ] **Step 2: Add scanState to the page component**

Inside `ApiSettingsPage`, after the existing `useState` declarations, add:

```typescript
type ScanEntry = { current: number; total: number; failed: { symbol: string; error: string }[] }
const [scanState, setScanState] = useState<Record<string, ScanEntry | 'done' | 'error'>>({})
```

- [ ] **Step 3: Add handleFullScan function**

Inside `ApiSettingsPage`, after the `fetchAccounts` declaration, add:

```typescript
  const handleFullScan = useCallback(async (accountId: string) => {
    setScanState((prev) => ({ ...prev, [accountId]: { current: 0, total: 0, failed: [] } }))

    try {
      const marketsRes = await fetch(`/api/sync/binance/markets?account_id=${accountId}`)
      if (!marketsRes.ok) throw new Error('Failed to load markets')
      const { totalChunks, totalSymbols } = (await marketsRes.json()) as {
        totalChunks: number; chunkSize: number; totalSymbols: number
      }

      setScanState((prev) => ({
        ...prev,
        [accountId]: { current: 0, total: totalSymbols, failed: [] },
      }))

      const allFailed: { symbol: string; error: string }[] = []

      for (let i = 0; i < totalChunks; i++) {
        const res = await fetch('/api/sync/binance/full', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: accountId, chunk_index: i }),
        })
        if (res.ok) {
          const data = (await res.json()) as {
            synced: number; failedSymbols: { symbol: string; error: string }[]
          }
          allFailed.push(...data.failedSymbols)
        }
        const symbolsDone = Math.min((i + 1) * 50, totalSymbols)
        setScanState((prev) => ({
          ...prev,
          [accountId]: { current: symbolsDone, total: totalSymbols, failed: allFailed },
        }))
      }

      // Mark scan complete
      await fetch('/api/sync/binance/full', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, done: true }),
      })

      setScanState((prev) => ({ ...prev, [accountId]: 'done' }))
      await fetchAccounts()
    } catch {
      setScanState((prev) => ({ ...prev, [accountId]: 'error' }))
    }
  }, [fetchAccounts])
```

- [ ] **Step 4: Add Last Synced column header to the accounts table**

Find the `<thead>` of the accounts table. Add a `<th>` for "Last Synced" — use the same style as existing `<th>` elements in that table.

```tsx
<th style={{ /* same as other th styles in this table */ }}>Last Synced</th>
```

- [ ] **Step 5: Add Last Synced cell to each account row**

In the account row `<tr>`, add a new `<td>` after the Status cell. Use the same cell padding/font as other cells:

```tsx
<td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)' }}>
  {account.exchange === 'binance' ? (() => {
    const state = scanState[account.id]
    if (state && state !== 'done' && state !== 'error') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 10 }}>
            ⟳ {state.current} / {state.total}
          </span>
          <div style={{ width: 100, height: 3, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: 'var(--accent-profit)',
              width: state.total > 0 ? `${(state.current / state.total) * 100}%` : '0%',
              transition: 'width 0.3s ease',
            }} />
          </div>
          {state.failed.length > 0 && (
            <span style={{ color: 'var(--accent-loss)', fontSize: 10 }}>
              ⚠ {state.failed.length} failed
            </span>
          )}
        </div>
      )
    }
    if (state === 'done') return <span style={{ color: 'var(--accent-profit)' }}>✓ Done</span>
    if (state === 'error') return <span style={{ color: 'var(--accent-loss)' }}>Error</span>
    if (account.last_full_sync_at) {
      return (
        <span style={{ color: 'var(--text-muted)' }}>
          {new Date(account.last_full_sync_at).toLocaleDateString()}
        </span>
      )
    }
    return <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>Never</span>
  })() : (
    <span style={{ color: 'var(--text-muted)', opacity: 0.4 }}>—</span>
  )}
</td>
```

- [ ] **Step 6: Add Load Full History button to the Actions cell for Binance accounts**

In the Actions `<td>` for each account row, add the button alongside the existing TEST/EDIT/REMOVE buttons:

```tsx
{account.exchange === 'binance' && !scanState[account.id] && (
  <button
    onClick={() => handleFullScan(account.id)}
    style={{
      fontSize: 10,
      padding: '3px 8px',
      border: '1px solid var(--border-medium)',
      background: 'transparent',
      color: 'var(--accent-blue)',
      cursor: 'pointer',
      letterSpacing: '0.05em',
    }}
  >
    FULL HISTORY
  </button>
)}
```

- [ ] **Step 7: Auto-trigger full scan on Binance account creation**

Find the `handleCreate` function (or the success block of the POST to `/api/accounts`). After calling `fetchAccounts()`, add:

```typescript
if (form.exchangeId === 'binance') {
  handleFullScan(json.id as string)
}
```

- [ ] **Step 8: Run tests**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 9: Manual end-to-end check**

```bash
npm run dev
```

Open `/api-settings`. Verify:
1. Binance account row shows "Never" under Last Synced if `last_full_sync_at` is null
2. Clicking FULL HISTORY shows progress bar that updates as chunks process
3. On completion: table refreshes, date appears, FULL HISTORY button disappears
4. Any page: Sync Now with a Binance account showing "Never" shows the "Load full history" notice

- [ ] **Step 10: Commit**

```bash
git add app/api-settings/page.tsx
git commit -m "feat: API Settings — Load Full History button with progress bar"
```

---

## Final Verification

```bash
npm test        # all passing, 0 failures
npm run build   # 0 TypeScript errors
```

Manual end-to-end:
1. `/api-settings` → Binance account row shows "Never" under Last Synced
2. Click FULL HISTORY → progress bar appears, updates chunk by chunk
3. On completion → date appears; Header no longer shows notice on Sync Now
4. Sync Now → uses 48h window with balance + top-50 symbols for Binance
5. Create new Binance account → full scan starts automatically
