-- Self-healing reconciliation state per account
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS reconcile_consecutive_failures int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconcile_first_failure_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_backoff_until        timestamptz;

-- Symbol discovery count per full sync job (visibility into discover completeness)
ALTER TABLE full_sync_jobs
  ADD COLUMN IF NOT EXISTS discovered_symbols_count int;

-- Fast lookup for anomaly detection in /api/worker-status
CREATE INDEX IF NOT EXISTS idx_accounts_reconcile_failures
  ON accounts (reconcile_consecutive_failures)
  WHERE reconcile_consecutive_failures > 0;
