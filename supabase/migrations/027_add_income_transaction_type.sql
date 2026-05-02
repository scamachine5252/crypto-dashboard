-- Add 'income' as a valid transaction type.
-- 'income' = internal income distributions (Flexible Earn, BTC lending yield, PM rebates)
-- that represent real profit but are NOT external capital inflows.
-- Excluded from Net Deposits; captured implicitly via balance delta → Trading Result.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit', 'withdrawal', 'income'));

-- Re-classify income_ prefixed entries, but ONLY for portfolio_margin accounts.
-- UNIFIED accounts also generate income_ prefixed tx_ids via fapiPrivateGetIncome
-- for real capital transfers (e.g. spot→futures) — those must stay as 'deposit'.
UPDATE transactions t
SET type = 'income'
WHERE t.tx_id LIKE 'income_%'
  AND t.type = 'deposit'
  AND t.account_id IN (
    SELECT id FROM accounts WHERE instrument = 'portfolio_margin'
  );
