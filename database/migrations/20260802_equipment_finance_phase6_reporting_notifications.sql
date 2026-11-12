-- CHALIN 03 PRODUCTION MIGRATION
-- EQUIPMENT FINANCE PHASE 6 REPORTING, SMS AND ACCOUNTING POLISH
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
-- Existing Finance applications, agreements, schedules, payments, documents,
-- authorizations, deliveries, returns, corrections and Hire records are preserved.

CREATE TABLE IF NOT EXISTS equipment_finance_phase6_runtime_state (
    state_key VARCHAR(120) NOT NULL PRIMARY KEY,
    state_value VARCHAR(500) NOT NULL,
    description VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO equipment_finance_phase6_runtime_state (
    state_key,
    state_value,
    description
)
VALUES (
    'customer_receipt_cutover_at',
    DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s'),
    'Only committed Equipment Finance payments at or after this production cutover are eligible for automatic customer receipt SMS.'
)
ON DUPLICATE KEY UPDATE state_key = VALUES(state_key);

CREATE TABLE IF NOT EXISTS equipment_finance_phase6_message_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    message_key VARCHAR(191) NOT NULL UNIQUE,
    message_type VARCHAR(80) NOT NULL,
    payment_id BIGINT NULL,
    agreement_id BIGINT NOT NULL,
    recipient_type VARCHAR(40) NOT NULL,
    recipient_phone VARCHAR(40) NULL,
    message_preview VARCHAR(480) NOT NULL,
    delivery_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    sms_log_id BIGINT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    last_error VARCHAR(1000) NULL,
    sent_by INT NULL,
    claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME NULL,
    delivered_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_finance_phase6_message_agreement (agreement_id, created_at),
    INDEX idx_finance_phase6_message_payment (payment_id, message_type),
    INDEX idx_finance_phase6_message_status (delivery_status, created_at),
    INDEX idx_finance_phase6_message_sms_log (sms_log_id)
);

CREATE TABLE IF NOT EXISTS equipment_finance_phase6_export_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    export_type VARCHAR(30) NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    row_count INT NOT NULL DEFAULT 0,
    file_checksum CHAR(64) NOT NULL,
    generated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_finance_phase6_export_period (date_from, date_to, export_type),
    INDEX idx_finance_phase6_export_actor (generated_by, created_at),
    INDEX idx_finance_phase6_export_checksum (file_checksum)
);

INSERT INTO equipment_finance_settings_history (
    settings_id,
    old_snapshot_json,
    new_snapshot_json,
    change_reason,
    changed_by
)
SELECT
    id,
    JSON_OBJECT(
        'boss_payment_alert_enabled', boss_payment_alert_enabled,
        'customer_payment_receipt_sms_enabled', customer_payment_receipt_sms_enabled,
        'automatic_reminders_enabled', automatic_reminders_enabled
    ),
    JSON_OBJECT(
        'boss_payment_alert_enabled', TRUE,
        'customer_payment_receipt_sms_enabled', TRUE,
        'automatic_reminders_enabled', TRUE,
        'phase6_customer_receipt_cutover_protected', TRUE
    ),
    'Equipment Finance Phase 6 production activation: boss alerts, post-cutover customer payment receipts, upcoming-payment reminders and overdue reminders.',
    NULL
FROM equipment_finance_settings
WHERE id = 1
  AND (
    boss_payment_alert_enabled = FALSE OR
    customer_payment_receipt_sms_enabled = FALSE OR
    automatic_reminders_enabled = FALSE
  );

UPDATE equipment_finance_settings
   SET boss_payment_alert_enabled = TRUE,
       customer_payment_receipt_sms_enabled = TRUE,
       automatic_reminders_enabled = TRUE
 WHERE id = 1;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'equipment_finance_phase6_reporting_notifications',
    'Customer payment receipt SMS evidence, safe production cutover, portfolio and arrears reporting support, cash-flow reporting, accounting export audit and thermal installment receipts.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
