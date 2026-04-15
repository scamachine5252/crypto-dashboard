-- Add initial_aum to accounts so per-account AUM can be used as initial capital
-- for CAGR, Annual Yield, and Max DD% calculations.
-- Nullable: when NULL, the dashboard falls back to estimating IC from balance history.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS initial_aum NUMERIC;
