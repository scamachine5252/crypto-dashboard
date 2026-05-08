-- Add snapshot_date computed column and enforce one USDT balance snapshot per account per day.
-- Previously: recorded_at = new Date() → exact timestamp → duplicate rows if cron fires twice.
-- Now: upsert on (account_id, snapshot_date) → idempotent, no gaps from double-fire.

ALTER TABLE balances
  ADD COLUMN IF NOT EXISTS snapshot_date date
  GENERATED ALWAYS AS ((recorded_at AT TIME ZONE 'UTC')::date) STORED;

-- One snapshot per account per day for the USDT aggregate row (token_symbol IS NULL).
-- Token rows are excluded — they can have multiple per day (different tokens).
CREATE UNIQUE INDEX IF NOT EXISTS balances_daily_unique
  ON balances (account_id, snapshot_date)
  WHERE token_symbol IS NULL;
