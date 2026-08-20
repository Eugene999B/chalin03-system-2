SELECT migration_name, applied_at
FROM schema_migrations
WHERE migration_name = 'equipment_finance_phase5c_delivery_authorization';

SELECT COUNT(*) AS missing_policy_columns
FROM (
    SELECT 'delivery_authorization_policy_version' AS column_name
    UNION ALL SELECT 'independent_delivery_authorization_required'
    UNION ALL SELECT 'delivery_authorization_valid_hours'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = 'equipment_finance_document_delivery_policy'
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END AS missing_authorization_table
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_finance_delivery_authorizations';

SELECT COUNT(*) AS invalid_authorization_policy
FROM equipment_finance_document_delivery_policy
WHERE id = 1
  AND (
      delivery_authorization_policy_version <> 'FIN-DELIVERY-AUTH-1'
      OR independent_delivery_authorization_required <> 1
      OR delivery_authorization_valid_hours NOT BETWEEN 1 AND 168
  );

SELECT COUNT(*) AS invalid_authorization_records
FROM equipment_finance_delivery_authorizations
WHERE agreement_id IS NULL
   OR application_id IS NULL
   OR asset_id IS NULL
   OR customer_id IS NULL
   OR snapshot_checksum IS NULL
   OR CHAR_LENGTH(snapshot_checksum) <> 64
   OR document_snapshot_json IS NULL
   OR financial_snapshot_json IS NULL
   OR request_reason IS NULL
   OR (authorization_status = 'authorized' AND (decided_by IS NULL OR decided_at IS NULL OR expires_at IS NULL))
   OR (authorization_status IN ('rejected','revoked') AND decision_reason IS NULL AND revocation_reason IS NULL)
   OR (decided_by IS NOT NULL AND decided_by = requested_by);
