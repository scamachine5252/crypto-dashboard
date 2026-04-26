-- ============================================================
-- 015_add_transactions_table.sql
-- Deposits and withdrawals per account.
-- tx_id is the exchange's own transaction identifier.
-- UNIQUE (account_id, tx_id) prevents duplicate upserts.
-- ============================================================

CREATE TABLE transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  exchange    text        NOT NULL,
  type        text        NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
  asset       text        NOT NULL,
  amount      numeric     NOT NULL,
  fee         numeric,
  status      text,
  tx_id       text,
  recorded_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, tx_id)
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON transactions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
