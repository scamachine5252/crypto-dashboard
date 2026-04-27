-- Исправить временны́е метки бэкфил-транзакций, где recorded_at > первого снепшота баланса
-- того же календарного дня для того же аккаунта.
-- Причина бага: Bybit transactionTime = время сеттлмента, а не время зачисления.
-- Результат: устанавливает recorded_at на 1 минуту раньше ближайшего снепшота того же дня.

UPDATE transactions t
SET recorded_at = (
  SELECT b.recorded_at - interval '1 minute'
  FROM balances b
  WHERE b.account_id = t.account_id
    AND b.token_symbol IS NULL
    AND (b.recorded_at AT TIME ZONE 'UTC')::date = (t.recorded_at AT TIME ZONE 'UTC')::date
  ORDER BY b.recorded_at ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM balances b
  WHERE b.account_id = t.account_id
    AND b.token_symbol IS NULL
    AND (b.recorded_at AT TIME ZONE 'UTC')::date = (t.recorded_at AT TIME ZONE 'UTC')::date
    AND b.recorded_at < t.recorded_at
);
