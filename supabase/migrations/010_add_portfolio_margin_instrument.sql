-- Migration 010: add 'portfolio_margin' instrument type for Binance PM accounts
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_instrument_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_instrument_check
  CHECK (instrument IN ('spot', 'futures', 'options', 'unified', 'portfolio_margin'));
