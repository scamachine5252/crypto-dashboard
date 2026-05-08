# Approach B — Exchange Fills Store (Reference Design)

> Status: **Parked / Not implemented**. Approach C (Hybrid) was chosen instead (May 2026).
> This document is complete enough to implement quickly if we revisit Approach B.

---

## Why It Was Designed

Current architecture reconstructs positions **on-the-fly during sync**, threading state between
HTTP chunks via `inheritedState`. This creates several failure modes:

- Cross-chunk positions (opened in chunk N, closed in chunk N+1) silently disappear if state
  threading is wrong or a chunk is retried.
- No ground truth to diff against: if a sync misses a fill, there's no way to detect it.
- Funding distribution only works within a single chunk; cross-chunk funding is lost.
- Re-sync from scratch is required to fix any reconstruction bug (destructive, loses history).

Approach B eliminates all of these by separating **raw fill storage** from **position reconstruction**.

---

## Architecture Overview

```
API call                 exchange_fills table          trades table
──────────               ─────────────────────         ─────────────────
Bybit execution list ──→ upsert (by fill_id) ──→ reconstruct ALL fills
Binance fapi trades  ──→ upsert (by fill_id) ──→    → emit Trade records
                                                     → upsert trades
```

Two independent, idempotent steps:
1. **Fill sync**: fetch from exchange → upsert into `exchange_fills` (idempotent, no side effects)
2. **Reconstruction**: read ALL fills for account from DB → reconstruct → upsert trades

Reconstruction has complete visibility: no chunking, no state threading, no cross-chunk gaps.

---

## Database Schema

```sql
CREATE TABLE exchange_fills (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  exchange    text        NOT NULL,
  symbol      text        NOT NULL,           -- normalized: 'BTC/USDT:USDT'
  raw_symbol  text        NOT NULL,           -- exchange-native: 'BTCUSDT'
  fill_id     text        NOT NULL,           -- exchange-assigned unique key (see below)
  fill_time   timestamptz NOT NULL,
  side        text        NOT NULL,           -- 'Buy' | 'Sell' (Bybit) / 'BUY' | 'SELL' (Binance)
  exec_type   text,                          -- 'Trade' | 'Funding' | 'AdlTrade' | 'BustTrade'
  exec_price  numeric     NOT NULL,
  exec_qty    numeric     NOT NULL,
  closed_size numeric     NOT NULL DEFAULT 0, -- Bybit only; '0' for opening fills
  exec_fee    numeric     NOT NULL DEFAULT 0,
  exec_pnl    numeric,                        -- NULL when not available from REST (most Bybit accounts)
  funding     numeric,                        -- Bybit SETTLEMENT row funding amount
  raw_payload jsonb,                          -- full raw row for future extraction
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (account_id, fill_id)
);

ALTER TABLE exchange_fills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON exchange_fills
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX exchange_fills_account_symbol_time
  ON exchange_fills (account_id, symbol, fill_time);
```

---

## fill_id Strategy

### Bybit
`fill_id = orderId + '_' + execTime + '_' + execQty`

- `orderId` alone is NOT unique for partial fills (one order → many fills with same orderId).
- `execTime` can collide for near-simultaneous fills on the same order.
- The triple (`orderId`, `execTime`, `execQty`) is unique in practice.
- Deterministic: same fill always produces the same ID, so re-sync is safe.

### Binance
`fill_id = String(r.id)`

- Binance assigns a globally unique `id` (trade ID) to each fill.
- Reliable, no composite key needed.

---

## Fill Sync Routes

### Bybit fill sync: `POST /api/sync/bybit/fills`

```
Body: { account_id, chunk_index, total_chunks? }
```

Same 7-day chunking as current full-sync route (26 chunks × 7 days = 182 days).
Fetches `privateGetV5ExecutionList` with `execType=Trade` AND `execType=Funding`.

Maps to `exchange_fills` row:
```typescript
{
  account_id,
  exchange:    'bybit',
  symbol:      normalizeBybitSymbol(exec.symbol),   // e.g. BTCUSDT → BTC/USDT:USDT
  raw_symbol:  exec.symbol,
  fill_id:     `${exec.orderId}_${exec.execTime}_${exec.execQty}`,
  fill_time:   new Date(Number(exec.execTime)).toISOString(),
  side:        exec.side,
  exec_type:   exec.execType,
  exec_price:  Number(exec.execPrice),
  exec_qty:    Number(exec.execQty),
  closed_size: Number(exec.closedSize ?? 0),
  exec_fee:    Number(exec.execFee ?? 0),
  exec_pnl:    exec.execPnl ? Number(exec.execPnl) : null,
  raw_payload: exec,
}
```

Upsert: `ON CONFLICT (account_id, fill_id) DO NOTHING` — pure idempotent.

### Binance fill sync: `POST /api/sync/binance/fills`

```
Body: { account_id, symbol, week_index }
```

Same `fapiPrivateGetUserTrades` call as current adapter.
Maps Binance trade to `exchange_fills` row.
Upsert by `fill_id = String(r.id)`.

---

## Reconstruction Route: `POST /api/sync/reconstruct`

```
Body: { account_id }
```

1. Read ALL fills for account from `exchange_fills` WHERE `exec_type IN ('Trade', 'Funding')`, ordered by `fill_time ASC`.
2. Run stateful reconstruction (same algorithm as current `reconstructPositions()`) — but over the COMPLETE fill set, no chunking.
3. Collect reconstructed `Trade[]`.
4. Atomically replace trades in DB:
   ```sql
   -- Supabase RPC (atomic transaction)
   DELETE FROM trades WHERE account_id = $1 AND exchange = $2;
   INSERT INTO trades ... (reconstructed set);
   ```
5. Return `{ trades_inserted, fills_read }`.

Because reconstruction reads from DB (not API), it:
- Runs in < 30s even for 20,000 fills
- Can be re-run any time to fix bugs without re-fetching from exchange
- Produces identical results every time for same fill set

---

## Reconciliation

With fills stored in DB, reconciliation against an exchange export CSV becomes a simple query:

```sql
-- Fills in DB but not in CSV:
SELECT fill_id, fill_time, exec_qty, exec_fee
FROM exchange_fills
WHERE account_id = $1
  AND fill_time BETWEEN $start AND $end
  AND fill_id NOT IN (/* parsed fill_ids from CSV */);

-- Fills in CSV but not in DB:
-- (done in application layer: parse CSV, check fill_id against DB)
```

This is the key capability that Approach C (Hybrid) cannot offer.

---

## Trade Replacement Atomicity

Current upsert-on-conflict is not atomic: if reconstruction produces different closed positions
(e.g., more splits after a bug fix), old records persist unless explicitly deleted.

Approach B uses a DB transaction:

```typescript
// Supabase RPC
await supabase.rpc('replace_account_trades', {
  p_account_id: accountId,
  p_exchange:   'bybit',
  p_trades:     reconstructedTrades,
})
```

```sql
CREATE OR REPLACE FUNCTION replace_account_trades(
  p_account_id uuid,
  p_exchange   text,
  p_trades     jsonb
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM trades WHERE account_id = p_account_id AND exchange = p_exchange;
  INSERT INTO trades SELECT * FROM jsonb_populate_recordset(NULL::trades, p_trades);
END;
$$;
```

---

## Migration Required

```sql
-- Migration 028 (not applied)
CREATE TABLE exchange_fills ( ... );  -- see schema above

-- No changes to existing tables.
-- After fills are synced: run reconstruct route → trades table rebuilt from fills.
```

---

## Effort Estimate

| Task | Effort |
|------|--------|
| Migration 028 (fills table) | 30 min |
| Bybit fill sync route (26 chunks) | 1 day |
| Binance fill sync route | 1 day |
| Reconstruction route (reads fills → emits trades) | 1 day |
| `replace_account_trades` RPC | 2 hours |
| UI: fill sync progress in API Settings | 4 hours |
| Full re-sync of all accounts | 1 hour (operational) |
| **Total** | **~4 days** |

---

## Why Approach C Was Chosen Instead

| Factor | Approach B | Approach C (Hybrid) |
|--------|-----------|---------------------|
| Reliability | Highest — fills never lost | High — fixes specific root causes |
| Time to fix current bugs | ~4 days | ~8 days (Phases 1+2) |
| Schema change | New table required | No new table |
| Reconciliation | Native (fill-level diff) | Not available |
| Operational complexity | Higher (3-step pipeline) | Similar to current |
| Risk | Medium (large refactor) | Lower (targeted fixes) |

Approach C was chosen because it fixes the current bugs with lower risk, while Approach B
offers a fundamentally stronger architecture at higher implementation cost.

---

## When to Revisit

Consider returning to Approach B if:
- A new fill-loss bug is discovered after Approach C is deployed
- Reconciliation against CSV exports is needed as a routine audit tool
- The fills table would power new features (fill-level analytics, partial-fill display)
- A clean re-sync after a reconstruction algorithm change is needed without re-fetching from exchange

---

*Documented 2026-05-02. Author: Claude (Sonnet 4.6). Approved for implementation if team decides to proceed.*
