# Engineering Case Study — Cicada Foundation Dashboard

This document catalogs every mistake made during the initial build of this project, grouped by root cause, with actionable prevention rules and references to the regression tests that now guard against each class of error. Use this file as a pre-flight checklist before starting any new crypto-data project.

---

## Category A — Incomplete Exchange API Knowledge

These mistakes share one root cause: writing integration code before reading the actual API documentation or inspecting a real raw response.

### A1 · Binance fetchBalance queried only spot wallet

**What happened.** `BinanceAdapter.fetchBalance()` was created without `defaultType: 'future'`. Binance stores futures balances in a separate wallet; CCXT's default is spot. Futures accounts showed `$0` balance.

**Root cause.** Assumed CCXT unifies wallet types automatically. It does not — you must explicitly specify the wallet per request.

**Fix.** Iterate all wallet types (`spot`, `future`, `delivery`) with `Promise.allSettled` and sum the results.

**Prevention rule.** Any new exchange adapter must log the raw balance response for each wallet type in dev and verify totals match what the exchange UI shows before shipping.

---

### A2 · PnL was 0 for all trades — wrong field name and type

**What happened.** `ccxt-utils.ts` looked for `info['closedPnl']` (Bybit) and `info['realised_pnl']` (OKX) but missed Binance's `info['realizedPnl']` (camelCase, capital P). All three exchanges also return PnL as a **string** (`"1.5000"`), not a number — the old code used a `typeof === 'number'` guard that always failed.

**Root cause.** Wrote the field mapping from memory, not from an actual API response. Did not handle the string-vs-number ambiguity.

**Fix.** Always call `Number(rawPnl)` on the extracted value regardless of type. Cover all known PnL field names in a priority chain.

**Prevention rule.** Before writing any ccxt-utils mapping, capture a real `t.info` object from the exchange (or a fixture) and write a test that asserts `pnl !== 0` for a known trade. See regression test `mapCcxtTrade — PnL`.

---

### A3 · Futures trades never fetched (spot CCXT instance used)

**What happened.** `BinanceAdapter` was created without a `type` parameter. Every `fetchMyTrades` call went to the spot exchange. Futures trades were silently missing.

**Root cause.** Did not think through the CCXT architecture — a single `ccxt.binance` instance is either spot or futures, not both. The adapter needed an explicit `type: 'spot' | 'future'` parameter.

**Fix.** Adapter constructor accepts `type` and passes it to `options.defaultType`. The full-history route infers type from symbol format (`:` in symbol → futures).

**Prevention rule.** Every exchange adapter must declare which market it targets. Never instantiate a CCXT exchange without `defaultType` when futures are involved.

---

### A4 · Bybit chunks used 30-day windows — API hard limit is 7 days

**What happened.** The Bybit time-based chunked sync used 30-day windows. Bybit's `/v5/execution/list` silently stops pagination after 7 days and returns no error. ~76% of history per chunk was silently missing.

**Root cause.** Did not read Bybit API rate-limit and window-limit documentation before designing the chunk strategy.

**Fix.** Changed chunk size to 7 days (26 chunks × 7 days = 182-day full history).

**Prevention rule.** Before designing any chunk strategy: look up the exchange's maximum time window per request and write a test that asserts `totalChunks === ceil(180 / MAX_WINDOW_DAYS)`.

---

### A24 · Leverage always 1.0x — CCXT does not populate `p.leverage` for Binance positions

**What happened.** `fetchPositions()` read `p.leverage` from CCXT's unified position object. Binance USDT-M does not return this field at position level — CCXT leaves it `null`, defaulting to `1`.

**Root cause.** Assumed CCXT unifies leverage across exchanges. It does not for Binance.

**Fix.** Compute effective leverage as `notional / initialMargin` when `initialMargin > 0`. Fall back to `p.leverage ?? 1` only if margin data is absent.

**Prevention rule.** For any new position field: log `p.info` from a real response and verify the field exists. See regression test `effective leverage from notional/margin`.

---

## Category B — Architectural Oversights

These mistakes share one root cause: not thinking through the operational constraints (timeouts, rate limits, service limits) before designing a flow.

### B5 · Sync Now incompatible with Vercel 10-second timeout

**What happened.** The hourly cron sync iterated all accounts and fetched paginated trade history with no time budget. For accounts with thousands of trades this could take minutes — Vercel kills functions after 10 seconds.

**Root cause.** Designed the sync route without considering the serverless execution model.

**Fix.** Quick sync uses `since = now - 48h` to fetch only recent trades.

**Prevention rule.** Any new API route that calls an external service must declare its worst-case execution time. If > 5 seconds, redesign for incremental/chunked execution.

---

### B7 · `loadMarkets()` called on every chunk request (14–28 times per scan)

**What happened.** The Full History route called `loadSortedUsdtSymbols()` — which does a full `loadMarkets()` API call — inside every chunk POST. With 14–28 chunks per scan, this caused rate-limit errors that silently dropped chunks.

**Root cause.** Heavy initialization code was placed inside the request handler loop instead of being computed once and passed as data.

**Fix.** Markets route pre-computes the full symbol list once and returns it to the frontend. Chunks receive symbol slices in the POST body; the route never calls `loadMarkets()`.

**Prevention rule.** Any operation that is O(1) per scan must not be placed inside a per-chunk loop. Identify which work is "setup" (done once) vs "chunk work" (done per iteration) before writing a loop.

---

### B8 · Supabase 1000-row cap not handled on any API route

**What happened.** Supabase PostgREST silently caps responses at 1000 rows regardless of `.limit()` calls. Dashboard showed Win Rate for exactly 1000 trades; History showed exactly 1000 rows. The cap was not mentioned anywhere in the initial implementation.

**Root cause.** Did not read Supabase PostgREST documentation on default row limits.

**Fix.** All routes that fetch trades use a `while (true)` pagination loop with `.range(from, from + PAGE - 1)` and break when fewer than `PAGE` rows are returned.

**Prevention rule.** Every `supabaseAdmin.from(...).select()` that could return > 1000 rows must use a pagination loop. This is now a mandatory code-review checklist item. See regression test `supabase pagination accumulator`.

---

### B17 · Equity curve normalization was broken — baseline subtraction and off-by-one

**What happened.** `buildOverlayData` subtracted a baseline from cumulative PnL, causing the chart to show "change since first ever trade" rather than "cumulative PnL for the selected period." The first point of the chart was not at 0 as expected.

**Root cause.** Normalization logic was tested in isolation but not end-to-end with real multi-account, multi-timeframe data.

**Fix.** `aggregateOverlayData` uses "first value in bucket" semantics so each series starts at its period-start cumulative PnL, then `OverlayLineChart` subtracts that baseline per account.

**Prevention rule.** Equity curve tests must assert: first point === 0 for all timeframes (D/W/M) and all account counts (1 account, N accounts). See regression tests `buildOverlayData` and `aggregateOverlayData`.

---

## Category C — Data Source Inconsistency

### C10 · Performance chart and metrics table used different data sources

**What happened.** The equity curve chart in Performance used ALL trades to build daily PnL entries, while the metrics table filtered by `tradeType` (SPOT or FUTURES tab). Chart showed -$40, table showed +$2.

**Root cause.** No single "filter trades once, use everywhere" principle. Each section applied its own filter independently.

**Fix.** Pass the L1 tab filter (`tradeType`) to `buildDailyPnlEntries` so chart and table use identical input.

**Prevention rule.** On any page with a chart + table, there must be a single derived dataset (`const filteredTrades = useMemo(...)`) that both components consume. Neither component filters independently.

---

### C12 · D/W/M switcher changed state but had no visual effect

**What happened.** Dashboard API returned pre-aggregated daily data. The timeframe switcher changed React state but `aggregateChartData` was never called client-side, so the chart never changed.

**Root cause.** Mixed server-side aggregation (from API) with client-side state (timeframe) without wiring them together.

**Fix.** Dashboard API returns raw daily PnL rows. `aggregateChartData` is called client-side inside a `useMemo` that depends on `timeframe`.

**Prevention rule.** Timeframe aggregation must be entirely client-side or entirely server-side. Never split.

---

### C18 · Futures metrics (duration, leverage, isOvernight) hardcoded to 0

**What happened.** The performance API route mapped trade rows with `durationMin: 0`, `isOvernight: false`, `leverage: 1` — fields that could be computed from `opened_at`, `closed_at`, and the `direction` column.

**Root cause.** No mapping checklist — each field was not explicitly decided as "computed", "from DB", or "genuinely unavailable".

**Fix.** `durationMin` computed from `(closed_at - opened_at) / 60000`. `isOvernight` computed from whether the trade spans UTC midnight.

**Prevention rule.** Every field in a DB→API mapper must have one of three labels: `computed | db_column | unavailable(reason)`. "Unavailable" must be documented with the reason.

---

## Category D — Incomplete Coverage When Adding a New Type

These mistakes all follow the same pattern: a new enum value or feature was added but not propagated to every place that checks for it.

### D6 · Failed symbol count not persisted to DB

**What happened.** When Full History completed, failed symbols were only in React state. After page reload, the count was lost — appearing to succeed silently.

**Root cause.** Thought only about the happy path, not about what state needs to survive a page reload.

**Fix.** PATCH route writes `full_sync_failed_count` and `last_full_sync_at` to the `accounts` table.

**Prevention rule.** For any new async operation: ask "what information must survive a page reload?" before writing the happy path.

---

### D9 · Korean Binance: spot-only scan returned 0 trades with no error

**What happened.** Full History loaded spot markets for a futures-only account. 0 trades were found, `full_sync_failed_count = 0` — the system silently succeeded while fetching nothing relevant.

**Root cause.** The scan did not check the account's `instrument` type to decide which markets to sweep.

**Fix.** Markets route reads `instrument` from DB. `portfolio_margin` and `futures` accounts sweep futures symbols only; `spot` sweeps spot only; `unified` sweeps both.

**Prevention rule.** Any scan/sync route must read `instrument` from DB and assert the correct market type is being targeted before starting.

---

### D22 · `portfolio_margin` added to code — DB constraint not updated

**What happened.** `portfolio_margin` was added to the frontend dropdown, `VALID_INSTRUMENTS` array, and TypeScript types. The Supabase `accounts_instrument_check` CHECK constraint was not updated. Every account creation attempt failed with a 500.

**Root cause.** No checklist for "add a new enum value."

**Fix.** Migration 010 drops and re-creates the constraint with the new value.

**Prevention rule.** Checklist for adding any new enum value to `instrument` (or any DB-constrained enum):
1. Frontend dropdown option
2. TypeScript union type
3. API validation array (`VALID_INSTRUMENTS`)
4. **DB migration** — always last, always required
5. Sync route: grep for `=== 'old_value'` and update every branch

---

### D23 · PM accounts excluded from Full History logic

**What happened.** When `portfolio_margin` was added, the markets route and full route were not updated to handle the new type. PM accounts showed "0 / 660" and never produced trades.

**Root cause.** Did not grep for all places where `instrument` is checked before shipping.

**Fix.** Markets route: `isPortfolioMargin || isFuturesOnly` → futures-only sweep. Full route: passes `portfolioMargin: true` to BinanceAdapter.

**Prevention rule.** After adding any new instrument value: `grep -r "instrument" app/api/sync` and verify every branch handles the new value.

---

### D25 · `unified` instrument → wrong market sweep for Korean Binance

**What happened.** `unified` accounts ran the spot+futures sweep. Korean Binance was configured as `unified` but only had futures activity. The spot sweep returned 0 trades; no error was raised.

**Root cause.** `unified` was not defined precisely — "both markets" is the wrong assumption for an account that only trades futures.

**Fix.** Changed account to `portfolio_margin` (futures-only PM) and updated sweep logic accordingly.

**Prevention rule.** Every instrument value must have a documented definition: which CCXT `defaultType` it uses and which symbol sets it sweeps.

---

## Category E — UI & Formatting Bugs

### E11 · Fund PnL % showed `++0.00%`

**What happened.** Two bugs combined: (1) JSX prepended `{isPositive ? '+' : ''}` before `formatPercent()`, which already adds `+`. (2) The value was divided by 100 again inside the JSX call, making `5.23%` → `0.0523%`.

**Root cause.** `formatPercent` contract was not documented — callers didn't know what type of value it expected.

**Fix.** Remove the manual prefix. Pass raw percent value (e.g., `5.23` not `0.0523`) to `formatPercent`.

**Prevention rule.** Every formatting utility must be documented with input contract in its definition: `// expects plain percent (e.g. 5.23), not a ratio (0.0523)`. See regression test `formatPercent`.

---

### E13 · Hardcoded dates `2025-12-31` and `2025-01-01` remained in production code

**What happened.** `PeriodSelector.tsx` initialized with `useState('2025-12-31')`. Multiple page components passed `'2025-12-31'` as the "today" argument to `resolveDateRange`. This was left over from mock-data development.

**Root cause.** No "remove mock artifacts" step in the migration-to-real-data workflow.

**Fix.** All instances replaced with `new Date().toISOString().slice(0, 10)`.

**Prevention rule.** Before any PR that connects real data: `grep -r "2025-12-31\|2025-01-01\|MOCK_TODAY"` and resolve every hit.

---

### E14 · Wrong CSS variable `--gold` instead of `--accent-gold`

**What happened.** Portfolio Total row used `var(--gold)` which doesn't exist. The border was invisible.

**Root cause.** CSS variables are untyped — typos fail silently.

**Prevention rule.** All valid CSS variables are defined in `globals.css`. Never use a CSS variable from memory — always copy from the source file.

---

### E15 · History account filter permanently disabled

**What happened.** Account dropdown had `disabled={filter.exchangeId === 'all'}` — requiring exchange selection first. This made individual-account filtering impossible without a workaround.

**Root cause.** Added a dependency that had no UX justification.

**Prevention rule.** Never restrict a filter's availability unless there is an explicit UX requirement for it. Filters should be independently operable by default.

---

### E16 · History default date range was 30 days (Full History covers 180)

**What happened.** History page opened with 30-day range. Most Full History trades (up to 180 days) were invisible on first load.

**Root cause.** Default range was not aligned with the actual data coverage.

**Prevention rule.** History page default range must match the Full History scan window (currently 180 days). If the scan window changes, the default range must change with it.

---

## Category F — Process Violations

### F20 · Open Positions described as "not yet built" — it already existed

**What happened.** A plan document listed Open Positions as a future feature. The section was already fully implemented.

**Root cause.** Plan was written from memory, not from reading the current code.

**Prevention rule.** Before writing any plan: read the current code. Plans must be based on observed state, not recalled state.

---

### F21 · `ExitPlanMode` called without prior text explanation (×2)

**What happened.** In plan mode, `ExitPlanMode` was called as the first action — without presenting the proposed fixes in plain text. User had to reject both attempts.

**User rule (permanent).** In plan mode: always write a full plain-text explanation of all proposed changes before calling `ExitPlanMode`. This is not negotiable.

---

### F · TypeScript errors not caught before claiming "done"

**What happened.** Multiple times: a type was updated but an object literal that constructed that type was not updated, causing a compile error discovered only later.

**Fix.** `npx tsc --noEmit && npm test` must pass before any "done" claim.

**Prevention rule.** Never claim a task is complete without running: `npx tsc --noEmit && npm test`. Both must exit 0.

---

## Master Prevention Checklist

Use this before every PR or "done" declaration:

### Exchange Integration
- [ ] Raw API response logged and inspected for every new field (PnL, leverage, balance)
- [ ] PnL extracted with `Number()` regardless of string/number input
- [ ] CCXT instance has explicit `defaultType` set
- [ ] Exchange API time-window limit identified and chunk size set accordingly
- [ ] All wallet types (`spot`, `future`, `delivery`) covered for balance

### New Instrument / Enum Value
- [ ] Frontend dropdown updated
- [ ] TypeScript union updated
- [ ] API validation array updated
- [ ] **DB migration written and run**
- [ ] All sync routes grep-checked for the old enum pattern

### API Routes
- [ ] Worst-case execution time estimated — must be < 5s on Vercel
- [ ] Supabase queries that could return > 1000 rows use pagination loop
- [ ] Heavy initialization (loadMarkets, etc.) called once, not inside loops
- [ ] All fields in DB→API mapping labeled: `computed | db_column | unavailable(reason)`

### UI / Data
- [ ] Single filtered dataset derived once per page — no component filters independently
- [ ] Timeframe aggregation is entirely client-side OR entirely server-side
- [ ] `grep -r "2025-12-31\|MOCK_TODAY"` returns no hits
- [ ] `formatPercent` called with plain percent value, not ratio
- [ ] CSS variables copied from `globals.css`, not typed from memory

### Before Claiming Done
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm test` exits 0 with no failures
- [ ] Full plain-text explanation written before `ExitPlanMode`
