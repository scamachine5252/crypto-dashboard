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

- `lib/adapters/` — real exchange API adapters (Binance, Bybit, OKX)
- `/api/` routes — server-side proxy for API keys (see Exchange API Notes below)
- Proper session auth (NextAuth or JWT cookies) to replace localStorage
- Date range picker for custom PnL windows
- CSV / PDF export for the orders table
- Per-trade notes / tagging

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
src/
├── app/                  # Next.js pages (login, dashboard)
├── components/
│   ├── ui/               # Reusable primitives (Button, Card, Badge)
│   ├── charts/           # PnL charts, equity curves
│   ├── metrics/          # Metric cards (Sharpe, Drawdown, etc.)
│   ├── orders/           # Orders table, filters
│   └── layout/           # Sidebar, header, nav
├── lib/
│   ├── types.ts          # ALL TypeScript interfaces
│   ├── calculations.ts   # Sharpe, Sortino, CAGR, etc.
│   ├── mock-data.ts      # Mock data (replace with real adapters later)
│   └── adapters/         # Exchange API adapters (Binance, Bybit, OKX)
└── hooks/                # Custom React hooks
```

**Golden rule**: To add a new exchange, you only need to add one file in `src/lib/adapters/`. Nothing else should change.

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
