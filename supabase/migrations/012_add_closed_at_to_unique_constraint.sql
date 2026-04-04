-- Replace (account_id, symbol, opened_at) with (account_id, symbol, opened_at, closed_at)
-- This allows opened_at and closed_at to differ (correct open/close timestamps),
-- while still preventing duplicate upserts for the same position.
DROP INDEX IF EXISTS trades_account_symbol_opened_at_idx;

CREATE UNIQUE INDEX trades_account_symbol_opened_closed_idx
ON trades (account_id, symbol, opened_at, closed_at);
