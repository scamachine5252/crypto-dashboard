-- Extend CHECK constraint on risk_rules to include 3 new rule types
ALTER TABLE risk_rules DROP CONSTRAINT IF EXISTS risk_rules_rule_type_check;
ALTER TABLE risk_rules ADD CONSTRAINT risk_rules_rule_type_check
  CHECK (rule_type IN (
    'position_size', 'max_drawdown', 'max_positions',
    'max_unrealized_pnl_per_position', 'max_net_position_instrument', 'max_net_position_account',
    'leverage', 'margin_utilization', 'min_liq_distance'
  ));
