-- CHALIN 03 EQUIPMENT FINANCE SMS ALERT ENUM ADDITIVE MIGRATION
-- PRODUCTION FIX: adds 'equipment_finance_payment_alert' to sms_log.sms_type ENUM
-- Date: 2026-08-29
-- Root cause: equipmentFinanceProfessionalService.js calls sendSmsAlertToPhone with
--   smsType='equipment_finance_payment_alert', but production sms_log.sms_type ENUM
--   only permitted receipt,debt_reminder,low_stock,daily_summary,sale_confirmation,
--   security_alert,other. This caused MySQL to truncate the value, producing runtime error:
--   "Data truncated for column 'sms_type' at row 1" during equipment finance boss alerts.
-- Solution: Additive ENUM modification. All existing enum values preserved.
-- No schema mutation at runtime. No data loss. No historical SMS records affected.

SET @db_name := DATABASE();

-- Verify sms_log exists
SET @sms_log_exists := EXISTS(
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'sms_log'
);

IF @sms_log_exists THEN
  -- Modify sms_type ENUM to include 'equipment_finance_payment_alert'
  -- Order: keep existing values in original order, append new value at end
  ALTER TABLE sms_log
    MODIFY COLUMN sms_type ENUM(
      'receipt',
      'debt_reminder',
      'low_stock',
      'daily_summary',
      'sale_confirmation',
      'security_alert',
      'equipment_finance_payment_alert',
      'other'
    ) NOT NULL DEFAULT 'other';

  -- Verify column definition after modification
  SELECT 
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_DEFAULT
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'sms_log'
    AND COLUMN_NAME = 'sms_type'
  AS verification_check;

END IF;

-- Record this migration in schema_migrations
INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260829_equipment_finance_sms_alert_enum',
  'Additive ENUM modification to sms_log.sms_type; adds equipment_finance_payment_alert value. Fixes equipment finance boss alert truncation bug in production.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT 'EQUIPMENT FINANCE SMS ALERT ENUM MIGRATION COMPLETE' AS result;

