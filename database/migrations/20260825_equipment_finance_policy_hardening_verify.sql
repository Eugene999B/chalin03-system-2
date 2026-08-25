-- READ-ONLY VERIFICATION FOR THE EQUIPMENT FINANCE POLICY HARDENING.
-- The verifier performs SELECT-only checks and never repairs schema/data.

SELECT migration_name
  FROM schema_migrations
 WHERE migration_name = '20260825_equipment_finance_policy_hardening';

SELECT COUNT(*) AS missing_policy_columns
FROM (
    SELECT 'equipment_sale_agreements' AS table_name, 'policy_version_snapshot' AS column_name
    UNION ALL SELECT 'equipment_sale_agreements', 'late_charge_type_snapshot'
    UNION ALL SELECT 'equipment_sale_agreements', 'late_charge_value_snapshot'
    UNION ALL SELECT 'equipment_sale_agreements', 'late_charge_cap_snapshot'
    UNION ALL SELECT 'equipment_sale_agreements', 'grace_days_snapshot'
    UNION ALL SELECT 'equipment_sale_agreements', 'agreement_terms_snapshot'
    UNION ALL SELECT 'equipment_sale_agreements', 'reconciliation_status'
    UNION ALL SELECT 'equipment_sale_agreements', 'reconciliation_checked_at'
    UNION ALL SELECT 'equipment_finance_settings', 'boss_due_alert_enabled'
    UNION ALL SELECT 'equipment_finance_settings', 'boss_overdue_alert_enabled'
    UNION ALL SELECT 'equipment_finance_settings', 'customer_due_soon_sms_enabled'
    UNION ALL SELECT 'equipment_finance_settings', 'customer_due_today_sms_enabled'
    UNION ALL SELECT 'equipment_finance_settings', 'customer_overdue_sms_enabled'
    UNION ALL SELECT 'equipment_finance_settings', 'late_fee_applied_sms_enabled'
    UNION ALL SELECT 'equipment_finance_settings', 'payment_reversal_sms_enabled'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS missing_policy_indexes
FROM (
    SELECT 'equipment_sale_agreements' AS table_name,
           'idx_finance_agreement_reconciliation' AS index_name
) required
LEFT JOIN information_schema.STATISTICS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.INDEX_NAME = required.index_name
WHERE actual.INDEX_NAME IS NULL;

SELECT COUNT(*) AS missing_policy_triggers
FROM (
    SELECT 'trg_equipment_finance_agreement_policy_snapshot_before_insert' AS trigger_name
    UNION ALL SELECT 'trg_equipment_finance_agreement_policy_snapshot_before_update'
) required
LEFT JOIN information_schema.TRIGGERS actual
  ON actual.TRIGGER_SCHEMA = DATABASE()
 AND actual.TRIGGER_NAME = required.trigger_name
WHERE actual.TRIGGER_NAME IS NULL;
