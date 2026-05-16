-- trade_aggregates: used by /api/results
-- Single GROUP BY SUM per account instead of 38+ sequential paginated queries
create or replace function trade_aggregates(
  p_account_ids uuid[],
  p_since       timestamptz,
  p_until       timestamptz
) returns table (
  account_id uuid,
  total_pnl  double precision,
  total_fee  double precision
) language sql stable as $$
  select
    account_id,
    coalesce(sum(pnl),  0)::double precision as total_pnl,
    coalesce(sum(fee),  0)::double precision as total_fee
  from trades
  where account_id = any(p_account_ids)
    and closed_at is not null
    and closed_at >= p_since
    and closed_at <= p_until
  group by account_id
$$;

-- trade_stats_by_account_day: used by /api/dashboard
-- Returns per-(account, day) aggregates — max ~1800 rows vs 37K raw trade rows
-- Replaces 38+ sequential paginated queries with a single SQL call
create or replace function trade_stats_by_account_day(
  p_account_ids uuid[],
  p_since       timestamptz,
  p_until       timestamptz
) returns table (
  account_id   uuid,
  day          date,
  daily_pnl    double precision,
  daily_fee    double precision,
  daily_volume double precision,
  win_count    bigint,
  loss_count   bigint,
  gross_profit double precision,
  gross_loss   double precision
) language sql stable as $$
  select
    account_id,
    date(closed_at)                                                                     as day,
    coalesce(sum(pnl),  0)::double precision                                            as daily_pnl,
    coalesce(sum(fee),  0)::double precision                                            as daily_fee,
    coalesce(sum(coalesce(quantity, 0) * coalesce(entry_price, 0)), 0)::double precision as daily_volume,
    count(*) filter (where pnl > 0)                                                     as win_count,
    count(*) filter (where pnl < 0)                                                     as loss_count,
    coalesce(sum(pnl) filter (where pnl > 0), 0)::double precision                     as gross_profit,
    abs(coalesce(sum(pnl) filter (where pnl < 0), 0))::double precision                as gross_loss
  from trades
  where account_id = any(p_account_ids)
    and closed_at is not null
    and closed_at >= p_since
    and closed_at <= p_until
    and pnl <> 0
  group by account_id, date(closed_at)
  order by account_id, date(closed_at)
$$;
