-- Migration 008: track when a full 180-day trade scan was last completed
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_full_sync_at timestamptz;
