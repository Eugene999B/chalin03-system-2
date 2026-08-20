-- CHALIN 03 PRODUCTION MIGRATION
-- EQUIPMENT FINANCE PHASE 5A PRIVATE DOCUMENT FOUNDATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
-- Existing Finance, Hire, Mining, Spare Parts, payment, schedule, correction,
-- agreement, document, delivery and audit records are preserved.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_document_delivery_policy (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    policy_version VARCHAR(80) NOT NULL,
    allowed_document_categories_json LONGTEXT NOT NULL,
    allowed_mime_types_json LONGTEXT NOT NULL,
    maximum_file_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 5242880,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_finance_phase5a_policy_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS equipment_finance_private_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    document_number VARCHAR(120) NOT NULL UNIQUE,
    application_id BIGINT NULL,
    agreement_id BIGINT NOT NULL,
    customer_id BIGINT NULL,
    document_category ENUM(
        'kyc_identity',
        'kyc_address',
        'kyc_income',
        'guarantor_identity',
        'guarantor_undertaking',
        'agreement_attachment',
        'other'
    ) NOT NULL,
    document_type VARCHAR(120) NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    file_size_bytes BIGINT UNSIGNED NOT NULL,
    content_checksum CHAR(64) NOT NULL,
    encrypted_payload LONGBLOB NOT NULL,
    encryption_iv VARBINARY(12) NOT NULL,
    encryption_tag VARBINARY(16) NOT NULL,
    encryption_version VARCHAR(40) NOT NULL DEFAULT 'aes-256-gcm-v1',
    document_status ENUM('active','archived') NOT NULL DEFAULT 'active',
    uploaded_by INT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME NULL,
    archived_by INT NULL,
    archive_reason VARCHAR(1000) NULL,
    INDEX idx_finance_phase5a_document_case (agreement_id, document_status, document_category),
    INDEX idx_finance_phase5a_document_application (application_id, uploaded_at),
    INDEX idx_finance_phase5a_document_customer (customer_id, uploaded_at),
    INDEX idx_finance_phase5a_document_checksum (content_checksum)
);

CREATE TABLE IF NOT EXISTS equipment_finance_case_activity (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    activity_number VARCHAR(120) NOT NULL UNIQUE,
    application_id BIGINT NULL,
    agreement_id BIGINT NULL,
    document_id BIGINT NULL,
    action_type VARCHAR(100) NOT NULL,
    actor_id INT NULL,
    actor_role VARCHAR(100) NULL,
    description VARCHAR(1500) NOT NULL,
    metadata_json LONGTEXT NULL,
    request_id VARCHAR(120) NULL,
    ip_address VARCHAR(80) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_finance_phase5a_activity_case (agreement_id, created_at),
    INDEX idx_finance_phase5a_activity_document (document_id, created_at),
    INDEX idx_finance_phase5a_activity_actor (actor_id, created_at),
    INDEX idx_finance_phase5a_activity_action (action_type, created_at)
);

INSERT INTO equipment_finance_document_delivery_policy (
    id,
    policy_version,
    allowed_document_categories_json,
    allowed_mime_types_json,
    maximum_file_size_bytes
)
VALUES (
    1,
    'FIN-PRIVATE-DOC-1',
    '["kyc_identity","kyc_address","kyc_income","guarantor_identity","guarantor_undertaking","agreement_attachment","other"]',
    '["application/pdf","image/jpeg","image/png"]',
    5242880
)
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'equipment_finance_phase5a_private_documents',
    'Encrypted private Equipment Finance document vault, strict access controls and append-only document activity.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
