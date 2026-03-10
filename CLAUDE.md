# Crypto Hedge Fund Dashboard — Claude Instructions

## Project Overview
This is a professional crypto hedge fund PnL dashboard built with Next.js, TypeScript, and Tailwind CSS.
It tracks trading performance across Binance, Bybit, and OKX exchanges with sub-account support.

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
