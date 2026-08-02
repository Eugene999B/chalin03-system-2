SELECT migration_name
  FROM schema_migrations
 WHERE migration_name = 'equipment_finance_phase6_reporting_notifications';

SELECT COUNT(*) AS missing_phase6_tables
  FROM (
    SELECT 'equipment_finance_phase6_runtime_state' AS table_name
    UNION ALL SELECT 'equipment_finance_phase6_message_log'
    UNION ALL SELECT 'equipment_finance_phase6_export_log'
  ) required
  LEFT JOIN information_schema.TABLES actual
    ON actual.TABLE_SCHEMA = DATABASE()
   AND actual.TABLE_NAME = required.table_name
 WHERE actual.TABLE_NAME IS NULL;

SELECT COUNT(*) AS missing_phase6_message_columns
  FROM (
    SELECT 'message_key' AS column_name
    UNION ALL SELECT 'message_type'
    UNION ALL SELECT 'payment_id'
    UNION ALL SELECT 'agreement_id'
    UNION ALL SELECT 'recipient_type'
    UNION ALL SELECT 'recipient_phone'
    UNION ALL SELECT 'message_preview'
    UNION ALL SELECT 'delivery_status'
    UNION ALL SELECT 'sms_log_id'
    UNION ALL SELECT 'attempt_count'
    UNION ALL SELECT 'last_error'
    UNION ALL SELECT 'sent_by'
    UNION ALL SELECT 'sent_at'
    UNION ALL SELECT 'delivered_at'
  ) required
  LEFT JOIN information_schema.COLUMNS actual
    ON actual.TABLE_SCHEMA = DATABASE()
   AND actual.TABLE_NAME = 'equipment_finance_phase6_message_log'
   AND actual.COLUMN_NAME = required.column_name
 WHERE actual.COLUMN_NAME IS NULL;

SELECT
    (SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END
       FROM equipment_finance_phase6_runtime_state
      WHERE state_key = 'customer_receipt_cutover_at') AS missing_cutover_state,
    (SELECT CASE WHEN COUNT(*) = 1 THEN 0 ELSE 1 END
       FROM equipment_finance_settings
      WHERE id = 1
        AND boss_payment_alert_enabled = TRUE
        AND customer_payment_receipt_sms_enabled = TRUE
        AND automatic_reminders_enabled = TRUE) AS invalid_phase6_sms_settings;

SELECT COUNT(*) AS invalid_automatic_receipt_history
  FROM equipment_finance_phase6_message_log message
  INNER JOIN equipment_finance_phase6_runtime_state state
    ON state.state_key = 'customer_receipt_cutover_at'
  INNER JOIN equipment_sale_payments payment ON payment.id = message.payment_id
 WHERE message.message_type = 'customer_payment_receipt'
   AND message.sent_by IS NULL
   AND payment.payment_date < CAST(state.state_value AS DATETIME);
