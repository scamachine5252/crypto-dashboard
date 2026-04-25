CREATE TABLE risk_rules (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_type        text    NOT NULL CHECK (rule_type IN (
    'position_size',
    'max_drawdown',
    'max_positions',
    'max_unrealized_pnl_per_position',
    'max_net_position_instrument',
    'max_net_position_account'
  )),
  alert_threshold  numeric NOT NULL,
  kill_threshold   numeric,
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, rule_type)
);
ALTER TABLE risk_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON risk_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);
