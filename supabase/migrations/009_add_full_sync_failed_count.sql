-- Migration 009: track how many symbols failed during the last full Binance scan
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS full_sync_failed_count int NOT NULL DEFAULT 0;
