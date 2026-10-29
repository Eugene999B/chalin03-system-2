-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- PHASE 1: READ-ONLY DATABASE SCHEMA VERIFICATION
-- Every query must return zero before the migration is considered complete.

SELECT COUNT(*) AS missing_phase1_tables
FROM (
    SELECT 'equipment_credit_applications' AS table_name
    UNION ALL SELECT 'equipment_sales_quotations'
    UNION ALL SELECT 'equipment_sales_quotation_items'
    UNION ALL SELECT 'equipment_sale_agreements'
    UNION ALL SELECT 'equipment_asset_sale_locks'
    UNION ALL SELECT 'equipment_sale_payments'
    UNION ALL SELECT 'equipment_deliveries'
    UNION ALL SELECT 'equipment_ownership_transfers'
    UNION ALL SELECT 'equipment_sales_reminder_log'
) required
LEFT JOIN information_schema.TABLES actual
    ON actual.TABLE_SCHEMA = DATABASE()
   AND actual.TABLE_NAME = required.table_name
WHERE actual.TABLE_NAME IS NULL;

SELECT COUNT(*) AS invalid_finance_location_columns
FROM (
    SELECT 'equipment_credit_applications' AS table_name
    UNION ALL SELECT 'equipment_sales_quotations'
    UNION ALL SELECT 'equipment_sales_quotation_items'
    UNION ALL SELECT 'equipment_sale_agreements'
    UNION ALL SELECT 'equipment_asset_sale_locks'
    UNION ALL SELECT 'equipment_sale_payments'
    UNION ALL SELECT 'equipment_deliveries'
    UNION ALL SELECT 'equipment_ownership_transfers'
    UNION ALL SELECT 'equipment_sales_reminder_log'
) required
LEFT JOIN information_schema.COLUMNS actual
    ON actual.TABLE_SCHEMA = DATABASE()
   AND actual.TABLE_NAME = required.table_name
   AND actual.COLUMN_NAME = 'hire_location_id'
WHERE actual.COLUMN_NAME IS NULL
   OR actual.IS_NULLABLE <> 'YES';

SELECT COUNT(*) AS missing_phase1_schedule_columns
FROM (
    SELECT 'equipment_sales_quotations' AS table_name, 'proposed_interval_days' AS column_name
    UNION ALL SELECT 'equipment_sales_quotations', 'proposed_non_working_day_rule'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_interval_days'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_non_working_day_rule'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_periodic_amount'
    UNION ALL SELECT 'equipment_sale_agreements', 'payment_interval_days'
    UNION ALL SELECT 'equipment_sale_agreements', 'non_working_day_rule'
) required
LEFT JOIN information_schema.COLUMNS actual
    ON actual.TABLE_SCHEMA = DATABASE()
   AND actual.TABLE_NAME = required.table_name
   AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS invalid_phase1_schedule_columns
FROM (
    SELECT 'equipment_sales_quotations' AS table_name, 'proposed_interval_days' AS column_name, 'smallint' AS data_type, 'YES' AS is_nullable
    UNION ALL SELECT 'equipment_sales_quotations', 'proposed_non_working_day_rule', 'enum', 'NO'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_interval_days', 'smallint', 'YES'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_non_working_day_rule', 'enum', 'NO'
    UNION ALL SELECT 'equipment_credit_applications', 'proposed_periodic_amount', 'decimal', 'NO'
    UNION ALL SELECT 'equipment_sale_agreements', 'payment_interval_days', 'smallint', 'YES'
    UNION ALL SELECT 'equipment_sale_agreements', 'non_working_day_rule', 'enum', 'NO'
) required
LEFT JOIN information_schema.COLUMNS actual
    ON actual.TABLE_SCHEMA = DATABASE()
   AND actual.TABLE_NAME = required.table_name
   AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL
   OR actual.DATA_TYPE <> required.data_type
   OR actual.IS_NULLABLE <> required.is_nullable;

SELECT COUNT(*) AS invalid_phase1_day_rule_enums
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
      (TABLE_NAME = 'equipment_sales_quotations' AND COLUMN_NAME = 'proposed_non_working_day_rule')
      OR (TABLE_NAME = 'equipment_credit_applications' AND COLUMN_NAME = 'proposed_non_working_day_rule')
      OR (TABLE_NAME = 'equipment_sale_agreements' AND COLUMN_NAME = 'non_working_day_rule')
  )
  AND (
      COLUMN_TYPE NOT LIKE '%exact%'
      OR COLUMN_TYPE NOT LIKE '%next_weekday%'
      OR COLUMN_TYPE NOT LIKE '%previous_weekday%'
  );

SELECT CASE
    WHEN EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE migration_name = '20260801_equipment_finance_phase1_schema_foundation'
    ) THEN 0
    ELSE 1
END AS phase1_migration_record_missing;
