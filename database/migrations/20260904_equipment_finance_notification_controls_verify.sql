-- READ-ONLY VERIFICATION: equipment Finance notification controls.

SELECT
    TABLE_NAME,
    TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_finance_notification_settings';

SELECT
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'equipment_finance_notification_settings'
ORDER BY ORDINAL_POSITION;

SELECT
    id,
    equipment_created,
    customer_created,
    application_approved,
    agreement,
    deposit,
    payment,
    reminders,
    settlement_ownership,
    document_share
FROM equipment_finance_notification_settings
WHERE id = 1;

SELECT migration_name, description, applied_at
FROM schema_migrations
WHERE migration_name = '20260904_equipment_finance_notification_controls';
