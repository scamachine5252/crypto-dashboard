-- Allow 'funding_fee' as a transaction type.
-- funding_fee = perpetual contract funding payments (received or paid every 8h).
-- Stored with signed amount: positive = received, negative = paid.
-- Excluded from Net Deposits; shown separately in the Results table.

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit', 'withdrawal', 'income', 'funding_fee'));
