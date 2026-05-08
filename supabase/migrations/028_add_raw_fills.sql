-- Raw execution fills — immutable facts from exchange APIs.
-- Each row is one fill exactly as received (WS or REST), keyed by a stable exec_id.
-- Bybit exec_id: orderId_execTime_execQty (REST has no per-fill unique ID).
-- Binance exec_id: tradeId (field 't' from FAPI/PAPI).
-- OKX exec_id: fillId.
-- MEXC exec_id: orderId_timestamp.
-- PositionReconstructor reads this table and writes to trades (re-runnable, no API needed).

CREATE TABLE IF NOT EXISTS raw_fills (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  exchange     text NOT NULL,
  exec_id      text NOT NULL,
  symbol       text NOT NULL,
  category     text,           -- 'linear'/'inverse'/'spot'/'option' — Bybit only
  exec_time    timestamptz NOT NULL,
  side         text NOT NULL,  -- raw value from exchange: 'Buy'/'Sell', 'BUY'/'SELL', 'buy'/'sell'
  exec_qty     numeric NOT NULL,
  exec_price   numeric NOT NULL,
  exec_pnl     numeric,        -- nullable: absent in Bybit REST (CASE_STUDY A28)
  exec_fee     numeric,
  closed_size  numeric,        -- nullable: Bybit-specific closing signal
  position_idx integer,        -- nullable: Bybit hedge mode slot (absent in Unified REST)
  raw_data     jsonb NOT NULL, -- full API response preserved for audit and future reprocessing
  source       text NOT NULL DEFAULT 'ws' CHECK (source IN ('ws', 'rest')),
  created_at   timestamptz DEFAULT now(),
  UNIQUE (account_id, exchange, exec_id)
);

CREATE INDEX raw_fills_account_time_idx     ON raw_fills (account_id, exec_time DESC);
CREATE INDEX raw_fills_account_symbol_idx   ON raw_fills (account_id, symbol, exec_time DESC);
CREATE INDEX raw_fills_account_category_idx ON raw_fills (account_id, category, exec_time DESC)
  WHERE category IS NOT NULL;
