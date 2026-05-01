-- Prevent duplicate balance rows for the same account + timestamp.
-- The backfill route already guards against duplicates via a pre-flight SELECT,
-- but without a DB constraint a repeated backfill or concurrent request can still
-- insert duplicates. ON CONFLICT DO NOTHING lets upsert be idempotent.
--
-- Note: recorded_at is stored at second granularity (ISO string from new Date().toISOString()).
-- Two rows with the same account_id and the exact same timestamp are always duplicates.
ALTER TABLE balances
  ADD CONSTRAINT balances_account_recorded_unique
  UNIQUE (account_id, recorded_at);
