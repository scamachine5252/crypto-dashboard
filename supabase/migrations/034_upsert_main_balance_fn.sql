-- Supabase JS upsert with onConflict cannot target partial unique indexes.
-- balances_daily_unique is partial (WHERE token_symbol IS NULL), so
-- ON CONFLICT (account_id, snapshot_date) fails without the WHERE clause.
-- This function performs the correct upsert from the worker side.

CREATE OR REPLACE FUNCTION upsert_main_balance(
  p_account_id       uuid,
  p_usdt_balance     numeric,
  p_total_equity_usdt numeric,
  p_recorded_at      timestamptz
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO balances (account_id, usdt_balance, total_equity_usdt, recorded_at)
  VALUES (p_account_id, p_usdt_balance, p_total_equity_usdt, p_recorded_at)
  ON CONFLICT (account_id, snapshot_date) WHERE token_symbol IS NULL
  DO UPDATE SET
    usdt_balance       = EXCLUDED.usdt_balance,
    total_equity_usdt  = EXCLUDED.total_equity_usdt,
    recorded_at        = EXCLUDED.recorded_at;
$$;
