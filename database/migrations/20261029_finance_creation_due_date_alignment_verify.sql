-- READ-ONLY VERIFICATION. Execute only SELECT queries; no business records changed.
SELECT CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS due_date_column_present
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_credit_applications'
  AND COLUMN_NAME = 'proposed_first_due_date'
  AND DATA_TYPE = 'date'
  AND IS_NULLABLE = 'YES';

SELECT CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS migration_recorded
FROM schema_migrations
WHERE migration_name = '20261029_finance_creation_due_date_alignment';
