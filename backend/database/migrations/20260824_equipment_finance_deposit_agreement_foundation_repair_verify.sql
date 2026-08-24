-- READ-ONLY VERIFICATION

SELECT COUNT(*) AS missing_deposit_agreement_columns
FROM (
    SELECT 'equipment_sale_agreements' AS table_name, 'credit_application_id' AS column_name
    UNION ALL SELECT 'equipment_sale_agreements', 'activation_source'
    UNION ALL SELECT 'equipment_sale_agreements', 'equipment_commitment_status'
) required
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
 AND actual.COLUMN_NAME = required.column_name
WHERE actual.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS deposit_agreement_foundation_migration_record_missing
FROM (
    SELECT 1 AS expected
) marker
LEFT JOIN schema_migrations migration
  ON migration.migration_name = '20260824_equipment_finance_deposit_agreement_foundation_repair'
WHERE migration.id IS NULL;
