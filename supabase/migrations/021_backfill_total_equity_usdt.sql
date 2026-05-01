-- Backfill total_equity_usdt for all historical rows where it is NULL.
-- Before this migration, adapters (Bybit, OKX, Binance UNIFIED) did not populate
-- total_equity_usdt, so all historical snapshots have NULL.
--
-- We set total_equity_usdt = usdt_balance as the best available approximation
-- for historical data. This prevents a visible discontinuity in balance charts
-- when new syncs start writing the real equity value.
--
-- Going forward, adapters now read totalEquityValue / totalEq / totalMarginBalance
-- from exchange API responses and store accurate equity including unrealized PnL.

UPDATE balances
SET total_equity_usdt = usdt_balance
WHERE total_equity_usdt IS NULL;
