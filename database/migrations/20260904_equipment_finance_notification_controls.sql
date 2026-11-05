CREATE TABLE IF NOT EXISTS equipment_finance_notification_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    equipment_created TINYINT(1) NOT NULL DEFAULT 1,
    customer_created TINYINT(1) NOT NULL DEFAULT 1,
    application_approved TINYINT(1) NOT NULL DEFAULT 1,
    agreement TINYINT(1) NOT NULL DEFAULT 1,
    deposit TINYINT(1) NOT NULL DEFAULT 1,
    payment TINYINT(1) NOT NULL DEFAULT 1,
    reminders TINYINT(1) NOT NULL DEFAULT 1,
    settlement_ownership TINYINT(1) NOT NULL DEFAULT 1,
    document_share TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_equipment_finance_notification_singleton CHECK (id = 1)
);

INSERT INTO equipment_finance_notification_settings (id)
VALUES (1)
ON DUPLICATE KEY UPDATE id = id;
