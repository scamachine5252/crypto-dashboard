CREATE UNIQUE INDEX IF NOT EXISTS trades_account_symbol_opened_at_idx
ON trades (account_id, symbol, opened_at);
