ALTER TABLE accounts
ADD COLUMN instrument text NOT NULL DEFAULT 'spot'
CHECK (instrument IN ('spot', 'futures', 'options'));
