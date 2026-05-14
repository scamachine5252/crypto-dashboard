# Crypto Hedge Fund Dashboard — Claude Instructions

---

## Project State
*Update this section after every major change.*

### Status: Phase 2 complete — data reliability layer, Binance IP ban protection, worker observability

### What has been built

**App name:** CICADA FOUNDATION — a professional crypto hedge fund PnL dashboard with Wintermute dark theme and Cicada light theme.

**Pages complete:**
- `/dashboard` — fund cards grouped by fund name (AUM + PnL), 10 metric cards, equity-curve chart (Area + period Bars), PeriodSelector embedded in chart header; all data from Supabase via `/api/dashboard`
- `/performance` — PeriodSelector + accounts checkbox dropdown; **L1 tabs** SPOT/FUTURES; **L2 tabs** per category; per-account metrics table with polarity-aware best/worst highlighting; `OverlayLineChart` equity curves; **Open Positions** section (real-time via `/api/positions` + `/api/positions/open-times`)
- `/history` — sticky header + TradeFilters bar; OrdersTable; Export CSV/PDF; all data from Supabase via `/api/trades`
- `/results` — USDT balance line chart + PnL histogram; balance table; pair filter; data from `/api/results` + `/api/transactions`
- `/api-settings` — Create/Edit/Remove accounts; Test connection; Full History Sync button (enqueue + poll); **Worker Status panel** (alive/stale badge, last heartbeat, per-account data freshness, Binance ban indicator); keys AES-256-GCM encrypted
- `/risk-management` — risk rules, live metrics, alerts, snapshots

**Credentials:** `admin` / `admin123`
**Dev server:** `npm run dev` → `http://localhost:3000`
**Production:** Hetzner `116.203.244.97`; deploy via `git push origin main` (GitHub Actions auto-deploys)

---

### Infrastructure complete

**Sync architecture (Hetzner worker):**
- `worker/index.ts` — entry point; starts ConnectorManager + FullHistorySyncer + BalancePoller + ReconciliationScheduler; writes heartbeat to `worker_status` every 5 min
- `worker/full-history-syncer.ts` — BRPOP queue consumer; processes `full_sync_jobs` one at a time; Redis distributed lock per account; stuck-job recovery on start (>10 min in `processing` → reset to `pending`); auto-retry up to 3× with 1h backoff when `failed_items` or `failed` status
- `worker/reconciliation-scheduler.ts` — REST reconciliation: non-Binance every 6h, Binance every 24h (500ms delay between symbols); checks BinanceBanGuard before Binance requests; writes to `raw_fills` + triggers reconstruction
- `worker/binance-ban-guard.ts` — singleton; detects 418 "banned until <ms>" errors; blocks all further Binance requests in-process; persists `binance_ban_until` to `worker_status` Supabase row; survives across reconcile/balance poll calls
- `worker/connector-manager.ts` — manages WebSocket connectors per exchange
- `worker/connectors/` — per-exchange WS connectors (Bybit, Binance, OKX, MEXC); **startup gap fill before first connect**; `lastFillTime` watermark advances after each gap fill to prevent re-fetching on reconnect
- `worker/balance-poller.ts` — split: non-Binance every 15 min (parallel), Binance every 60 min (sequential, ban-guard checked)
- `worker/fill-processor.ts` — processes WebSocket fills into `raw_fills`
- `worker/position-reconstructor.ts` — rebuilds `trades` from `raw_fills` per exchange; deduplicates before upsert; uses `ignoreDuplicates: true` to safely handle duplicate conflict keys in same batch
- PM2 on Hetzner: processes `next-app` (×2) + `sync-worker`; `ecosystem.config.js` at `/app/crypto-dashboard/`

**Full History Sync flow:**
1. Browser: `POST /api/sync/enqueue` → creates `full_sync_jobs` row + `LPUSH fullscan:queue`
2. Worker: BRPOP → acquires Redis lock → marks job `processing` → runs exchange sync via localhost HTTP → calls `/api/sync/reconstruct` → marks `completed` (or `failed` with error_message)
3. Browser: polls `GET /api/sync/job/[jobId]` every 2s; shows progress bar
4. Recovery: on worker start, jobs stuck >10 min in `processing` are reset to `pending`

**Exchange-specific sync routes:**
- `app/api/sync/binance/discover/route.ts` — discovers traded symbols from REALIZED_PNL income events (2 paginated requests for PM, 6×30d windows for regular); returns `{ symbols: [{ rawSymbol, weekIndices }] }`
- `app/api/sync/binance/full/route.ts` — POST: fetches fills for one symbol × specified week indices; writes `raw_fills` + reconstructed `trades`; PATCH: writes `last_full_sync_at`
- `app/api/sync/bybit/full/route.ts` — POST: one 7-day chunk; writes `raw_fills`; PATCH: writes `last_full_sync_at`
- `app/api/sync/okx/full/route.ts` — POST: one 30-day chunk; uses `reference_timestamp` from body to avoid boundary drift
- `app/api/sync/mexc/full/route.ts` — POST: one 90-day chunk; uses `reference_timestamp` from body
- `app/api/sync/reconstruct/route.ts` — POST: runs `PositionReconstructor` for all fills of an account
- `app/api/sync/enqueue/route.ts` — POST: creates job + pushes to Redis; returns 409 if lock held
- `app/api/sync/job/[jobId]/route.ts` — GET: job status polling

**Other API routes:**
- `app/api/accounts/route.ts` — GET list, POST create (auto-detects Binance instrument; `unified` default)
- `app/api/accounts/[id]/route.ts` — DELETE
- `app/api/exchanges/[exchange]/ping/route.ts` — POST: test connection
- `app/api/exchanges/[exchange]/balance/route.ts` — POST: fetch real-time balance
- `app/api/dashboard/route.ts` — GET: metrics + chart data from Supabase
- `app/api/performance/route.ts` — GET: per-account metrics
- `app/api/positions/route.ts` — GET: live open positions via CCXT
- `app/api/positions/open-times/route.ts` — POST: resolve open times for Binance positions
- `app/api/trades/route.ts` — GET: trades from Supabase with filters
- `app/api/results/route.ts` — GET: balance history + PnL
- `app/api/transactions/route.ts` — GET: deposit/withdrawal history
- `app/api/risk/` — rules, alerts, evaluate, live-metrics, snapshots
- `app/api/worker-status/route.ts` — GET: worker heartbeat age + alive/stale status; Binance ban state from `worker_status`; per-account last fill timestamp + stale flag (>24h)

**Adapters (`lib/adapters/`):**
- `binance.ts` — `BinanceAdapter`; `discoverTradedSymbols()` (PM: 2 paginated PAPI requests; regular: 6×30d fapiPrivateGetIncome); `getFullTrades(symbol, weekIndices)` — fetches fills for specified weeks only; throws on exchange errors (no silent `[]`)
- `bybit.ts` — chunks 26×7d; `raw_fills` via CCXT `fetchMyTrades`; 4 categories (spot/linear/inverse/option)
- `okx.ts` — chunks 6×30d; 5 instTypes; `reference_timestamp` anchors chunk boundaries
- `mexc.ts` — 1×90d chunk
- `ccxt-utils.ts` — `mapCcxtTrade()`: PnL from all exchange field names; NaN-safe; tradeType from symbol

**Database (31 migrations applied):**
- `accounts` — id, account_name, fund, exchange, instrument (`unified`/`futures`/`spot`/`portfolio_margin`/`margin`), api_key/secret/passphrase (AES-256-GCM encrypted), account_id_memo, last_full_sync_at, full_sync_failed_count, initial_aum, is_suspended
- `balances` — daily snapshots per account; unique on `(account_id, token_symbol, DATE(snapshot_date))`
- `trades` — reconstructed closed trades; unique on `(account_id, symbol, opened_at, closed_at)`
- `raw_fills` — individual exchange fills; unique on `(account_id, exchange, exec_id)`
- `full_sync_jobs` — id, account_id, exchange, status (pending/processing/completed/failed), current_step, total_steps, **retry_count** (int, default 0), failed_items (jsonb), error_message, started_at, completed_at
- `worker_status` — singleton (id=1); last_heartbeat, started_at, **binance_ban_until** (timestamptz nullable); read by `/api/worker-status` and `BinanceBanGuard` on startup
- `transactions` — deposits/withdrawals
- `risk_rules`, `risk_alerts`, `risk_monitor_snapshots`

**Infrastructure files:**
- `lib/crypto/encrypt.ts` + `decrypt.ts` — AES-256-GCM; random IV per call; GCM auth tag tamper detection
- `lib/supabase/server.ts` — `supabaseAdmin` (service role, bypasses RLS)
- `lib/supabase/client.ts` — browser client
- `ecosystem.config.js` — PM2 config on Hetzner
- `.github/workflows/deploy.yml` — CI/CD: `git pull && npx next build && pm2 reload all`
- Redis: `REDIS_URL` in `.env.local`; keys `fullscan:queue` (job queue), `fullscan:lock:{accountId}` (distributed lock, TTL 3600s)
- Supabase Edge Function: `supabase/functions/watchdog/index.ts` — deployed to Supabase; called by pg_cron every 30 min; if `worker_status.last_heartbeat` is stale (>30 min), creates `pending` `full_sync_jobs` for all accounts that don't already have an active job → worker picks them up on restart via `recoverOnStartup()`

**Tests:** 672 passing, 2 pre-existing failures (binance-connector WS URL tests)

---

### File Structure

```
crypto-dashboard/          ← project root (NOT src/)
├── app/
│   ├── globals.css        ← dark + light CSS variables, Tailwind v4 @theme block
│   ├── layout.tsx         ← root layout: Inter, Space Grotesk, Geist Mono; anti-flash script
│   ├── providers.tsx      ← 'use client'; ThemeProvider + AuthProvider
│   ├── dashboard/page.tsx ← fund cards + metrics + equity chart; data from /api/dashboard
│   ├── performance/page.tsx ← metrics deep-dive + open positions; data from /api/performance + /api/positions
│   ├── history/page.tsx   ← trade log + filters + export; data from /api/trades
│   ├── results/page.tsx   ← balance charts + comparison table; data from /api/results
│   ├── api-settings/page.tsx ← account CRUD + full history sync UI (enqueue+poll)
│   ├── risk-management/page.tsx ← risk rules, alerts, live metrics
│   └── api/
│       ├── accounts/      ← GET list, POST create (auto-detect instrument)
│       ├── accounts/[id]/ ← DELETE
│       ├── dashboard/     ← GET metrics + chart from Supabase
│       ├── exchanges/[exchange]/ping|balance|trades/
│       ├── performance/   ← GET per-account metrics
│       ├── positions/     ← GET live open positions (CCXT)
│       ├── positions/open-times/ ← POST resolve Binance open times
│       ├── trades/        ← GET trades with filters
│       ├── results/       ← GET balance history + PnL
│       ├── transactions/  ← GET deposits/withdrawals
│       ├── risk/          ← rules, alerts, evaluate, live-metrics, snapshots
│       └── sync/
│           ├── route.ts   ← GET/POST incremental sync (all accounts)
│           ├── enqueue/   ← POST create full_sync_job + push to Redis
│           ├── job/[jobId]/ ← GET job status
│           ├── reconstruct/ ← POST run PositionReconstructor
│           ├── binance/discover|full/
│           ├── bybit/chunks|full|debug/
│           ├── okx/chunks|full/
│           ├── mexc/chunks|full/
│           ├── balance-backfill/
│           └── transactions-backfill/
│
├── worker/
│   ├── index.ts               ← entry; starts ConnectorManager + FullHistorySyncer + BalancePoller + ReconciliationScheduler; heartbeat every 5 min
│   ├── full-history-syncer.ts ← BRPOP consumer; Redis lock; stuck-job recovery; auto-retry ≤3× with 1h backoff
│   ├── reconciliation-scheduler.ts ← REST reconciliation every 6h (non-Binance) + 24h (Binance); ban-guard checked
│   ├── binance-ban-guard.ts   ← singleton; detects 418 bans; persists to worker_status; blocks in-process
│   ├── position-reconstructor.ts ← rebuilds trades from raw_fills; dedup + ignoreDuplicates:true upsert
│   ├── connector-manager.ts   ← manages WS connectors
│   ├── connectors/            ← per-exchange WS connectors; startup gap fill + lastFillTime watermark
│   ├── fill-processor.ts      ← WS fills → raw_fills
│   ├── balance-poller.ts      ← non-Binance every 15 min parallel; Binance every 60 min sequential + ban-guard
│   └── tsconfig.json
│
├── supabase/
│   ├── migrations/            ← 031 migrations applied
│   └── functions/
│       └── watchdog/index.ts  ← Edge Function; checks heartbeat; creates recovery jobs when worker stale
│
├── components/
│   ├── auth/LoginForm.tsx
│   ├── layout/Header.tsx, NavDropdown.tsx, AuthGuard.tsx
│   ├── ui/PeriodSelector.tsx
│   ├── metrics/MetricCard.tsx, MetricsGrid.tsx, BalanceCards.tsx, MetricSelector.tsx, FuturesMetricsTiles.tsx
│   ├── charts/PnLChart.tsx, MetricLineChart.tsx, OverlayLineChart.tsx, BalanceLineChart.tsx, PnlHistogramChart.tsx
│   ├── orders/TradeFilters.tsx, ExportButton.tsx, OrdersTable.tsx, ComparisonTable.tsx
│   └── api/StatusBadge.tsx, ApiKeyInput.tsx, ExchangeCard.tsx
│
├── lib/
│   ├── types.ts           ← ALL shared interfaces
│   ├── utils.ts           ← formatMoney, formatPercent, formatDate, cn
│   ├── calculations.ts    ← all metric formulas (TDD)
│   ├── auth-context.tsx   ← AuthProvider + useAuth (localStorage, admin/admin123)
│   ├── theme-context.tsx  ← ThemeProvider + useTheme
│   ├── nav.ts             ← NAV_ITEMS — only file to edit when adding a page
│   ├── crypto/encrypt.ts + decrypt.ts
│   ├── supabase/client.ts + server.ts
│   ├── adapters/binance.ts, bybit.ts, okx.ts, mexc.ts, ccxt-utils.ts, types.ts
│   └── __tests__/calculations.test.ts, regression.test.ts, crypto.test.ts, supabase.test.ts
│
├── ecosystem.config.js    ← PM2 config (Hetzner)
└── .github/workflows/deploy.yml ← CI/CD auto-deploy
```

---

### Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Root layout | `app/` (not `src/`) | Default Next.js scaffold |
| App name | CICADA FOUNDATION | Institutional branding |
| Auth | localStorage + React Context; AuthGuard per page layout | Simple; swap for JWT when needed |
| Sync architecture | Worker (Hetzner) + Redis queue + DB jobs | Survives tab close, nginx timeout, rate limit conflicts |
| Full history sync | Browser enqueues job → worker processes → browser polls status | Decoupled; browser is just UI, not executor |
| Distributed lock | Redis SET NX EX 3600 per accountId | Prevents parallel syncs of same account |
| Binance discover | PM: 2 paginated PAPI requests; regular: 6×30d windows | PM was doing 360 requests (52 windows × 7 symbols) |
| raw_fills layer | Separate table before trade reconstruction | Allows re-running reconstruction without re-fetching API |
| Position reconstruction | PositionReconstructor reads raw_fills, writes trades | Separates fill ingestion from trade logic |
| Deduplication | Map by (symbol, openedAt, closedAt) before upsert + `ignoreDuplicates: true` | Prevents Postgres "ON CONFLICT DO UPDATE affect row a second time" even when batch has duplicate keys |
| Instrument default | `unified` for all new accounts | Bybit/OKX are always unified; Binance auto-detected |
| Cron | Removed from Vercel; incremental sync handled by worker | Vercel cron has 30s timeout; worker has no limit |
| Styling | Tailwind v4 + CSS variables in globals.css | No tailwind.config.js needed |
| Color palette (dark) | bg-primary `#0A0A0F`, profit `#00FF88`, loss `#FF3B3B`, gold `#FFD700` | Bloomberg-terminal aesthetic |
| Exchange colors | Binance `#F0B90B`, Bybit `#FF6B2C`, OKX `#4F8EF7` | Official brand colors |
| Binance polling | Sequential, every 60 min, ban-guard checked | Parallel polling + aggressive reconciliation triggered IP bans |
| Binance reconciliation | Separate 24h timer, 500ms delay between symbols | Keeps rate well below ban threshold |
| BinanceBanGuard | Singleton; parses "banned until <ms>" from 418; persists to DB | Single place to detect + block; survives reconnects and new reconcile runs |
| Worker observability | `worker_status` singleton table + `/api/worker-status` + UI panel | Real-time visibility of worker health and data freshness per account |
| Supabase watchdog | Edge Function + pg_cron every 30 min | Independent of Hetzner; creates recovery jobs when worker is stale |

---

### Known limitations

- **Binance IP ban**: handled via `BinanceBanGuard` — detects 418 "banned until <ms>", blocks in-process, persists to DB. Balance polling is sequential 1h, reconciliation is 24h with 500ms delays. Ban state visible in `/api-settings` UI.
- **Single Hetzner server**: no redundancy. Edge Function watchdog creates recovery jobs if worker goes offline; `recoverOnStartup()` processes them on restart.
- **Hyperliquid**: integration planned (wallet-based auth, CCXT confirmed); waiting for fund to go live.
- **Mock data** (`lib/mock-data.ts`): still present for fallback/dev; pages use real API data in production.

---

## Next Steps

No approved plan currently. Candidates:
- Hyperliquid integration (when fund goes live)
- Risk management page polish
- Performance improvements (pagination in history, virtual scrolling)

---

## Deployment

```bash
# Local → production
git push origin main
# GitHub Actions runs: git pull && npx next build && pm2 reload all

# Manual deploy on server
ssh root@116.203.244.97
cd /app/crypto-dashboard && git pull && npx next build && pm2 reload all

# Check worker logs
pm2 logs sync-worker --lines 50 --nostream

# Check job status (local)
node -e "
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
sb.from('full_sync_jobs').select('*').order('created_at', { ascending: false }).limit(10)
  .then(({ data }) => data.forEach(j => console.log(j.status, j.exchange, j.current_step+'/'+j.total_steps, 'failed:'+j.failed_items?.length)))
"
```

---

## Skill: TDD

All functions in `lib/calculations.ts` must be developed test-first using Jest.

### Rules

- **Write tests before implementation.** Never add a new calculation function without a failing test first.
- **Test file location:** `lib/__tests__/calculations.test.ts` — no exceptions.
- **Regression tests:** `lib/__tests__/regression.test.ts` — do NOT delete tests from this file. Every bug fixed in production gets a test here.
- **Run before claiming done:** `npx tsc --noEmit && npm test` — both must exit 0. No exceptions.

### Workflow for every new calculation

1. Write a `describe` block in `calculations.test.ts` for the new function.
2. Add `it()` cases covering: normal input, edge cases (empty array, zeros, single element), and negative values.
3. Run `npm test` — confirm tests **fail** (red).
4. Implement the function in `calculations.ts`.
5. Run `npm test` — confirm tests **pass** (green).
6. Refactor if needed, keeping tests green.

### Required test cases per function

| Function | Must cover |
|---|---|
| `calculateMetrics` | empty input; positive PnL; negative PnL; single-day; win rate; profit factor; zero-loss trades ✅ |
| `aggregateChartData` | daily (last 90 days), weekly, monthly; empty input; single entry; cumulative reflects full history ✅ |
| `resolveDateRange` | 1D, 1W, 1M, 1Y, manual ✅ |
| `filterByDateRange` | in-range, out-of-range, full coverage ✅ |
| `normalizeEquityCurve` | empty; first point = 0; final value reflects relative gain ✅ |
| `filterTradesAdvanced` | all filters; no-match combination; symbol substring ✅ |
| `summarizeFilteredTrades` | empty; sum PnL and fees; totalVolume = Σ qty×entryPrice ✅ |
| `buildMetricTimeSeries` | empty; monthly/weekly buckets; multiple accounts; dateRange respected; winRate bounds ✅ |
| `calculateFuturesMetrics` | empty; funding cost (futures only); avg leverage; L/S ratio; liq distance; overnight count ✅ |
| `buildOverlayData` | output keyed by subAccountId; numeric values; empty range returns []; carry-forward for gaps ✅ |
| `aggregateOverlayData` | weekly < daily row count; monthly ≤ weekly; all keys preserved; daily is passthrough ✅ |
| `buildPerAccountMetrics` | totalNotional is finite ≥ 0; present in both metrics and extras; consistent between fields ✅ |
| `mapCcxtTrade` (ccxt-utils) | PnL: all exchange field names; string→number; NaN-safe; tradeType from ':'; leverage string+fallback ✅ |
| Any new metric helper | happy path, zero denominator (no division by zero), all-loss / all-win edge cases |

### Regression test checklist (`lib/__tests__/regression.test.ts`)

| Area | Regression tests cover |
|---|---|
| `mapCcxtTrade` (ccxt-utils) | PnL string→number for Binance/Bybit/OKX; NaN fallback; tradeType from symbol; leverage guard |
| Supabase pagination | Accumulator loop fetches all rows beyond 1000 |
| Equity curve (buildOverlayData) | Numeric values; correct date range; carry-forward; multi-account keys |
| Equity curve (aggregateOverlayData) | Weekly/monthly produce fewer rows; keys preserved |
| normalizeEquityCurve | First point = 0 regardless of starting cumulativePnl |
| buildPerAccountMetrics | `totalNotional` in `metrics` and `extras`; finite; ≥ 0 |
| summarizeFilteredTrades | `totalVolume` uses entryPrice (not exitPrice) |
| formatPercent | No double `+` prefix; takes plain percent not ratio |
| formatMoney | Compact thresholds (K/M) and negative values |
| History date range | 180-day window covers the full scan period |
| Chunk size (A4) | Bybit chunk ≤ 7 days; 26 chunks × 7 days ≥ 180 |

### Pre-flight checklist before every PR / "done" claim

```
[ ] npx tsc --noEmit   → exit 0
[ ] npm test           → exit 0, no failures (2 pre-existing WS failures allowed: binance-connector WS URL)
[ ] New enum value? → DB migration written
[ ] New instrument? → grep "=== 'futures'" in sync routes and update
[ ] New supabaseAdmin query returning >1000 rows? → pagination loop added
[ ] New API route? → worst-case execution time < 5s on Vercel
[ ] New exchange field? → raw response inspected, Number() wrapper added
[ ] New exchange field used as logic signal? → live API call made and field
    confirmed present BEFORE writing the implementation (see A28)
[ ] Tests cover "field absent / undefined / null" case — not just happy-path
[ ] Promise.allSettled rejections are propagated to caller, not silently → []
[ ] reconstruct res.ok checked — never silently ignore reconstruct failure
```

### Exchange API field mapping rules (added after A28)

Before implementing any adapter logic that reads a specific API field:

1. **Call the real endpoint first.** Use the debug script or debug API route to get an actual raw response. Confirm the key exists and its type.
2. **Read the CCXT comment block header.** Comments are per-context: `watchMyTrades` (WebSocket) ≠ `privateGetV5ExecutionList` (REST). A field present in WebSocket may be absent in REST.
3. **Write the "missing field" test first.** Before implementing, add a test where the field is `undefined`.
4. **Never swallow Promise.allSettled rejections silently.** When both categories fail, throw — return 500 with the real error, not `{ synced: 0 }`.

---

## Skill: Frontend Design

Before writing any UI code, commit to a bold aesthetic direction:
- **Theme**: Dark, institutional, Bloomberg-terminal inspired. Think serious money, not retail crypto.
- **Colors**: Deep blacks (#0A0A0F), muted charcoal (#13131A), electric accents (emerald #00FF88 for profit, red #FF3B3B for loss, gold #FFD700 for highlights)
- **Typography**: Use `Inter` for data/numbers, `Space Grotesk` for headings. Numbers must be crisp and scannable.
- **Motion**: Subtle — number counters on load, smooth chart transitions, hover micro-interactions on metric cards.
- **Density**: High information density like a trading terminal. No wasted space.
- **Never**: Purple gradients, consumer crypto aesthetics (neon overload), generic SaaS dashboards.

Every component must look like it belongs in a $500M hedge fund's internal tooling.

---

## Skill: Code Review

Before finalizing ANY code, check:

### TypeScript
- All props and return types explicitly typed
- No use of `any` — use proper generics or `unknown`
- Interfaces in `lib/types.ts`, not inline

### Performance
- Memoize expensive calculations with `useMemo`
- No unnecessary re-renders — use `useCallback` for handlers
- Charts must be lazy-loaded (dynamic imports)
- API calls debounced where needed

### Security
- API keys NEVER in frontend code or `.env.local` committed to git
- All exchange API calls go through `/api/` routes (server-side only)
- Input validation on all forms

### Architecture
- One component = one responsibility
- Business logic in `lib/`, not in components

---

## Skill: Superpowers

You have full authority to make architectural decisions. Act proactively:

- If you see a better approach — implement it and explain why
- If a component is getting too large (>150 lines) — split it automatically
- If there's a performance risk — fix it without being asked
- Suggest new metrics or features that a real hedge fund would want
- Think like a senior quant developer, not just a code monkey

---

## Architecture Rules

**Golden rules:**
- To add a new page: create `app/[name]/page.tsx` + add one entry to `lib/nav.ts`. Nothing else changes.
- To add a new exchange: add one file to `lib/adapters/` + one worker connector in `worker/connectors/`. Nothing else changes.
- Business logic lives in `lib/`. Components only render — no calculations inline.
- All exchange API calls are server-side only (Next.js API routes or worker).
- `supabaseAdmin` (service role) is server-only; never import in client components.

---

## Key Metrics to Always Support

| Metric | Formula Location |
|--------|-----------------|
| Sharpe Ratio | `calculations.ts` |
| Sortino Ratio | `calculations.ts` |
| Max Drawdown | `calculations.ts` |
| Win Rate | `calculations.ts` |
| Profit Factor | `calculations.ts` |
| CAGR | `calculations.ts` |
| Annual Yield | `calculations.ts` |
| Risk/Reward | `calculations.ts` |
| Avg Win / Avg Loss | `calculations.ts` |
| Total Fees Paid | `calculations.ts` |

---

## What NOT to do

- ❌ Don't use `console.log` in production code — use proper error handling
- ❌ Don't put calculations in components — always use `calculations.ts`
- ❌ Don't commit `.env.local` or any API keys
- ❌ Don't make the UI look like a generic crypto retail app
- ❌ Don't silently swallow errors in sync routes — failed symbols must appear in `failed_items`, not disappear
- ❌ Don't call `Date.now()` inside chunk route handlers — use `reference_timestamp` from request body
- ❌ Don't upsert without deduplication when two rows can have the same conflict key
