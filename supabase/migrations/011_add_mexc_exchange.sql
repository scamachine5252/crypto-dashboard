-- Add MEXC to the exchange CHECK constraints in accounts and trades tables.

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_exchange_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_exchange_check
  CHECK (exchange IN ('binance', 'bybit', 'okx', 'mexc'));

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_exchange_check;
ALTER TABLE trades ADD CONSTRAINT trades_exchange_check
  CHECK (exchange IN ('binance', 'bybit', 'okx', 'mexc'));
