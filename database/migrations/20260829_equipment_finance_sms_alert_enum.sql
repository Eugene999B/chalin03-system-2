-- CHALIN 03 EQUIPMENT FINANCE SMS ALERT ENUM ADDITIVE MIGRATION
-- Production fix for Equipment Installment Finance boss alerts.
-- Additive only: preserves all existing sms_type values and SMS history.

ALTER TABLE sms_log
  MODIFY COLUMN sms_type ENUM(
    'receipt',
    'debt_reminder',
    'low_stock',
    'daily_summary',
    'sale_confirmation',
    'security_alert',
    'equipment_finance_payment_alert',
    'equipment_finance_boss_alert',
    'other'
  ) NOT NULL DEFAULT 'other';

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260829_equipment_finance_sms_alert_enum',
  'Adds Equipment Finance payment and generic boss alert SMS types for controlled boss notifications.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'sms_log'
  AND COLUMN_NAME = 'sms_type'
  AND COLUMN_TYPE LIKE '%equipment_finance_boss_alert%';
