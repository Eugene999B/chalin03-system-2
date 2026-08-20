SELECT migration_name, applied_at
FROM schema_migrations
WHERE migration_name = 'equipment_finance_phase5d_delivery_confirmation';

SELECT COUNT(*) AS missing_confirmation_columns
FROM (
    SELECT 'equipment_finance_document_delivery_policy' AS table_name, 'delivery_confirmation_policy_version' AS column_name
    UNION ALL SELECT 'equipment_finance_document_delivery_policy', 'independent_delivery_confirmation_required'
    UNION ALL SELECT 'equipment_finance_case_activity', 'authorization_id'
    UNION ALL SELECT 'equipment_finance_case_activity', 'delivery_id'
    UNION ALL SELECT 'equipment_sale_agreements', 'controlled_delivery_completed_at'
    UNION ALL SELECT 'equipment_sale_agreements', 'controlled_delivery_completed_by'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END AS missing_confirmation_table
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_finance_delivery_confirmations';

SELECT COUNT(*) AS invalid_confirmation_policy
FROM equipment_finance_document_delivery_policy
WHERE id = 1
  AND (
      delivery_confirmation_policy_version <> 'FIN-DELIVERY-CONFIRM-1'
      OR independent_delivery_confirmation_required <> 1
  );

SELECT COUNT(*) AS invalid_delivery_confirmations
FROM equipment_finance_delivery_confirmations confirmation
LEFT JOIN equipment_finance_delivery_authorizations authorization
  ON authorization.id = confirmation.authorization_id
WHERE authorization.id IS NULL
   OR authorization.authorization_status <> 'consumed'
   OR authorization.delivery_id <> confirmation.delivery_id
   OR authorization.consumed_by <> confirmation.confirmed_by
   OR confirmation.confirmation_checksum IS NULL
   OR CHAR_LENGTH(confirmation.confirmation_checksum) <> 64
   OR confirmation.confirmed_by = authorization.decided_by;
