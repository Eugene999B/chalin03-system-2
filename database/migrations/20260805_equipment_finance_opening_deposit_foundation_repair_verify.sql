-- READ-ONLY VERIFICATION FOR THE OPENING DEPOSIT STARTUP REPAIR.

SELECT migration_name
  FROM schema_migrations
 WHERE migration_name = '20260805_equipment_finance_opening_deposit_foundation_repair';

SELECT COUNT(*) AS missing_opening_deposit_columns
FROM (
    SELECT 'equipment_sale_agreements' AS table_name, 'deposit_completed_at' AS column_name
    UNION ALL SELECT 'equipment_sale_agreements', 'deposit_completed_by'
    UNION ALL SELECT 'equipment_sale_agreements', 'reservation_activated_at'
    UNION ALL SELECT 'equipment_sale_agreements', 'reservation_activated_by'
    UNION ALL SELECT 'equipment_sale_payments', 'idempotency_key'
    UNION ALL SELECT 'equipment_sale_payments', 'credit_application_id'
    UNION ALL SELECT 'equipment_sale_payments', 'payment_stage'
    UNION ALL SELECT 'equipment_sale_payments', 'reservation_effect'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS missing_opening_deposit_indexes
FROM (
    SELECT 'equipment_sale_agreements' AS table_name,
           'idx_equipment_finance_deposit_reservation' AS index_name
    UNION ALL SELECT 'equipment_sale_payments', 'uq_equipment_finance_payment_idempotency'
    UNION ALL SELECT 'equipment_sale_payments', 'idx_equipment_finance_payment_stage'
    UNION ALL SELECT 'equipment_sale_payments', 'idx_equipment_finance_payment_application'
) required
LEFT JOIN information_schema.STATISTICS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.INDEX_NAME = required.index_name
WHERE actual.INDEX_NAME IS NULL;

SELECT COUNT(*) AS duplicate_opening_deposit_idempotency_keys
FROM (
    SELECT idempotency_key
      FROM equipment_sale_payments
     WHERE idempotency_key IS NOT NULL
       AND TRIM(idempotency_key) <> ''
     GROUP BY idempotency_key
    HAVING COUNT(*) > 1
) duplicates;
