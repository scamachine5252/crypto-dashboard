-- ============================================================
-- 001_initial_schema.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. accounts
-- ------------------------------------------------------------
CREATE TABLE accounts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange              text        NOT NULL CHECK (exchange IN ('binance', 'bybit', 'okx')),
  label                 text        NOT NULL,
  api_key_encrypted     text        NOT NULL,
  api_secret_encrypted  text        NOT NULL,
  passphrase_encrypted  text,                          -- OKX only, nullable
  is_testnet            boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- 2. balances
-- ------------------------------------------------------------
CREATE TABLE balances (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  usdt_balance  numeric     NOT NULL DEFAULT 0,
  token_symbol  text,
  token_balance numeric               DEFAULT 0,
  note          text,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON balances
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------
-- 3. trades
-- ------------------------------------------------------------
CREATE TABLE trades (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  exchange     text        NOT NULL,
  symbol       text        NOT NULL,
  side         text        NOT NULL CHECK (side IN ('buy', 'sell')),
  trade_type   text        NOT NULL CHECK (trade_type IN ('spot', 'futures')),
  entry_price  numeric,
  exit_price   numeric,
  quantity     numeric,
  pnl          numeric,
  fee          numeric,
  opened_at    timestamptz,
  closed_at    timestamptz,
  raw_data     jsonb,                                  -- original exchange response
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON trades
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
