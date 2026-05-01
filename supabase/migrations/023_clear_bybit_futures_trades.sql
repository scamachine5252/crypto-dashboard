-- Migration 013: Clear Bybit futures trades with incorrect opened_at timestamps.
--
-- Root cause: /v5/position/closed-pnl mapped createdTime → opened_at, but
-- createdTime is when the closed-pnl record was written (= close time), not
-- when the position was actually opened. This caused opened_at ≈ closed_at
-- (3ms apart) for all Bybit futures trades.
--
-- Fix: Adapter switched to /v5/execution/list which provides real execTime
-- per fill. After this migration, run Full History sync on all Bybit accounts
-- to repopulate with accurate timestamps.
--
-- Spot trades are NOT affected (they use fetchMyTrades and have correct timestamps).

DELETE FROM trades
WHERE exchange = 'bybit'
  AND trade_type = 'futures';
