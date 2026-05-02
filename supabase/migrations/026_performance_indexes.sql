-- Performance indexes: every query hot-path was doing full table scans.
-- trades: 139K rows, queried by account_id + closed_at on every page load.
-- balances: thousands of rows, queried by account_id + recorded_at.

-- Trades: most queries filter by account_id + closed_at range, some also filter pnl != 0.
CREATE INDEX IF NOT EXISTS trades_account_closed_at_idx
  ON trades (account_id, closed_at DESC);

-- Separate index on pnl for the `.neq('pnl', 0)` filter used in performance/trades routes.
CREATE INDEX IF NOT EXISTS trades_pnl_idx
  ON trades (pnl)
  WHERE pnl IS NOT NULL;

-- Balances: queried by account_id + recorded_at + token_symbol IS NULL.
CREATE INDEX IF NOT EXISTS balances_account_recorded_at_idx
  ON balances (account_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS balances_account_token_null_idx
  ON balances (account_id, recorded_at DESC)
  WHERE token_symbol IS NULL;

-- Transactions: queried by account_id + recorded_at in risk evaluation and results route.
CREATE INDEX IF NOT EXISTS transactions_account_recorded_at_idx
  ON transactions (account_id, recorded_at DESC);

-- Risk alerts: queried by account_id + acknowledged status.
CREATE INDEX IF NOT EXISTS risk_alerts_account_acknowledged_idx
  ON risk_alerts (account_id, acknowledged, fired_at DESC);
