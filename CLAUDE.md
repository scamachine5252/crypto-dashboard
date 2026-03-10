# Crypto Hedge Fund Dashboard — Claude Instructions

---

## Project State
*Update this section after every major change.*

### Status: Phase 1 complete — full mock dashboard running

### What has been built

A full-stack dark-themed crypto hedge fund PnL dashboard. Authentication, filters, 10 financial metrics, an equity-curve chart, and a paginated orders table are all functional with deterministic mock data. No real exchange APIs are connected yet.

**Credentials:** `admin` / `admin123`
**Dev server:** `npm run dev` → `http://localhost:3000`

---

### File Structure

```
crypto-dashboard/          ← project root (NOT src/)
├── app/
│   ├── globals.css        ← dark theme, custom scrollbar, Tailwind v4 @theme block
│   ├── layout.tsx         ← root layout: loads Geist fonts, wraps in <Providers>
│   ├── page.tsx           ← server redirect → /dashboard
│   ├── providers.tsx      ← 'use client' wrapper; mounts AuthProvider
│   ├── login/
│   │   └── page.tsx       ← imports LoginForm (thin server shell)
│   └── dashboard/
│       ├── layout.tsx     ← 'use client' auth guard; redirects → /login if not authed
│       └── page.tsx       ← main dashboard; owns all filter state (useState/useMemo)
│
├── components/
│   ├── auth/
│   │   └── LoginForm.tsx  ← form, validation, show/hide password, demo-credential hint
│   └── dashboard/
│       ├── Header.tsx     ← sticky header: logo, total PnL badge, user pill, logout
│       ├── FilterBar.tsx  ← exchange tab buttons + sub-account <select>; resets sub-account on exchange change
│       ├── MetricCard.tsx ← single metric tile (label, value, trend color, icon, description)
│       ├── MetricsGrid.tsx← 5×2 grid of MetricCards; maps Metrics → display config
│       ├── PnLChart.tsx   ← recharts ComposedChart (Area cumulative + Bar period PnL, dual Y-axes)
│       └── OrdersTable.tsx← sortable columns, client search, 15-row pagination
│
└── lib/
    ├── types.ts           ← ALL shared interfaces: ExchangeId, Trade, DailyPnLEntry, Metrics, FilterState…
    ├── utils.ts           ← formatMoney(), formatPercent(), formatPrice(), formatDate(), cn()
    ├── auth-context.tsx   ← 'use client' AuthProvider + useAuth(); stores session in localStorage
    ├── mock-data.ts       ← seeded mulberry32 RNG; generates 365 days × 7 sub-accounts + ~1,400 trades
    └── calculations.ts    ← calculateMetrics() (Sharpe, Sortino, MDD, CAGR…), aggregateChartData()
```

---

### Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Root layout | `app/` (not `src/`) | Default Next.js scaffold kept |
| Auth | localStorage + React Context | Simple for mock phase; swap for JWT/session when real APIs arrive |
| Mock data | Seeded deterministic RNG (mulberry32) | Same data every run; no committed fixtures |
| Data range | 2025-01-01 → 2025-12-31 | Full calendar year gives meaningful weekly/monthly aggregation |
| Filter state | Lives in `dashboard/page.tsx` | Single source of truth; all children receive filtered props |
| Chart library | recharts `ComposedChart` | Dual Y-axes: Area (cumulative, left) + colored Bars (period PnL, right) |
| Styling | Tailwind v4 + CSS variables | No `tailwind.config.js` needed; arbitrary values for brand colors |
| Color palette | bg `#050b14`, card `#0a1628`, border `#152035`, green `#0ecb81`, red `#f6465d` | High-contrast dark terminal feel |
| Exchange colors | Binance `#F0B90B`, Bybit `#FF6B2C`, OKX `#4F8EF7` | Matches each exchange's official brand |
| Metrics source | Daily PnL → Sharpe/Sortino/MDD/CAGR; Trades → WinRate/PF/AvgWin/Fees | Correct financial separation |
| Initial capital | $6,800,000 (used only for ratio calculations) | Realistic small-fund size |

### Mock Data Profile

| Sub-account | Exchange | Target Sharpe | Archetype |
|---|---|---|---|
| Alpha Fund | Binance | ~1.8 | Aggressive momentum |
| Beta Fund | Binance | ~1.2 | Alt-coin mid-vol |
| Gamma Stable | Binance | ~2.1 | Conservative yield |
| Delta Perps | Bybit | ~1.0 | High-vol perpetuals |
| Epsilon MM | Bybit | ~2.5 | Market making |
| Zeta Options | OKX | ~1.3 | Options strategies |
| Eta Arb | OKX | ~2.2 | Statistical arbitrage |

### Next Steps (not yet built)

- Pages 2–5 from Site Structure below (Performance Indicators, Trading Results, Trading History, API)
- `lib/adapters/` — real exchange API adapters (Binance, Bybit, OKX)
- `/api/` routes — server-side proxy for API keys
- Proper session auth (NextAuth or JWT cookies) to replace localStorage
- Logo hover dropdown navigation
- Period selector component (1D / Week / Month / Year / Manual) — global, shared across all pages

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

### 2. Performance Indicators `/performance`

**Purpose:** deep-dive into individual metrics over time; multi-account comparison.

**Layout:**
- Top: metric selector grid — all metrics displayed as tiles (spot + futures split where applicable); clicking a tile selects it
- Bottom: dynamic line chart of the selected metric over time — one line per selected account/exchange

**Multi-select:** user can toggle multiple accounts/exchanges on the chart simultaneously. Each line gets the exchange brand color; sub-accounts get shades of that color.

**Period selector:** controls both the metric tiles (period snapshot) and the chart time range.

**New components needed:**
- `components/charts/MetricLineChart.tsx` — multi-line recharts LineChart, legend, hover tooltip showing all series values
- `components/metrics/MetricSelector.tsx` — clickable tile grid for metric selection

**Data:** metrics computed per account per time window; stored as a time series, not a single snapshot.

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
| `calculateMetrics` | empty input returns zero metrics; positive PnL; negative PnL; single-day data |
| `aggregateChartData` | daily (last 90 days), weekly, monthly aggregation; empty input; single entry |
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
- Interfaces in `src/lib/types.ts`, not inline

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
- Business logic in `src/lib/`, not in components
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
├── providers.tsx                  # AuthProvider (client)
├── login/page.tsx
├── dashboard/page.tsx             # Page 1: Dashboard
├── performance/page.tsx           # Page 2: Performance Indicators
├── results/page.tsx               # Page 3: Trading Results
├── history/page.tsx               # Page 4: Trading History
├── api-settings/page.tsx          # Page 5: API Management
└── api/                           # Server-side API routes
    └── exchanges/[exchange]/ping/ # Connection health check

components/
├── ui/                # Primitives: Button, Card, Badge, PeriodSelector, Skeleton
├── layout/            # Header, NavDropdown, FilterBar
├── charts/            # PnLChart, MetricLineChart, OverlayLineChart
├── metrics/           # MetricCard, MetricsGrid, MetricSelector
├── orders/            # OrdersTable, TradeFilters, ComparisonTable, ExportButton
└── api/               # ExchangeCard, ApiKeyInput, StatusBadge

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
- All keys stored in `.env.local`, accessed only via `src/app/api/` routes
- Never expose `apiSecret` to the client

---

## What NOT to do

- ❌ Don't use `console.log` in production code — use proper error handling
- ❌ Don't hardcode exchange names as strings — use the `Exchange` enum from `types.ts`
- ❌ Don't put calculations in components — always use `calculations.ts`
- ❌ Don't commit `.env.local` or any API keys
- ❌ Don't make the UI look like a generic crypto retail app
