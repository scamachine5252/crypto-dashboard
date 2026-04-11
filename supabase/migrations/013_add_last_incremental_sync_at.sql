-- Migration 013: track when the last incremental (Cron) sync completed per account
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_incremental_sync_at timestamptz;
