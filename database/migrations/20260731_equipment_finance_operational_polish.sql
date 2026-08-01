-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE PHASE 3
-- ADDITIVE MIGRATION ONLY.
-- OPERATIONAL POLISH: PRIVATE CASE DOCUMENTS, SERVER DRAFTS, TASKS,
-- TIMELINE EVENTS, SCHEDULE SIMULATIONS, CONTROLLED AMENDMENTS AND SHARING.
-- ADDITIVE AND FORWARD-ONLY. NO EXISTING FINANCIAL RECORD IS REWRITTEN.
-- BACKUP REQUIRED BEFORE PRODUCTION EXECUTION.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_case_drafts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    draft_key VARCHAR(120) NOT NULL,
    application_id BIGINT NULL,
    customer_id BIGINT NULL,
    asset_id BIGINT NULL,
    payload_json LONGTEXT NOT NULL,
    progress_json LONGTEXT NOT NULL,
    completion_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    version_no INT NOT NULL DEFAULT 1,
    last_saved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME NULL,
    archived_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_finance_case_draft_user_key (user_id, draft_key),
    INDEX idx_finance_case_draft_active (user_id, archived_at, last_saved_at),
    INDEX idx_finance_case_draft_case (application_id, customer_id, asset_id)
);

CREATE TABLE IF NOT EXISTS equipment_finance_case_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NULL,
    agreement_id BIGINT NULL,
    customer_id BIGINT NULL,
    asset_id BIGINT NULL,
    document_category VARCHAR(80) NOT NULL,
    document_label VARCHAR(180) NOT NULL,
    original_file_name VARCHAR(255) NOT NULL,
    stored_mime_type VARCHAR(80) NOT NULL,
    byte_size BIGINT UNSIGNED NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    file_content LONGBLOB NOT NULL,
    storage_scope VARCHAR(40) NOT NULL DEFAULT 'database_private',
    document_status ENUM('uploaded','verified','rejected','superseded') NOT NULL DEFAULT 'uploaded',
    is_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
    notes VARCHAR(1000) NULL,
    uploaded_by INT NULL,
    verified_by INT NULL,
    verified_at DATETIME NULL,
    rejected_reason VARCHAR(500) NULL,
    superseded_at DATETIME NULL,
    superseded_by_document_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_finance_case_document_application (application_id, document_category, document_status),
    INDEX idx_finance_case_document_agreement (agreement_id, document_category, document_status),
    INDEX idx_finance_case_document_checksum (checksum_sha256, document_status),
    INDEX idx_finance_case_document_uploaded (uploaded_by, created_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_case_tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NULL,
    agreement_id BIGINT NULL,
    task_type VARCHAR(80) NOT NULL,
    task_status ENUM('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
    priority ENUM('low','normal','high','critical') NOT NULL DEFAULT 'normal',
    title VARCHAR(180) NOT NULL,
    description VARCHAR(1500) NULL,
    assigned_role VARCHAR(80) NULL,
    assigned_to INT NULL,
    due_at DATETIME NULL,
    approval_required BOOLEAN NOT NULL DEFAULT FALSE,
    approval_status ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required',
    approval_reason VARCHAR(1000) NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    completed_by INT NULL,
    completed_at DATETIME NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_finance_task_inbox (task_status, priority, due_at),
    INDEX idx_finance_task_application (application_id, task_status),
    INDEX idx_finance_task_agreement (agreement_id, task_status),
    INDEX idx_finance_task_assignment (assigned_to, assigned_role, task_status),
    INDEX idx_finance_task_approval (approval_required, approval_status, created_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_case_amendments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    amendment_number VARCHAR(100) NOT NULL UNIQUE,
    application_id BIGINT NULL,
    agreement_id BIGINT NULL,
    amendment_type VARCHAR(80) NOT NULL,
    risk_level ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
    reason VARCHAR(1000) NOT NULL,
    before_snapshot_json LONGTEXT NOT NULL,
    proposed_changes_json LONGTEXT NOT NULL,
    amendment_status ENUM('draft','pending_approval','approved','rejected','applied','cancelled') NOT NULL DEFAULT 'pending_approval',
    apply_mode ENUM('pending','direct_safe_update','numbered_variation','not_applied') NOT NULL DEFAULT 'pending',
    decision_reason VARCHAR(1000) NULL,
    applied_result_json LONGTEXT NULL,
    effective_date DATE NULL,
    requested_by INT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    applied_by INT NULL,
    applied_at DATETIME NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_finance_amendment_application (application_id, amendment_status, requested_at),
    INDEX idx_finance_amendment_agreement (agreement_id, amendment_status, requested_at),
    INDEX idx_finance_amendment_approval (amendment_status, risk_level, requested_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_schedule_simulations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NULL,
    agreement_id BIGINT NULL,
    simulation_name VARCHAR(180) NOT NULL,
    input_json LONGTEXT NOT NULL,
    result_json LONGTEXT NOT NULL,
    result_checksum CHAR(64) NOT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME NULL,

    INDEX idx_finance_simulation_application (application_id, created_at),
    INDEX idx_finance_simulation_agreement (agreement_id, created_at),
    INDEX idx_finance_simulation_creator (created_by, created_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_document_shares (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    source_type ENUM('issued_document','payment_receipt','case_document','amendment') NOT NULL,
    source_id BIGINT NOT NULL,
    issued_document_id BIGINT NULL,
    application_id BIGINT NULL,
    agreement_id BIGINT NULL,
    payment_id BIGINT NULL,
    channel ENUM('sms','whatsapp','email','copy','download','print') NOT NULL,
    recipient VARCHAR(255) NULL,
    share_status ENUM('prepared','queued','sent','delivered','failed','cancelled') NOT NULL DEFAULT 'prepared',
    share_message VARCHAR(1000) NULL,
    provider_reference VARCHAR(255) NULL,
    error_message VARCHAR(1000) NULL,
    requested_by INT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME NULL,
    delivered_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_finance_share_source (source_type, source_id, requested_at),
    INDEX idx_finance_share_payment (payment_id, requested_at),
    INDEX idx_finance_share_document (issued_document_id, requested_at),
    INDEX idx_finance_share_status (share_status, channel, requested_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_case_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NULL,
    agreement_id BIGINT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_title VARCHAR(180) NOT NULL,
    event_description VARCHAR(1500) NULL,
    event_status VARCHAR(60) NULL,
    event_metadata_json LONGTEXT NULL,
    source_type VARCHAR(80) NULL,
    source_id BIGINT NULL,
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_finance_event_application (application_id, occurred_at),
    INDEX idx_finance_event_agreement (agreement_id, occurred_at),
    INDEX idx_finance_event_type (event_type, occurred_at),
    INDEX idx_finance_event_source (source_type, source_id)
);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260731_equipment_finance_operational_polish',
    'Phase 3 private case documents, server drafts, task inbox, case timeline, schedule simulations, governed amendments and sharing evidence.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
