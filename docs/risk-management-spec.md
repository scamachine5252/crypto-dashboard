# Risk Management System — Technical Specification

**Project:** Cicada Foundation Dashboard  
**Version:** 1.1  
**Date:** 2026-04-28

---

## 1. Overview

The Risk Management system provides real-time risk monitoring for hedge fund operators. It tracks open positions across all connected exchange accounts against configurable thresholds and:

- Sends a **Telegram alert** when a metric exceeds `alert_threshold`
- **Suspends the account** (`is_suspended = true`) when a metric exceeds `kill_threshold`
- Stores a **full alert history** with per-alert acknowledgement ("Dismiss")

The system is accessible at `/risk-management` and operates across all supported exchanges (Bybit, Binance, OKX, MEXC).

---

## 2. Database Schema

### `risk_rules` — per-account thresholds

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | auto-generated |
| `account_id` | uuid → `accounts.id` | CASCADE DELETE |
| `rule_type` | text | enum of 9 types (see §3) |
| `alert_threshold` | numeric | warning level |
| `kill_threshold` | numeric? | suspension level — `null` = no kill |
| `enabled` | boolean | soft disable without deleting |
| `created_at`, `updated_at` | timestamptz | — |

Unique constraint: `(account_id, rule_type)` — one threshold set per rule per account.

---

### `risk_alerts` — violation and error history

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | — |
| `account_id` | uuid → `accounts.id` | — |
| `rule_type` | text | one of 9 rule types, or `'evaluation_error'` for exchange failures |
| `current_value` | numeric | metric value at time of violation; `0` for evaluation errors |
| `alert_threshold` | numeric | threshold that was breached; `0` for evaluation errors |
| `kill_threshold` | numeric? | kill threshold at time of violation |
| `severity` | text | `'warning'` or `'critical'` |
| `acknowledged` | boolean | DEFAULT false |
| `fired_at` | timestamptz | DEFAULT now() |

**Special `rule_type` value:** `'evaluation_error'` is written when an account fails during evaluation (exchange unreachable, API keys expired, rate limit, etc.). These appear in the Alerts section of the Monitor tab alongside regular rule violations and use the same deduplication logic (max 1 per account per day).

---

### `risk_metric_snapshots` — last computed metric values

| Column | Type | Notes |
|--------|------|-------|
| `account_id` | uuid PK | — |
| `rule_type` | text PK | — |
| `current_value` | numeric | last computed value |
| `evaluated_at` | timestamptz | — |

Written after every evaluation run. Enables fast page load without live exchange calls.

---

### Additional columns on `accounts`

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `is_suspended` | boolean | `false` | Set to `true` by kill switch. Sync skips suspended accounts. |
| `kill_switch_enabled` | boolean | `true` | Master toggle. When `false`, account is never suspended even if kill threshold is breached. |

---

## 3. Rule Types

9 supported rule types:

| `rule_type` | Unit | Formula | Direction |
|---|---|---|---|
| `max_positions` | count | `positions.length` | higher = worse |
| `position_size` | USD | `max(position.notional)` | higher = worse |
| `max_drawdown` | % | `(peakAdjusted − currentAdjusted) / peakAdjusted × 100` | higher = worse |
| `max_unrealized_pnl_per_position` | USD | `abs(min(position.unrealizedPnl))` when negative | higher = worse |
| `max_net_position_instrument` | USD | `max over symbols of abs(sum_longs − sum_shorts)` | higher = worse |
| `max_net_position_account` | USD | `abs(total_longs − total_shorts)` | higher = worse |
| `leverage` | x | `sum(notional) / currentUsdtBalance` | higher = worse |
| `margin_utilization` | % | `sum(margin) / currentUsdtBalance × 100` | higher = worse |
| `min_liq_distance` | % | `min(abs(markPrice − liqPrice) / markPrice × 100)` | **lower = worse** |

### Drawdown adjustment for deposits/withdrawals

`max_drawdown` uses deposit/withdrawal-adjusted balances to avoid confusing capital inflows with trading gains:

```
adjustedBalance(date) = usdtBalance(date) − cumDeposits(≤date) + cumWithdrawals(≤date)
peakAdjustedBalance   = max(adjustedBalance) over full history
currentAdjustedBalance = currentBalance − totalDeposits + totalWithdrawals
drawdown              = (peakAdjusted − currentAdjusted) / peakAdjusted × 100
```

---

## 4. API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/risk/rules?account_id=` | List rules, optionally filtered by account |
| `POST` | `/api/risk/rules` | Create or update a rule (upsert on `account_id + rule_type`) |
| `DELETE` | `/api/risk/rules/[id]` | Delete a rule |
| `GET` | `/api/risk/alerts?account_id=&acknowledged=` | List alerts (max 200), sorted by `fired_at` DESC |
| `PATCH` | `/api/risk/alerts/[id]/acknowledge` | Mark an alert as acknowledged |
| `POST` | `/api/risk/evaluate` | Run full risk evaluation cycle |
| `GET` | `/api/risk/live-metrics` | Live positions + all 9 metrics across all accounts (calls exchanges) |
| `GET` | `/api/risk/snapshots` | Last saved metric values from DB (no exchange call) |

---

## 5. Evaluation Engine

Located in `lib/risk/run-evaluation.ts`. Called from:
- `POST /api/risk/evaluate` (manual Refresh on the UI)
- `POST /api/sync` (after every sync cycle, automatically)

### Algorithm

```
For each account where is_suspended = false:
  1. Load enabled risk_rules from DB
  2. Decrypt API keys and create exchange adapter
  3. Call adapter.fetchPositions() → live open positions
  4. Load latestBalance and allTimeHighBalance from balances table
  5. Compute peakAdjustedBalance and currentAdjustedBalance (accounting for transactions)
  6. computeAllMetricValues() → all 9 metric values
  7. Upsert into risk_metric_snapshots (one row per rule_type per account)
  8. evaluateRules() → list of violations

  For each violation:
    a. Check: is there already an unacknowledged alert for this rule today?
       → If yes, skip (deduplication: max 1 alert per rule per day)
    b. INSERT into risk_alerts
    c. If severity = 'critical' AND kill_threshold set AND kill_switch_enabled = true:
       → UPDATE accounts SET is_suspended = true
    d. Send Telegram message (errors are caught and logged — do not break the loop)

  If the account throws at any point (exchange down, keys expired, rate limit):
    a. Capture the full error message from the exception
    b. Check: is there already an unacknowledged 'evaluation_error' alert today for this account?
       → If yes, skip (same deduplication as rule violations)
    c. INSERT into risk_alerts with rule_type = 'evaluation_error', severity = 'warning'
    d. Send Telegram message with the error reason (truncated to 300 chars)
    e. Continue to the next account — one failure does not interrupt others

runRiskEvaluation() returns { evaluated, violations, errors } where errors is the count
of accounts that failed during the run.
```

---

## 6. Telegram Alerts

Direct HTTP call to the Telegram Bot API — no third-party library.

**Required environment variables:**
- `TELEGRAM_BOT_TOKEN` — bot token from @BotFather
- `TELEGRAM_CHAT_ID` — chat or group ID to send messages to

If either variable is missing, alerts are silently skipped (no error thrown).

### Warning message format
```
⚠️ RISK ALERT — Aniket (bybit)
Rule: Max Drawdown
Current: 1.80 | Alert: 1.50
2026-04-28 14:32 UTC
```

### Critical / Kill Switch message format
```
🔴 KILL SWITCH — Aniket (bybit)
Rule: Max Drawdown
Current: 2.10 | Kill: 2.00
Account SUSPENDED — revoke API key manually on exchange.
2026-04-28 14:32 UTC
```

### Evaluation error message format
Sent when an account cannot be evaluated (exchange unreachable, API keys expired, rate limit, etc.).

```
⚠️ EVALUATION ERROR — Aniket (bybit)
Risk check failed — account may be unmonitored.
`bybit {"retCode":10004,"retMsg":"error sign! origin_string..."}`
2026-04-28 14:32 UTC
```

The error reason is taken directly from the exception message and truncated to 300 characters. Formatted with `<code>` tags for Telegram HTML mode. Deduplication: max 1 message per account per day.

---

## 7. UI — `/risk-management` Page

Two tabs: **Monitor** and **Settings**.

---

### Monitor Tab

#### Metrics table

One row per account, 9 metric columns. Data loaded via `GET /api/risk/live-metrics` on each Refresh — live exchange call.

**Cell color coding:**

| Color | Meaning |
|-------|---------|
| Green | Value within limits |
| Yellow `#FBBF24` | `alert_threshold` exceeded |
| Red | `kill_threshold` exceeded |
| `—` | No rule configured, no data, or no open positions |

`min_liq_distance` is inverted: red when the value is **below** the threshold (closer to liquidation = worse).

#### Position drill-down

Clicking any metric cell expands an inline table with the top 5 positions most relevant to that metric:

| Metric | Sort order |
|--------|-----------|
| `max_positions`, `position_size`, `leverage` | notional DESC |
| `max_unrealized_pnl_per_position` | unrealizedPnl ASC (worst loss first) |
| `max_net_position_instrument` | abs(net exposure per symbol) DESC |
| `max_net_position_account` | signed net position DESC |
| `margin_utilization` | margin DESC |
| `min_liq_distance` | distance to liquidation ASC (closest first) |
| `max_drawdown` | no positions shown — balance-level metric |

Columns shown: Symbol, Side, Notional, Entry Price, Mark Price, Unrealized PnL, Liq Price, Liq Distance.

#### Refresh button

Pressing Refresh executes three calls in sequence:
1. `GET /api/risk/live-metrics` — fetch live positions and compute metrics
2. `POST /api/risk/evaluate` — evaluate rules, write alerts to DB, send Telegram if triggered
3. `GET /api/risk/alerts?acknowledged=false` — reload alert list

#### Alerts section

List of unacknowledged alerts below the metrics table. Filter buttons: **Unread** | **Critical** | **All**.

Each alert row: severity badge, account + rule name, current value vs threshold, timestamp, Dismiss button.

---

### Settings Tab

#### Thresholds table

One row per account. For each of the 9 rule types, two numeric inputs: **Alert** and **Kill**.

- Empty alert input = rule is disabled (no monitoring for that metric on that account)
- Kill input is optional — leave empty for alert-only rules

Two additional columns per account:
- **Monitor ON/OFF** — enables or disables all rules for this account (`enabled` flag on all rules)
- **Kill SW ON/OFF** — toggles `accounts.kill_switch_enabled`; turning it **on** requires an inline confirmation step to prevent accidental activation

#### Save All

On save, for every account:
- Rules with a filled alert threshold → `POST /api/risk/rules` (upsert)
- Rules with empty alert threshold that exist in DB → `POST /api/risk/rules` with `enabled: false`
- `PATCH /api/accounts/[id]` → update `kill_switch_enabled`

---

## 8. Known Limitations

| Area | Status |
|------|--------|
| Evaluation failure visibility | **Implemented** — error captured, written to `risk_alerts` as `evaluation_error`, Telegram sent with full error reason; deduped 1 per account per day |
| Alert deduplication | **Implemented** — max 1 alert per rule (or per evaluation error) per account per day |
| Scheduled automatic evaluation (cron) | **Not implemented** — evaluate only runs on manual Refresh or during sync |
| True API key revocation via exchange | **Not implemented** — only `is_suspended = true` + manual operator instruction |
| Alert pagination beyond 200 | **Not implemented** — hard limit of 200 alerts |
| Unsuspending an account via UI | **Not implemented** — no UI or API route to clear `is_suspended` |
| Recovery alert (notify when violation clears) | **Not implemented** |
| Multiple Telegram recipients (per-fund chat IDs) | **Not implemented** — single global `TELEGRAM_CHAT_ID` |

---

## 9. File Map

| File | Role |
|------|------|
| `lib/risk/types.ts` | TypeScript interfaces: `RiskRule`, `RiskAlert`, `RiskViolation`, `EvaluateInput` |
| `lib/risk/evaluate.ts` | Pure functions: `computeAllMetricValues()`, `evaluateRules()` |
| `lib/risk/run-evaluation.ts` | Orchestration: fetch positions, compute, write to DB, trigger Telegram |
| `lib/telegram.ts` | `sendTelegramAlert()`, `formatAlertMessage()`, `formatEvaluationErrorMessage()` |
| `app/api/risk/rules/route.ts` | `GET` / `POST` rules |
| `app/api/risk/rules/[id]/route.ts` | `DELETE` rule |
| `app/api/risk/alerts/route.ts` | `GET` alerts |
| `app/api/risk/alerts/[id]/acknowledge/route.ts` | `PATCH` acknowledge |
| `app/api/risk/evaluate/route.ts` | `POST` trigger evaluation |
| `app/api/risk/live-metrics/route.ts` | `GET` live positions + metrics |
| `app/api/risk/snapshots/route.ts` | `GET` last saved metric snapshots |
| `app/risk-management/page.tsx` | Full UI — Monitor + Settings tabs |
| `supabase/migrations/017_add_risk_rules.sql` | Creates `risk_rules` table |
| `supabase/migrations/018_add_risk_alerts.sql` | Creates `risk_alerts` table |
| `supabase/migrations/019_risk_monitor_snapshots.sql` | Creates `risk_metric_snapshots`, adds `kill_switch_enabled` |
| `supabase/migrations/020_extend_risk_rule_types.sql` | Extends CHECK constraint to include `leverage`, `margin_utilization`, `min_liq_distance` |
