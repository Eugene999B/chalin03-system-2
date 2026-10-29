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

SELECT CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS trigger_present
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND EVENT_OBJECT_TABLE = 'equipment_credit_applications'
  AND TRIGGER_NAME = 'chalin03_finance_start_due_date_fill'
  AND ACTION_TIMING = 'BEFORE'
  AND EVENT_MANIPULATION = 'INSERT';
