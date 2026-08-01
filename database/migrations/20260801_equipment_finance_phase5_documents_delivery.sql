-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- PHASE 5: PRIVATE DOCUMENTS, INDEPENDENT APPROVALS AND DELIVERY CONTROL
-- ADDITIVE, FORWARD-ONLY MIGRATION.
-- No existing Finance, Hire, Mining, Spare Parts, payment, schedule or audit row is deleted or rewritten.

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
    required_document_categories_json LONGTEXT NOT NULL,
    allowed_mime_types_json LONGTEXT NOT NULL,
    maximum_file_size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 5242880,
    independent_document_review_required BOOLEAN NOT NULL DEFAULT TRUE,
    separate_document_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
    independent_delivery_authorization_required BOOLEAN NOT NULL DEFAULT TRUE,
    independent_delivery_confirmation_required BOOLEAN NOT NULL DEFAULT TRUE,
    delivery_authorization_valid_hours SMALLINT UNSIGNED NOT NULL DEFAULT 48,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_finance_phase5_policy_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS equipment_finance_document_delivery_policy_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    policy_version VARCHAR(80) NOT NULL,
    previous_snapshot_json LONGTEXT NULL,
    new_snapshot_json LONGTEXT NOT NULL,
    change_reason VARCHAR(1000) NOT NULL,
    changed_by INT NULL,
    request_id VARCHAR(120) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_finance_phase5_policy_history (created_at, changed_by)
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
        'delivery_evidence',
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
    review_status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    review_notes VARCHAR(1500) NULL,
    approval_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    approved_by INT NULL,
    approved_at DATETIME NULL,
    approval_notes VARCHAR(1500) NULL,
    uploaded_by INT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME NULL,
    archived_by INT NULL,
    archive_reason VARCHAR(1000) NULL,
    INDEX idx_finance_phase5_document_case (agreement_id, archived_at, document_category),
    INDEX idx_finance_phase5_document_review (review_status, approval_status, uploaded_at),
    INDEX idx_finance_phase5_document_application (application_id, uploaded_at),
    INDEX idx_finance_phase5_document_customer (customer_id, uploaded_at),
    INDEX idx_finance_phase5_document_checksum (content_checksum)
);

CREATE TABLE IF NOT EXISTS equipment_finance_delivery_authorizations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    authorization_number VARCHAR(120) NOT NULL UNIQUE,
    agreement_id BIGINT NOT NULL,
    application_id BIGINT NULL,
    asset_id BIGINT NOT NULL,
    customer_id BIGINT NULL,
    authorization_status ENUM(
        'pending',
        'authorized',
        'rejected',
        'consumed',
        'expired',
        'cancelled'
    ) NOT NULL DEFAULT 'pending',
    policy_version VARCHAR(80) NOT NULL,
    document_snapshot_json LONGTEXT NOT NULL,
    financial_snapshot_json LONGTEXT NOT NULL,
    request_reason VARCHAR(1500) NOT NULL,
    requested_by INT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    authorized_by INT NULL,
    authorized_at DATETIME NULL,
    authorization_reason VARCHAR(1500) NULL,
    expires_at DATETIME NULL,
    consumed_by INT NULL,
    consumed_at DATETIME NULL,
    delivery_id BIGINT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_finance_phase5_authorization_case (agreement_id, authorization_status, requested_at),
    INDEX idx_finance_phase5_authorization_expiry (authorization_status, expires_at),
    INDEX idx_finance_phase5_authorization_actor (requested_by, authorized_by, consumed_by)
);

CREATE TABLE IF NOT EXISTS equipment_finance_delivery_confirmations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    confirmation_number VARCHAR(120) NOT NULL UNIQUE,
    authorization_id BIGINT NOT NULL UNIQUE,
    delivery_id BIGINT NOT NULL UNIQUE,
    agreement_id BIGINT NOT NULL,
    application_id BIGINT NULL,
    asset_id BIGINT NOT NULL,
    customer_id BIGINT NULL,
    receiving_person VARCHAR(180) NOT NULL,
    receiving_phone VARCHAR(40) NULL,
    destination VARCHAR(255) NULL,
    condition_status VARCHAR(40) NOT NULL,
    meter_reading DECIMAL(14,2) NOT NULL,
    fuel_level_percent DECIMAL(7,2) NULL,
    customer_signature_document_id BIGINT NULL,
    delivery_note_document_id BIGINT NULL,
    confirmation_snapshot_json LONGTEXT NOT NULL,
    notes VARCHAR(3000) NULL,
    confirmed_by INT NULL,
    confirmed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_finance_phase5_confirmation_case (agreement_id, confirmed_at),
    INDEX idx_finance_phase5_confirmation_actor (confirmed_by, confirmed_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_case_activity (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    activity_number VARCHAR(120) NOT NULL UNIQUE,
    application_id BIGINT NULL,
    agreement_id BIGINT NULL,
    document_id BIGINT NULL,
    authorization_id BIGINT NULL,
    delivery_id BIGINT NULL,
    action_type VARCHAR(100) NOT NULL,
    actor_id INT NULL,
    actor_role VARCHAR(100) NULL,
    description VARCHAR(1500) NOT NULL,
    metadata_json LONGTEXT NULL,
    request_id VARCHAR(120) NULL,
    ip_address VARCHAR(80) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_finance_phase5_activity_case (agreement_id, created_at),
    INDEX idx_finance_phase5_activity_document (document_id, created_at),
    INDEX idx_finance_phase5_activity_authorization (authorization_id, created_at),
    INDEX idx_finance_phase5_activity_actor (actor_id, created_at),
    INDEX idx_finance_phase5_activity_action (action_type, created_at)
);

INSERT INTO equipment_finance_document_delivery_policy (
    id,
    policy_version,
    required_document_categories_json,
    allowed_mime_types_json,
    maximum_file_size_bytes,
    independent_document_review_required,
    separate_document_approval_required,
    independent_delivery_authorization_required,
    independent_delivery_confirmation_required,
    delivery_authorization_valid_hours
)
VALUES (
    1,
    'FIN-DOC-DELIVERY-1',
    '["kyc_identity","guarantor_identity","agreement_attachment"]',
    '["application/pdf","image/jpeg","image/png"]',
    5242880,
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    48
)
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'equipment_finance_phase5_documents_delivery',
    'Encrypted private Finance document vault, independent review and approval, controlled delivery authorization, delivery confirmation and append-only case activity.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
