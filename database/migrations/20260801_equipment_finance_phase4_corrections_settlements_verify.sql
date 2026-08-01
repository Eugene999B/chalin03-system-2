SELECT migration_name, description
FROM schema_migrations
WHERE migration_name = 'equipment_finance_phase4_corrections_settlements';

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'equipment_finance_correction_policies',
    'equipment_finance_correction_policy_history',
    'equipment_finance_correction_requests',
    'equipment_finance_ledger_entries',
    'equipment_finance_asset_returns'
  )
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS policy_rows
FROM equipment_finance_correction_policies
WHERE id = 1
  AND policy_version = 'FIN-CORR-1'
  AND require_independent_approval = TRUE;

SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    (TABLE_NAME = 'equipment_finance_correction_requests' AND COLUMN_NAME IN (
      'request_number','agreement_id','payment_id','schedule_id','request_type',
      'request_status','policy_snapshot_json','financial_snapshot_json',
      'proposed_entries_json','requested_by','decided_by','decision_reason'
    ))
    OR
    (TABLE_NAME = 'equipment_finance_ledger_entries' AND COLUMN_NAME IN (
      'entry_number','request_id','agreement_id','payment_id','schedule_id',
      'entry_type','direction','amount','balance_before','balance_after','metadata_json'
    ))
    OR
    (TABLE_NAME = 'equipment_finance_asset_returns' AND COLUMN_NAME IN (
      'return_number','request_id','agreement_id','asset_id','return_type',
      'approved_return_credit','refundable_amount','penalty_amount','damage_amount',
      'settlement_balance','refund_due','policy_version','evidence_reference'
    ))
  )
ORDER BY TABLE_NAME, COLUMN_NAME;

SELECT COUNT(*) AS orphan_ledger_entries
FROM equipment_finance_ledger_entries ledger
LEFT JOIN equipment_finance_correction_requests request
  ON request.id = ledger.request_id
LEFT JOIN equipment_sale_agreements agreement
  ON agreement.id = ledger.agreement_id
WHERE request.id IS NULL OR agreement.id IS NULL;
