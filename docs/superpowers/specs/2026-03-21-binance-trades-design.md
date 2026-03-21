# Binance Trades Sync — Design Spec

> Date: 2026-03-21

---

## Problem

Binance API requires a specific symbol for every `fetchMyTrades` call. Without a symbol, the request throws an error, causing the entire account sync to fail. Currently `BinanceAdapter.getTrades()` returns an empty array as a placeholder.

---

## Goals

- Fetch all trades (spot + futures USDT-M) for Binance accounts
- Cover full 180-day history including closed/delisted pairs
- Surface specific symbol-level errors — no silent failures
- Keep Sync Now fast (<20 sec) on Vercel Hobby plan (10 sec limit per API call)
- Initial full scan runs once per account, not on every sync

> **Note on COIN-M futures (delivery):** COIN-M pairs are quoted in BTC/ETH/etc. (e.g., `BTCUSD`), not USDT. Including them requires a separate symbol filter pass and a `type: 'delivery'` market query. This is deferred to a future iteration — COIN-M represents a small fraction of accounts and adds implementation complexity disproportionate to current needs.

---

## Architecture

### Two Sync Modes

| Mode | Trigger | Symbol list | Time window | Vercel calls |
|---|---|---|---|---|
| **Quick sync** | Sync Now button / Cron | Balance tokens + top-50 common pairs | Last 48h | 1 API call |
| **Full scan** | Account creation / "Load Full History" button | All active + delisted USDT pairs via `loadMarkets()` | Last 180 days | N chunked API calls (N = `ceil(totalSymbols / 50)`) |

### Symbol Lists

**Quick sync symbol list (~50–70 symbols):**
- At the start of `BinanceAdapter.getTrades()`, call `this.exchange.fetchBalance({ type: 'spot' })` to get the current token list. This is a separate call inside the adapter — the `ExchangeAdapter` interface signature does not change.
- Derive `TOKEN/USDT` pairs from the returned token keys.
- Merge with the hardcoded top-50 constant defined inside `lib/adapters/binance.ts`.
- Deduplicate, then call `fetchMyTrades(symbol, since=48h)` for each.

**Full scan symbol list (variable, ~600–700 symbols):**
- `loadMarkets()` is a **public, unauthenticated** Binance endpoint — returns all exchange-wide markets, not per-account. No credentials needed.
- Filter: all USDT-quoted markets (`market.quote === 'USDT'`), **including inactive** (`active: false`)
- Types included: spot + linear (USDT-M futures)
- Do NOT filter by `active: true` — delisted pairs still have historical trade data

### `getFullTrades` — Binance-Specific Method

`BinanceAdapter` exposes a second method:

```typescript
async getFullTrades(symbols: string[], accountId: string): Promise<FullTradesResult>
```

This method is **not part of the `ExchangeAdapter` interface**. It is called directly by the new `/api/sync/binance/full` route, which always constructs a `BinanceAdapter` explicitly.

### Stateless Chunking — loadMarkets Called Per Chunk

The full-scan routes are **stateless**. The `/api/sync/binance/markets` route computes the total chunk count. Each `/api/sync/binance/full` request independently calls `loadMarkets()` and slices the correct symbols for its `chunk_index`. This is acceptable because:
- CCXT caches `loadMarkets()` internally for the lifetime of the exchange instance (no repeated HTTP calls within one request)
- `loadMarkets()` is a fast public endpoint (~100–200ms)
- No Redis or external cache is required

### Client-Side Orchestration (Full Scan Only)

The browser drives the full scan to stay within Vercel's 10-second function timeout.

**Step 1 — Get chunk metadata:**
```
GET /api/sync/binance/markets?account_id=<uuid>
→ { totalChunks: 13, chunkSize: 50, totalSymbols: 647 }
```
The `account_id` query param is accepted for logging/future filtering but **not validated** against the database in this iteration — `loadMarkets()` is public and requires no credentials.

**Step 2 — Sync each chunk sequentially:**
```
POST /api/sync/binance/full  body: { account_id, chunk_index: 0 }
POST /api/sync/binance/full  body: { account_id, chunk_index: 1 }
...
POST /api/sync/binance/full  body: { account_id, chunk_index: N-1 }
```

**Step 3 — Mark scan complete:**
```
PATCH /api/sync/binance/full  body: { account_id, done: true }
```
Sent after the last chunk, regardless of symbol-level failures (see `last_full_sync_at` rules below).

**`since` parameter:** computed server-side as `Date.now() - 180 * 24 * 60 * 60 * 1000`. The client does not pass it.

**Page reload / navigation away mid-scan:** aborts the scan silently. `last_full_sync_at` remains `null`. The user must restart via the Load Full History button. No server-side progress state is stored.

### Error Handling

**Per-symbol retry (server-side, within the same chunk request):**
- Max **1 retry** per symbol after a 500ms delay. Rationale: with 50 symbols per chunk, a 7-second base fetch time plus 1 retry per failing symbol at 500ms delay stays well within the 10-second budget. More retries risk timeout.
- If the symbol still fails after 1 retry: mark as failed, continue.

**Persistent errors per symbol**: log symbol + error message, continue with remaining symbols in the chunk.

**Response** always includes `failedSymbols: [{ symbol: string; error: string }]`.

**UI**: show warning "⚠ 3 symbols failed" with expandable list of symbol names + errors.

---

## Data Flow

```
Full scan triggered (account add OR button click)
    → GET /api/sync/binance/markets?account_id=<uuid>
        → Server: calls loadMarkets() (public, no credentials)
        → Chunks all USDT-quoted symbols into arrays of 50
        → Returns { totalChunks: N, chunkSize: 50, totalSymbols: M }
    → Browser loops: POST /api/sync/binance/full for chunk_index 0..N-1
        → Server: calls loadMarkets() again (stateless), slices chunk
        → Fetches account credentials from Supabase by account_id
        → fetchMyTrades(symbol, since=180d) per symbol via Promise.allSettled
        → Retry failed symbols once after 500ms
        → Upsert fulfilled trades to Supabase
        → Return { synced: number; failedSymbols: { symbol: string; error: string }[] }
    → Browser aggregates results, updates progress bar
    → On last chunk done: PATCH /api/sync/binance/full { account_id, done: true }
        → Server writes last_full_sync_at = NOW() to accounts table

Quick sync (Sync Now / Cron)
    → POST /api/sync (existing route, enhanced)
        → For Binance: getTrades() calls fetchBalance internally to get token list,
          merges with top-50 constant, window=48h
        → For Bybit/OKX: existing logic (all categories, since=48h)
    → Single call, <20 sec
```

---

## Response Schemas

### `GET /api/sync/binance/markets`

```typescript
interface MarketsResponse {
  totalChunks: number   // ceil(totalSymbols / chunkSize)
  chunkSize: number     // 50
  totalSymbols: number  // actual count from loadMarkets()
}
```

### `POST /api/sync/binance/full`

Request body:
```typescript
interface FullSyncChunkRequest {
  account_id: string
  chunk_index: number
}
```

Response body:
```typescript
interface FullSyncChunkResponse {
  synced: number
  failedSymbols: { symbol: string; error: string }[]
}
```

### `PATCH /api/sync/binance/full`

Request body:
```typescript
interface FullSyncCompleteRequest {
  account_id: string
  done: true
}
```

Response: `{ ok: true }`
Side-effect: `UPDATE accounts SET last_full_sync_at = NOW() WHERE id = account_id`

---

## Database Changes

### Migration 008: `last_full_sync_at` on accounts

```sql
ALTER TABLE accounts ADD COLUMN last_full_sync_at timestamptz;
```

**When `last_full_sync_at` is written:**
- Written after the client sends the PATCH completion signal — i.e., after all chunks have been processed (sent to the server), **regardless of symbol-level failures**. Symbol failures are surfaced in the UI via the RETRY button but do not block the timestamp.
- If the scan is interrupted mid-way (page reload, browser close), `last_full_sync_at` remains `null` — the account stays in "needs full scan" state.
- Partial runs do not write a partial timestamp.

### Existing trades table

No schema changes needed. Full scan upserts into the same `trades` table via the existing `(account_id, symbol, opened_at)` unique constraint.

**Known limitation — same-timestamp fills:** For Binance spot trades, two fills of the same symbol at the exact same millisecond are theoretically possible (large order split into simultaneous fills). The second fill would be silently dropped by the upsert's conflict resolution. This is an edge case with negligible real-world impact for the current user base and is documented here as a known limitation for future resolution (e.g., incorporating the exchange trade `id` into the conflict key).

---

## New API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/sync/binance/markets` | GET | Returns chunk metadata. `account_id` accepted as query param (not validated). |
| `/api/sync/binance/full` | POST | Syncs one chunk. `account_id` in body used to fetch credentials and upsert. |
| `/api/sync/binance/full` | PATCH | Marks scan complete. Writes `last_full_sync_at`. |

Existing `/api/sync` route updated:
- Binance: `getTrades()` uses quick symbol list + 48h window instead of empty return.

---

## UI Changes

### Header — Sync Now button

No change to trigger. On click:
- For Binance accounts with `last_full_sync_at IS NULL`: show inline notice "Full history not yet loaded. Go to API Settings."
- For all others: quick sync as normal

### `/api-settings` — Accounts table

New column: **Last Synced**

| Account | ... | Last Synced | Actions |
|---|---|---|---|
| Leonardo Bybit | ... | 2h ago | TEST · EDIT · REMOVE |
| Tabtrader Binance | ... | ⟳ Syncing 45/650... | — |
| Ryan Bybit | ... | ⚠ 3 symbols failed | TEST · EDIT · REMOVE · RETRY |

New button per Binance account: **Load Full History**
- Triggers client-side orchestration
- Shows inline progress bar: `Fetching symbols... 250 / 650`
- On error: shows expandable list of failed symbols
- Button disabled while scan is in progress (prevents double-trigger)

New event: account creation → auto-trigger full scan immediately after CREATE ACCOUNT succeeds.

---

## Files Changed

| File | Change |
|---|---|
| `lib/adapters/binance.ts` | `getTrades()`: calls `fetchBalance({type:'spot'})` internally to get token list, merges with TOP_50 constant, fetches 48h window. `getFullTrades(symbols, accountId)`: Binance-specific method, called by full-scan route. |
| `lib/adapters/types.ts` | No change — `getFullTrades` is Binance-specific, not on the shared interface. |
| `app/api/sync/route.ts` | Binance: call `adapter.getTrades()` with `since = Date.now() - 48h`. No other change needed — token list is handled internally by the adapter. |
| `app/api/sync/binance/markets/route.ts` | New: calls `loadMarkets()` (public, no credentials), filters USDT-quoted markets, returns `{ totalChunks, chunkSize, totalSymbols }`. |
| `app/api/sync/binance/full/route.ts` | New: POST syncs one chunk (calls `loadMarkets()` again, slices by `chunk_index`, upserts); PATCH writes `last_full_sync_at`. |
| `supabase/migrations/008_add_last_full_sync_at.sql` | New nullable `last_full_sync_at` column on accounts. |
| `app/api-settings/page.tsx` | Add Last Synced column, Load Full History button, progress bar, failed symbols list. |
| `components/layout/Header.tsx` | Notice for Binance accounts with `last_full_sync_at IS NULL`. |
| `lib/adapters/__tests__/binance.test.ts` | New: unit tests for `getTrades()` — mock `fetchBalance` and `fetchMyTrades`, assert: (a) token-derived symbols are included, (b) TOP_50 symbols are included, (c) `since` is ~48h ago. Tests for `getFullTrades()` — mock `fetchMyTrades`, assert: (a) retry happens once on transient error, (b) failed symbols collected correctly, (c) spot and USDT-M (linear) market types are covered; COIN-M (delivery) is explicitly NOT tested (out of scope per goals). |
| `app/api/sync/binance/__tests__/markets.test.ts` | New: mock `loadMarkets()` with known fixture, assert correct `totalChunks` and `chunkSize`. |
| `app/api/sync/binance/__tests__/full.test.ts` | New: mock `getFullTrades`, assert upsert call and response shape; test PATCH writes `last_full_sync_at`; test that PATCH is sent even when `failedSymbols` is non-empty. |

---

## Out of Scope

- OKX and Bybit: no changes needed (they already fetch all categories without symbol)
- COIN-M futures (delivery): deferred — USDT-quoted pairs cover the primary use case
- Re-syncing beyond 180 days
- Real-time WebSocket trade streaming
- Binance sub-account support
- Server-side progress persistence (page reload aborts scan — user restarts manually)
- Validating `account_id` in the markets route against the database
