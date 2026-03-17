ALTER TABLE trades ADD COLUMN IF NOT EXISTS direction text
CHECK (direction IN ('long', 'short', 'unknown'));
