-- Migration 007: add 'unified' instrument type
-- Drop old check constraint (auto-named by Postgres)
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_instrument_check;

-- Add new constraint including 'unified' (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_instrument_check'
      AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_instrument_check
      CHECK (instrument IN ('spot', 'futures', 'options', 'unified'));
  END IF;
END;
$$;

-- Change default to 'unified'
ALTER TABLE accounts ALTER COLUMN instrument SET DEFAULT 'unified';

-- Make nullable (instrument is now optional at the API level)
ALTER TABLE accounts ALTER COLUMN instrument DROP NOT NULL;

-- Update existing records to 'unified'
UPDATE accounts SET instrument = 'unified';
