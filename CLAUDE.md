# Crypto Hedge Fund Dashboard — Claude Instructions

---

## Project State
*Update this section after every major change.*

### Status: Sync system implemented — hourly cron + manual Sync Now button in header

### What has been built

**App name:** CICADA FOUNDATION — a professional crypto hedge fund PnL dashboard with Wintermute dark theme and Cicada light theme.

**Pages complete:**
- `/dashboard` — balance cards, 10 metric cards, equity-curve chart (Area + period Bars), PeriodSelector embedded in chart header; FilterBar removed; Fund value badge in header
- `/performance` — PeriodSelector + accounts checkbox dropdown (click-outside aware); **L1 tabs** SPOT/FUTURES (active = green filled pill); **L2 tabs** (active = green border-bottom): SPOT has Overview/Returns/Risk/Costs, FUTURES has Overview/Returns/Risk & Exposure/Cost/Execution; per-account metrics table with polarity-aware best (green) / worst (red) cell highlighting and Total/Avg footer row; `OverlayLineChart` equity curves with D/W/M switcher embedded in chart header, normalized to 0 at period start for all timeframes
- `/history` — sticky header strip (Export button) + TradeFilters bar (exchange/account/section/side dropdowns, symbol input, date range with Day/Week/Month/180D shortcuts); OrdersTable with Bybit-standard columns (Date/Time, Symbol, Order Type, Side, Filled Qty, Filled Value, Realized PnL, Fee, Exchange/Account); all CSS variables (full light/dark support)
- `/results` — Trading Results investor view: USDT balance line chart (`BalanceLineChart`) + PnL histogram (`PnlHistogramChart`, Day/Week/Month timeframe), balance table with 2 rows per account (USDT + token), checkbox column, Difference/Fees/Avg Price/PnL columns, totals row; pair filter dropdown; charts filter by checked accounts
- `/api-settings` — two-column layout: left (280px) Create Account form (Fund/Exchange/Account Name/Instrument/API Key/Secret/PassPhrase/AccountID Memo) with green CREATE ACCOUNT button; right column Accounts List table (Account Name/Fund/Exchange/Instrument/Status/Actions); **Test button calls real ping** (`POST /api/exchanges/[exchange]/ping`) — sets Connected/Error status; Edit/Remove per row; **fully connected to real API routes** — Create Account → `POST /api/accounts` (keys AES-256-GCM encrypted before DB write), list → `GET /api/accounts` (no encrypted fields returned), Remove → `DELETE /api/accounts/[id]`; loading skeleton, error panel with Retry, empty state; localStorage removed

**Infrastructure complete:**
- `app/api/exchanges/[exchange]/balance/route.ts` — POST fetches account, decrypts keys, calls `adapter.fetchBalance()`, returns `{ usdt, tokens, account_name, exchange }`; 500 if adapter throws
- `app/api/exchanges/[exchange]/trades/route.ts` — POST accepts `{ account_id, since?, limit? }`, calls `adapter.getTrades('all', dateRange, since, limit)`, returns `{ trades, account_name, exchange }`
- `lib/adapters/bybit.ts`, `binance.ts`, `okx.ts` — `getTrades()` implemented with `ccxt.fetchMyTrades(undefined, since, limit ?? 100)`, mapped to internal `Trade[]` via shared `ccxt-utils.ts`
- `lib/adapters/ccxt-utils.ts` — `mapCcxtTrade()` maps ccxt fill objects to internal `Trade` type; extracts PnL from `info.closedPnl`/`realised_pnl`/`pnl`; derives leverage and tradeType
- `lib/adapters/types.ts` — `getTrades` signature extended with `since?: number, limit?: number`
- `app/api/sync/route.ts` — POST + GET handlers; syncs all accounts (fetchBalance + getTrades) to Supabase `balances` and `trades` tables; skips failed accounts, returns `{ synced, errors, accounts }`
- `vercel.json` — Vercel Cron Job runs `GET /api/sync` every hour (`0 * * * *`), all API functions pinned to `fra1` region
- `components/layout/Header.tsx` — Sync Now button (left of user pill); spinner while syncing; "Synced X accounts" / "Sync failed" toast for 3s
- Tests: 231 passing
- `import 'server-only'` added to all CCXT adapter files (`bybit.ts`, `binance.ts`, `okx.ts`) and API routes (`ping`, `balance`, `trades`)
- `serverExternalPackages: ['ccxt']` in `next.config.ts` — prevents Turbopack from bundling ccxt for the client
- `__mocks__/server-only.ts` — no-op mock for Jest compatibility; `moduleNameMapper` in `jest.config.ts` routes `server-only` imports to this mock
- Tests: 223 passing (6 new balance route tests + 6 new trades route tests)
- `lib/adapters/bybit.ts`, `binance.ts`, `okx.ts` — real CCXT adapters implementing `ExchangeAdapter`; `testConnection` catches all errors → `false`; `fetchBalance` extracts USDT + non-zero token balances from `raw.total`; OKX uses `password` field for passphrase
- `lib/adapters/types.ts` — added `BalanceResult` interface and `fetchBalance(): Promise<BalanceResult>` to `ExchangeAdapter`
- `app/api/exchanges/[exchange]/ping/route.ts` — POST validates exchange, fetches account from Supabase, decrypts `api_key`/`api_secret`/`passphrase` server-side, calls adapter `testConnection()`, returns `{ connected, exchange, account_name }` — never exposes decrypted keys
- `app/api-settings/page.tsx` — Test button calls `POST /api/exchanges/${exchange}/ping`; updates status to `connected`/`error` from response; falls back to `error` on network failure
- `supabase/migrations/004_add_account_id_memo.sql` — adds nullable `account_id_memo` column to accounts table
- `app/api-settings/page.tsx` — `tradingPair` field removed (not needed at account level); `account_id_memo` wired form → POST payload → DB; restored on Edit; `AccountRow` type updated
- `app/api/accounts/route.ts` — POST destructures and inserts `account_id_memo` (optional); GET returns it (not sensitive); GET/POST fully wired to Supabase with all required fields
- Tests: 196 passing
- `app/api-settings/page.tsx` — fully connected to real API routes; Create Account → `POST /api/accounts`, list → `GET /api/accounts`, Remove → `DELETE /api/accounts/[id]`; loading, error, and empty states implemented; all localStorage references removed
- `app/api/accounts/[id]/route.ts` — DELETE account (404 if not found)
- All API routes use `supabaseAdmin` (server-only), never expose encrypted fields in any response
- `supabase/migrations/003_fix_column_names.sql` — renames `label→account_name`, `api_key_encrypted→api_key`, `api_secret_encrypted→api_secret`, `passphrase_encrypted→passphrase`; adds `fund` column
- `lib/crypto/encrypt.ts` — AES-256-GCM encryption with random IV per call
- `lib/crypto/decrypt.ts` — decryption with GCM auth tag tamper detection
- `ENCRYPTION_KEY` in `.env.local` (server-side only, 32 bytes hex)
- Tests: 174 passing (6 new crypto tests in `lib/__tests__/crypto.test.ts`)
- Supabase project connected (`lib/supabase/client.ts` browser client, `lib/supabase/server.ts` admin client)
- Database schema: `accounts`, `balances`, `trades` tables with RLS enabled (`supabase/migrations/001_initial_schema.sql`)
- Environment variables configured in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`)
- Tests: 167 passing (4 new Supabase client tests in `lib/__tests__/supabase.test.ts`)
- Renamed from Nexus Fund → Cicada Foundation across app/layout.tsx, LoginForm, Header
- `lib/mock-data.ts`: `INITIAL_USDT_BALANCE`, `INITIAL_TOKEN_BALANCE`, `ACCOUNT_PRIMARY_TOKEN`, `getAllTransactions()` (seeded 3–5 deposits/withdrawals per sub-account)
- `lib/calculations.ts`: `buildAccountSnapshots`, `buildUsdtBalanceTimeSeries`, `buildTokenBalanceTimeSeries`
- `components/charts/BalanceLineChart.tsx`, `PnlHistogramChart.tsx`
- Dark/light theme toggle (ThemeProvider, localStorage, anti-flash `<Script>` in layout)
- Logo-hover nav dropdown (NavDropdown, reads from `lib/nav.ts`)
- `PeriodSelector` shared component (1D / Week / Month / Year / Manual with date picker)
- `AuthGuard` component used in every page layout
- `lib/adapters/` — `ExchangeAdapter` interface + `MockAdapter` implementation
- Full Jest test suite covering all `calculations.ts` functions

**Credentials:** `admin` / `admin123`
**Dev server:** `npm run dev` → `http://localhost:3000`

---

### File Structure

```
crypto-dashboard/          ← project root (NOT src/)
├── app/
│   ├── globals.css        ← dark + light CSS variables, Tailwind v4 @theme block, theme transitions
│   ├── layout.tsx         ← root layout: loads Inter, Space Grotesk, Geist Mono; anti-flash script; wraps in <Providers>
│   ├── page.tsx           ← server redirect → /dashboard
│   ├── providers.tsx      ← 'use client'; wraps in <ThemeProvider><AuthProvider>
│   ├── login/
│   │   └── page.tsx       ← imports LoginForm
│   ├── dashboard/
│   │   ├── layout.tsx     ← wraps children in <AuthGuard>
│   │   └── page.tsx       ← filter state (FilterState + DateRange), renders BalanceCards, MetricsGrid, PnLChart, OrdersTable
│   ├── performance/
│   │   ├── layout.tsx     ← wraps children in <AuthGuard>
│   │   └── page.tsx       ← PeriodSelector + accounts checkbox dropdown; L1 SPOT/FUTURES tabs; L2 category tabs; per-account metrics table (buildPerAccountMetrics); OverlayLineChart equity curves
│   ├── results/
│   │   ├── layout.tsx     ← wraps children in <AuthGuard>
│   │   └── page.tsx       ← full Trading Results page; OverlayLineChart + ComparisonTable; period selector, pair filter, account toggles
│   ├── history/
│   │   ├── layout.tsx     ← wraps children in <AuthGuard>
│   │   └── page.tsx       ← full Trading History page; TradeFilters + OrdersTable(pageSize=50) + ExportButton + footer
│   └── api-settings/
│       ├── layout.tsx     ← wraps children in <AuthGuard>
│       └── page.tsx       ← full API Settings page; loads configs from localStorage on mount; 3-col grid of ExchangeCards; security warning banner
│
├── components/
│   ├── auth/
│   │   └── LoginForm.tsx      ← form, validation, show/hide password, demo-credential fill button
│   ├── layout/
│   │   ├── Header.tsx         ← sticky header: logo + nav trigger (hover), total PnL badge, user pill, theme toggle (Sun/Moon), logout
│   │   ├── NavDropdown.tsx    ← rendered inside Header on hover; reads NAV_ITEMS from lib/nav.ts; active item in gold
│   │   ├── FilterBar.tsx      ← exchange tab buttons + sub-account <select>; resets sub-account on exchange change; Clear button
│   │   └── AuthGuard.tsx      ← 'use client'; redirects to /login if not authenticated; shows spinner while loading
│   ├── ui/
│   │   └── PeriodSelector.tsx ← 1D / Week / Month / Year / Manual; Manual reveals start/end date inputs + Apply button
│   ├── metrics/
│   │   ├── MetricCard.tsx         ← single metric tile (label, value, optional subValue, trend color, icon, description)
│   │   ├── MetricsGrid.tsx        ← 5×2 CSS grid of MetricCards for dashboard
│   │   ├── BalanceCards.tsx       ← 4-column grid: one card per exchange + Portfolio total; shows balance, PnL, PnL%
│   │   ├── MetricSelector.tsx     ← 5×2 clickable tile grid for /performance; selected tile underlined in blue
│   │   └── FuturesMetricsTiles.tsx← 5-tile row: funding cost, avg leverage, L/S ratio, liq. distance, overnight exposure
│   ├── charts/
│   │   ├── PnLChart.tsx       ← recharts ComposedChart; Area (cumulative PnL, left Y) + colored Bars (period PnL, right Y); daily/weekly/monthly timeframe tabs
│   │   ├── MetricLineChart.tsx← recharts LineChart; one Line per active sub-account; custom tooltip shows all series sorted by value
│   │   └── OverlayLineChart.tsx← recharts LineChart; internal D/W/M timeframe state (default weekly); calls aggregateOverlayData then re-normalizes so first point is always 0; ReferenceLine y=0; +/- prefix in tooltip; D/W/M switcher in chart header
│   └── orders/
│       ├── TradeFilters.tsx   ← sticky filter bar for /history; exchange tabs, sub-account, symbol, trade type (spot/futures), side, Day/Week/Month/180D quick-select + manual date range (180-day cap); MOCK_TODAY = '2025-12-31'
│       ├── ExportButton.tsx   ← CSV (Blob + createObjectURL) + PDF (jspdf@4 + jspdf-autotable@5 standalone API) export; two independent loading states
│       ├── OrdersTable.tsx    ← sortable by symbol/pnl/fee/pnlPercent/closedAt; client-side search; configurable pageSize (default 15)
│       └── ComparisonTable.tsx← one row per account; 12 metric columns; Δ vs baseline with polarity-aware color; sticky Account column; baseline row gold border + badge
│
├── components/api/
│   ├── StatusBadge.tsx    ← Connected / Error / Not configured badge with colored dot
│   ├── ApiKeyInput.tsx    ← masked input (type=password/text toggle); Eye/EyeOff; no copy button (security)
│   └── ExchangeCard.tsx   ← full exchange config card; draft state; mock Test Connection (600ms); Save/Remove handlers; OKX passphrase field
│
├── hooks/
│   └── useAccountToggles.ts  ← toggleAccount, toggleExchange, selectAll, reset; enforces min 1 active; used by /performance and /results
│
├── lib/
│   ├── types.ts           ← ALL shared interfaces: ExchangeId, Trade, DailyPnLEntry, Metrics, FuturesMetrics,
│   │                         ExtendedMetrics (extends Metrics + recoveryFactor/avgFeePerTrade/feesAsPctOfPnl),
│   │                         AccountMetricsRow (per-account metrics + futuresMetrics + extras Record),
│   │                         AccountConfig (id, fund, exchangeId, accountName, instrument, apiKey, apiSecret, passphrase?, accountIdMemo?, status),
│   │                         FilterState, HistoryFilterState, MetricTimeSeries, AccountSummary, ApiKeyConfig,
│   │                         ChartDataPoint, DateRange, Period, Timeframe, SubAccount, ExchangeConfig, ConnectionStatus
│   │                         TradeType = 'spot' | 'futures' (options removed)
│   ├── utils.ts           ← formatMoney(), formatPercent(), formatRatio(), formatPrice(), formatDate(), cn()
│   ├── auth-context.tsx   ← 'use client' AuthProvider + useAuth(); credentials hardcoded (admin/admin123); localStorage
│   ├── theme-context.tsx  ← 'use client' ThemeProvider + useTheme(); toggles .light class on <html>; localStorage
│   ├── nav.ts             ← NAV_ITEMS array — the only file to edit when adding a page
│   ├── mock-data.ts       ← seeded mulberry32 RNG; EXCHANGES config; ACCOUNT_COLORS map; generates 365 days × 7 sub-accounts;
│   │                         filterDailyPnL(), filterTrades(), getAllDailyPnL(), getAllTrades()
│   ├── calculations.ts    ← calculateMetrics(), aggregateChartData(), resolveDateRange(), filterByDateRange(),
│   │                         normalizeEquityCurve(), filterTradesAdvanced(), summarizeFilteredTrades(),
│   │                         buildMetricTimeSeries(), calculateFuturesMetrics(),
│   │                         buildOverlayData(), buildComparisonRows(),
│   │                         calculateRecoveryFactor(), calculateAvgFeePerTrade(), calculateFeesAsPctOfPnl(),
│   │                         buildPerAccountMetrics(), aggregateOverlayData()
│   ├── api-key-store.ts   ← loadApiKey(), saveApiKey(), removeApiKey(), loadAllApiKeys(); plus loadAllAccountConfigs(), saveAccountConfig(), removeAccountConfig(); SSR-safe; AccountConfig stored at cicada:accounts
│   ├── adapters/
│   │   ├── types.ts       ← ExchangeAdapter interface: getDailyPnL(), getTrades(), testConnection()
│   │   └── mock.ts        ← MockAdapter implements ExchangeAdapter using mock-data.ts
│   └── __tests__/
│       └── calculations.test.ts  ← Jest tests for all calculations.ts functions (full coverage)
```

---

### Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Root layout | `app/` (not `src/`) | Default Next.js scaffold kept |
| App name | NEXUS FUND | Institutional branding established in LoginForm and Header |
| Auth | localStorage + React Context; AuthGuard component in each page layout | Simple for mock phase; swap for JWT/session when real APIs arrive |
| Auth guard | Separate `AuthGuard` component (not inline in layouts) | Reusable; used in all 5 page layouts |
| Mock data | Seeded deterministic RNG (mulberry32) | Same data every run; no committed fixtures |
| Data range | 2025-01-01 → 2025-12-31 | Full calendar year; "today" hardcoded to 2025-12-31 in page components |
| Filter state | Lives in each page component | Single source of truth per page; all children receive filtered props |
| Chart library | recharts `ComposedChart` (dashboard), recharts `LineChart` (performance) | Dual Y-axes for PnL chart; multi-series for metric chart |
| Styling | Tailwind v4 + CSS variables in globals.css | No `tailwind.config.js` needed |
| Color palette (dark) | bg-primary `#0A0A0F`, bg-secondary `#13131A`, bg-elevated `#1A1A24`, border-subtle `#1C1C28`, profit `#00FF88`, loss `#FF3B3B`, gold `#FFD700`, blue `#2D6FFF` | Defined as CSS variables in `:root` |
| Color palette (light) | bg-primary `#F0F2F8`, bg-secondary `#FFFFFF`, profit `#00A854`, loss `#D93030` | Defined as CSS variables in `.light` class |
| Exchange colors | Binance `#F0B90B`, Bybit `#FF6B2C`, OKX `#4F8EF7` | Matches official brand colors |
| Sub-account colors | Darker shades of exchange color per account (ACCOUNT_COLORS in mock-data.ts) | Visually groups accounts by exchange on multi-line charts |
| Theme switching | ThemeProvider toggles `.light` on `<html>`; anti-flash inline `<Script>` in layout | Prevents light-mode flash on page load |
| Fonts | Inter (body/data), Space Grotesk (`font-heading`), Geist Mono (`font-mono`) | Three variables: --font-inter, --font-space-grotesk, --font-geist-mono |
| Metrics source | Daily PnL → Sharpe/Sortino/MDD/CAGR; Trades → WinRate/PF/AvgWin/Fees | Correct financial separation |
| Initial capital | $6,800,000 split evenly across 7 sub-accounts | Used in ratio calculations and BalanceCards |
| Navigation | Logo hover → NavDropdown; reads NAV_ITEMS from lib/nav.ts | Adding a page requires only one entry in nav.ts |
| TDD | All calculations.ts functions have tests in lib/__tests__/calculations.test.ts | Tests written before implementation |

### Mock Data Profile

| Sub-account ID | Name | Exchange | Archetype |
|---|---|---|---|
| `binance-alpha` | Alpha Fund | Binance | Aggressive momentum |
| `binance-beta` | Beta Fund | Binance | Alt-coin mid-vol |
| `binance-gamma` | Gamma Stable | Binance | Conservative yield |
| `bybit-delta` | Delta Perps | Bybit | High-vol perpetuals |
| `bybit-epsilon` | Epsilon MM | Bybit | Market making |
| `okx-zeta` | Zeta Options | OKX | Options strategies |
| `okx-eta` | Eta Arb | OKX | Statistical arbitrage |

### Next Steps (not yet built)

- **Page 3 — `/results`**: `OverlayLineChart` (normalized equity curves) + `ComparisonTable` (per-account metrics with Δ delta column). `normalizeEquityCurve()` already exists in calculations.ts.
- **Page 4 — `/history`**: `TradeFilters` sticky bar + paginated 25-row table + `ExportButton` (CSV via Blob; PDF via jsPDF). `filterTradesAdvanced()` and `summarizeFilteredTrades()` already exist.
- **Page 5 — `/api-settings`**: `ExchangeCard`, `ApiKeyInput` (masked, no clipboard), `StatusBadge`.
- `lib/adapters/` — real exchange API adapters (Binance, Bybit, OKX)
- `/api/` routes — server-side proxy for API keys
- Proper session auth (NextAuth or JWT cookies) to replace localStorage

---

## Site Structure

Five pages. All share: the same nav shell, the same period selector (1D / Week / Month / Year / Manual range picker), and the same exchange/sub-account filter state. Architecture must make adding a sixth page trivial — one new route + one new entry in the nav config.

**Navigation:** hovering the logo opens a dropdown menu listing all five sections. No sidebar. Header stays sticky.

**Responsiveness:** every page must work on mobile (stacked layout) and desktop (side-by-side panels). Use CSS Grid with responsive breakpoints — no layout-specific components.

---

### 1. Dashboard `/dashboard`

**Purpose:** high-level portfolio health at a glance.

**Layout:**
- Top row: balance cards for each connected account (exchange + sub-account), total portfolio value
- Middle row: 10 key metric cards (Sharpe, Sortino, Max Drawdown, Win Rate, Profit Factor, CAGR, Annual Yield, Risk/Reward, Avg Win/Loss, Total Fees)
- Bottom: cumulative PnL equity curve chart (Area + period Bars), period selector

**Filter:** exchange tabs + sub-account dropdown (already built). Selecting "All" aggregates across everything.

**Data sources:** `calculateMetrics()`, `aggregateChartData()` from `lib/calculations.ts`.

---

### 2. Performance Indicators `/performance` ✅ COMPLETE

**Purpose:** deep-dive into individual metrics over time; multi-account comparison.

**Layout:**
- Controls bar: PeriodSelector + weekly/monthly timeframe toggle + per-account/exchange toggle buttons (All / Reset)
- Metric selector grid (`MetricSelector`) — 10 spot metrics as clickable tiles; selected tile underlined in blue
- Futures metrics tiles (`FuturesMetricsTiles`) — 5 read-only tiles: funding cost, avg leverage, L/S ratio, liq. distance, overnight exposure
- Multi-line chart (`MetricLineChart`) — one line per active sub-account for the selected metric over time

**Multi-select:** exchange-level group toggle + individual sub-account toggles. At least one account always remains active.

**Period selector:** controls both the metric tiles (period snapshot) and the chart time range.

**Components built:**
- `components/charts/MetricLineChart.tsx` — multi-line recharts LineChart, inline legend, custom tooltip sorted by value
- `components/metrics/MetricSelector.tsx` — 5×2 clickable tile grid
- `components/metrics/FuturesMetricsTiles.tsx` — 5-tile read-only row

**Data:** `buildMetricTimeSeries()` in calculations.ts — computes metric snapshot per bucket per sub-account.

---

### 3. Trading Results `/results`

**Purpose:** compare trading performance across accounts/exchanges visually and numerically.

**Layout:**
- Top (60%): overlay line chart — multiple equity curves on one canvas, one line per selected account. Each line starts at 0 so relative performance is comparable regardless of account size.
- Bottom (40%): comparison table — one row per account, columns for each metric, plus a Δ (delta) column showing difference vs. the baseline account (first selected or best performer)

**Filter:** token/pair search — narrows both the chart and the table to trades involving that pair (e.g., "BTC/USDT only").

**Period selector:** controls the date range for both chart and table.

**New components needed:**
- `components/charts/OverlayLineChart.tsx` — normalized multi-series recharts LineChart (index all series to 0 at period start)
- `components/orders/ComparisonTable.tsx` — responsive table with delta column, color-coded positive/negative delta

**Key rule:** the overlay chart must normalize all series to index 100 at period start so accounts of different sizes are visually comparable.

---

### 4. Trading History `/history`

**Purpose:** full trade log with deep filtering and export.

**Layout:**
- Filter bar (sticky below header): exchange, sub-account, token/pair, trade type (spot / futures / options), side (long / short / both), date range (up to 180 days)
- Trade table: all columns (symbol, side, entry, exit, PnL, PnL%, fee, duration, opened, closed, exchange, account)
- Footer: row count, total PnL of filtered set, total fees of filtered set
- Export buttons: **CSV** and **PDF** — export the currently filtered set

**Pagination:** 25 rows per page (more than dashboard's 15 because this is a dedicated history view).

**Date limit:** hard cap at 180 days lookback, enforced in the date range picker.

**New components needed:**
- `components/orders/TradeFilters.tsx` — filter bar (replaces/extends current `FilterBar.tsx`)
- `components/orders/ExportButton.tsx` — triggers CSV via `Blob` + `URL.createObjectURL`; PDF via `jsPDF` or `@react-pdf/renderer`

**CSV export format:** header row + one row per trade, ISO dates, all numeric columns unformatted (raw numbers, not `$1.2K`).

**PDF export format:** title + filter summary + table. One page per 40 rows. Exchange logo in header.

---

### 5. API Management `/api-settings`

**Purpose:** connect exchanges, manage API keys, monitor connection health.

**Layout:**
- Three exchange cards (Binance, Bybit, OKX) — each shows:
  - Connection status badge: `Connected` (green) / `Error` (red) / `Not configured` (muted)
  - API Key field (masked, show/hide toggle)
  - API Secret field (masked, show/hide toggle)
  - Optional: passphrase field (OKX only)
  - Sub-accounts list: auto-fetched after successful connection; user can enable/disable each
  - "Test connection" button — fires a lightweight ping to the exchange (e.g., account balance endpoint)
  - "Save" and "Remove" buttons
- Global warning banner: "API keys are stored locally in your browser. Never use keys with withdrawal permissions."

**Security rules (non-negotiable):**
- API keys stored in `localStorage` (mock phase) — prefixed with exchange ID, AES-encrypted with a session-derived key
- In production: keys go to `/api/keys` route (server-side), stored encrypted in DB, never returned to client after save
- The client only ever sends keys *to* the server; the server never sends them *back*
- "Test connection" goes through `/api/exchanges/[exchange]/ping` — never directly from browser to exchange

**New components needed:**
- `components/api/ExchangeCard.tsx` — single exchange connection card
- `components/api/ApiKeyInput.tsx` — masked input with show/hide, copy-to-clipboard forbidden (security)
- `components/api/StatusBadge.tsx` — Connected / Error / Not configured

**Route:** named `/api-settings` (not `/api`) to avoid collision with Next.js `/app/api/` server routes.

---

### Global Rules (apply to all pages)

| Rule | Detail |
|---|---|
| Period selector | Shared component `components/ui/PeriodSelector.tsx` — renders `1D / Week / Month / Year / Manual`. Manual opens a date range picker. State lives in the page, not the component. |
| Navigation | `components/layout/NavDropdown.tsx` — renders on logo hover. Items: Dashboard, Performance, Results, History, API. Active item highlighted in `#FFD700`. |
| Responsive | All pages use CSS Grid. Mobile: single column, charts min-height 200px. Desktop: multi-column. No layout-specific component variants. |
| Loading states | Every data-fetching section shows a skeleton loader (pulsing gray bars), never a spinner blocking the full page. |
| Empty states | When a filter returns no data, show an inline message in the affected panel — never a full-page empty state. |
| Adding a new page | 1. Add route to `app/[page-name]/page.tsx`. 2. Add entry to nav config in `lib/nav.ts`. Done. No other files change. |

---

## Project Overview
This is a professional crypto hedge fund PnL dashboard built with Next.js, TypeScript, and Tailwind CSS.
It tracks trading performance across Binance, Bybit, and OKX exchanges with sub-account support.

---

## Skill: TDD

All functions in `lib/calculations.ts` must be developed test-first using Jest.

### Rules

- **Write tests before implementation.** Never add a new calculation function without a failing test first.
- **Test file location:** `lib/__tests__/calculations.test.ts` — no exceptions.
- **Run tests before committing:** `npm test` must pass with zero failures.

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
| `summarizeFilteredTrades` | empty; sum PnL and fees ✅ |
| `buildMetricTimeSeries` | empty; monthly/weekly buckets; multiple accounts; dateRange respected; winRate bounds ✅ |
| `calculateFuturesMetrics` | empty; funding cost (futures only); avg leverage; L/S ratio; liq distance; overnight count ✅ |
| Any new metric helper | happy path, zero denominator (no division by zero), all-loss / all-win edge cases |

### Jest setup

```bash
npm install --save-dev jest @types/jest ts-jest
```

`jest.config.ts`:
```ts
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
}
```

`package.json` scripts:
```json
"test": "jest",
"test:watch": "jest --watch"
```

### Example test structure

```ts
// lib/__tests__/calculations.test.ts
import { calculateMetrics, aggregateChartData } from '../calculations'

describe('calculateMetrics', () => {
  it('returns zero metrics for empty input', () => {
    const result = calculateMetrics([], [])
    expect(result.sharpeRatio).toBe(0)
    expect(result.totalPnl).toBe(0)
    expect(result.totalTrades).toBe(0)
  })

  it('calculates positive sharpe for consistently profitable days', () => {
    // build deterministic daily data, assert sharpeRatio > 0
  })
})
```

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
- Mock data and real API adapters share the same interface (`ExchangeAdapter`)

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

```
app/                               # Next.js App Router (no src/ wrapper)
├── page.tsx                       # Redirect → /dashboard
├── layout.tsx                     # Root layout: fonts, <Providers>
├── providers.tsx                  # ThemeProvider + AuthProvider (client)
├── login/page.tsx
├── dashboard/page.tsx             # Page 1: Dashboard
├── performance/page.tsx           # Page 2: Performance Indicators
├── results/page.tsx               # Page 3: Trading Results
├── history/page.tsx               # Page 4: Trading History
├── api-settings/page.tsx          # Page 5: API Management
└── api/                           # Server-side API routes
    └── exchanges/[exchange]/ping/ # Connection health check

components/
├── auth/              # LoginForm
├── ui/                # PeriodSelector ✅ | (Skeleton — not yet built)
├── layout/            # Header ✅, NavDropdown ✅, FilterBar ✅, AuthGuard ✅
├── charts/            # PnLChart ✅, MetricLineChart ✅ | (OverlayLineChart — not yet built)
├── metrics/           # MetricCard ✅, MetricsGrid ✅, BalanceCards ✅, MetricSelector ✅, FuturesMetricsTiles ✅
├── orders/            # OrdersTable ✅, TradeFilters ✅, ExportButton ✅ | (ComparisonTable — not yet built)
└── api/               # (ExchangeCard, ApiKeyInput, StatusBadge — not yet built)

lib/
├── types.ts           # ALL TypeScript interfaces
├── utils.ts           # formatMoney, formatPercent, cn, …
├── calculations.ts    # All metric formulas (TDD — tests first)
├── mock-data.ts       # Seeded RNG mock data
├── auth-context.tsx   # AuthProvider + useAuth
├── nav.ts             # Navigation config — ONLY file to edit when adding a page
└── adapters/          # Exchange API adapters
    ├── types.ts        # ExchangeAdapter interface
    └── mock.ts         # Mock implementation

hooks/                 # Custom React hooks (usePeriod, useExchangeFilter, …)

lib/__tests__/
└── calculations.test.ts  # Jest tests — written BEFORE implementation
```

**Golden rules:**
- To add a new page: create `app/[name]/page.tsx` + add one entry to `lib/nav.ts`. Nothing else changes.
- To add a new exchange: add one file to `lib/adapters/`. Nothing else changes.
- Business logic lives in `lib/`. Components only render — no calculations inline.

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

## Exchange API Notes (for when we connect real APIs)

- **Binance**: Use `/api/v3/myTrades` — requires `HMAC SHA256` signature
- **Bybit**: Use `/v5/execution/list` — requires `API Key + timestamp + signature`  
- **OKX**: Use `/api/v5/trade/fills` — requires `OK-ACCESS-SIGN` header
- All keys stored in `.env.local`, accessed only via `app/api/` routes
- Never expose `apiSecret` to the client

---

## What NOT to do

- ❌ Don't use `console.log` in production code — use proper error handling
- ❌ Don't hardcode exchange names as strings — use the `Exchange` enum from `types.ts`
- ❌ Don't put calculations in components — always use `calculations.ts`
- ❌ Don't commit `.env.local` or any API keys
- ❌ Don't make the UI look like a generic crypto retail app
