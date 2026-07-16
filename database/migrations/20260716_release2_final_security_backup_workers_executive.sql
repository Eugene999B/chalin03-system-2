-- CHALIN 03 RELEASE 2 FINAL
-- Release 2B: Owner Break-Glass and Security Centre
-- Release 2C: Professional Backup Centre
-- Release 2D: Worker Profile Foundation
-- Release 2E: Group Executive Security, Backup and Workforce Oversight
--
-- ADDITIVE MIGRATION ONLY.
-- No business records are deleted, reset or rewritten.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS protected_action_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    purpose VARCHAR(120) NOT NULL DEFAULT 'privileged_action',
    ip_address VARCHAR(50) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    last_used_at DATETIME NULL,

    CONSTRAINT fk_protected_action_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_protected_action_user_active (
        user_id,
        revoked_at,
        expires_at
    ),
    INDEX idx_protected_action_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS owner_break_glass_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    last_login_at DATETIME NULL,
    last_login_ip VARCHAR(50) NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    rotated_at DATETIME NULL,

    CONSTRAINT fk_owner_break_glass_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_owner_break_glass_active (is_active),
    INDEX idx_owner_break_glass_locked (locked_until)
);

CREATE TABLE IF NOT EXISTS owner_recovery_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_account_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    ip_address VARCHAR(50) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    revoked_at DATETIME NULL,

    CONSTRAINT fk_owner_recovery_account
        FOREIGN KEY (owner_account_id)
        REFERENCES owner_break_glass_accounts(id)
        ON DELETE CASCADE,

    INDEX idx_owner_recovery_active (
        owner_account_id,
        used_at,
        revoked_at,
        expires_at
    )
);

CREATE TABLE IF NOT EXISTS privileged_action_ledger (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_user_id INT NULL,
    target_user_id INT NULL,
    actor_type VARCHAR(40) NOT NULL DEFAULT 'user',
    action_code VARCHAR(150) NOT NULL,
    outcome VARCHAR(40) NOT NULL DEFAULT 'success',
    severity VARCHAR(40) NOT NULL DEFAULT 'critical',
    entity_type VARCHAR(80) NULL,
    entity_id VARCHAR(100) NULL,
    request_id VARCHAR(100) NULL,
    ip_address VARCHAR(50) NULL,
    user_agent VARCHAR(500) NULL,
    payload_json LONGTEXT NULL,
    hash_payload LONGTEXT NOT NULL,
    previous_event_hash CHAR(64) NULL,
    event_hash CHAR(64) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL,

    CONSTRAINT fk_privileged_ledger_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_privileged_ledger_target
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_privileged_ledger_action (action_code),
    INDEX idx_privileged_ledger_actor (actor_user_id),
    INDEX idx_privileged_ledger_target (target_user_id),
    INDEX idx_privileged_ledger_severity (severity),
    INDEX idx_privileged_ledger_created (created_at)
);

CREATE TABLE IF NOT EXISTS backup_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    backup_id CHAR(36) NOT NULL UNIQUE,
    scope_code VARCHAR(50) NOT NULL,
    category_code VARCHAR(50) NOT NULL DEFAULT 'all',
    date_from DATE NULL,
    date_to DATE NULL,
    manifest_version VARCHAR(80) NOT NULL,
    schema_version VARCHAR(150) NULL,
    included_table_count INT NOT NULL DEFAULT 0,
    total_record_count BIGINT NOT NULL DEFAULT 0,
    package_checksum_sha256 CHAR(64) NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'created',
    verification_status VARCHAR(40) NOT NULL DEFAULT 'not_verified',
    verification_message TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_by INT NULL,
    verified_at DATETIME NULL,

    CONSTRAINT fk_backup_history_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_backup_history_verified_by
        FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_backup_history_scope (scope_code),
    INDEX idx_backup_history_status (status),
    INDEX idx_backup_history_verification (verification_status),
    INDEX idx_backup_history_created (created_at)
);

CREATE TABLE IF NOT EXISTS worker_profiles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    employee_number VARCHAR(80) NOT NULL UNIQUE,
    user_id INT NULL UNIQUE,
    full_name VARCHAR(180) NOT NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(180) NULL,
    emergency_contact_name VARCHAR(180) NULL,
    emergency_contact_phone VARCHAR(30) NULL,
    job_title VARCHAR(150) NULL,
    department VARCHAR(150) NULL,
    employment_type VARCHAR(60) NOT NULL DEFAULT 'permanent',
    employment_start_date DATE NULL,
    employment_end_date DATE NULL,
    employment_status VARCHAR(40) NOT NULL DEFAULT 'active',
    supervisor_worker_id BIGINT NULL,
    photo_storage_key VARCHAR(500) NULL,
    photo_checksum_sha256 CHAR(64) NULL,
    notes TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_profile_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_profile_supervisor
        FOREIGN KEY (supervisor_worker_id)
        REFERENCES worker_profiles(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_worker_profile_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_profile_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_worker_profile_name (full_name),
    INDEX idx_worker_profile_status (employment_status),
    INDEX idx_worker_profile_department (department),
    INDEX idx_worker_profile_supervisor (supervisor_worker_id)
);

CREATE TABLE IF NOT EXISTS worker_assignments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    workspace_code VARCHAR(50) NOT NULL,
    business_unit_id INT NULL,
    branch_id INT NULL,
    context_type VARCHAR(50) NULL,
    context_id BIGINT NULL,
    context_label VARCHAR(180) NULL,
    role_code VARCHAR(80) NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    assignment_start DATE NULL,
    assignment_end DATE NULL,
    notes TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_assignment_worker
        FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_worker_assignment_unit
        FOREIGN KEY (business_unit_id)
        REFERENCES business_units(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_worker_assignment_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    CONSTRAINT fk_worker_assignment_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_worker_assignment_worker_active (worker_id, is_active),
    INDEX idx_worker_assignment_workspace (workspace_code),
    INDEX idx_worker_assignment_context (context_type, context_id)
);

CREATE TABLE IF NOT EXISTS worker_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    document_type VARCHAR(100) NOT NULL,
    title VARCHAR(180) NOT NULL,
    document_number VARCHAR(120) NULL,
    private_storage_key VARCHAR(500) NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    issued_date DATE NULL,
    expiry_date DATE NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'valid',
    notes TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_document_worker
        FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_worker_document_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_worker_document_worker (worker_id),
    INDEX idx_worker_document_expiry (expiry_date),
    INDEX idx_worker_document_status (status)
);

CREATE TABLE IF NOT EXISTS worker_licenses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    license_type VARCHAR(120) NOT NULL,
    license_number VARCHAR(150) NULL,
    issuing_authority VARCHAR(180) NULL,
    issued_date DATE NULL,
    expiry_date DATE NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'valid',
    private_storage_key VARCHAR(500) NULL,
    checksum_sha256 CHAR(64) NULL,
    notes TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_license_worker
        FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_worker_license_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_worker_license_worker (worker_id),
    INDEX idx_worker_license_expiry (expiry_date),
    INDEX idx_worker_license_status (status)
);

CREATE TABLE IF NOT EXISTS worker_property_assignments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    property_type VARCHAR(120) NOT NULL,
    property_code VARCHAR(120) NULL,
    description VARCHAR(255) NOT NULL,
    issued_at DATE NULL,
    expected_return_date DATE NULL,
    returned_at DATE NULL,
    condition_issued VARCHAR(120) NULL,
    condition_returned VARCHAR(120) NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'issued',
    notes TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_property_worker
        FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_worker_property_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_worker_property_worker (worker_id),
    INDEX idx_worker_property_status (status),
    INDEX idx_worker_property_return (expected_return_date)
);

CREATE TABLE IF NOT EXISTS worker_status_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    previous_status VARCHAR(40) NULL,
    new_status VARCHAR(40) NOT NULL,
    reason TEXT NOT NULL,
    changed_by INT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_worker_status_worker
        FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_worker_status_changed_by
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_worker_status_worker (worker_id),
    INDEX idx_worker_status_changed (changed_at)
);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release2_final_security_backup_workers_executive',
    'Adds Owner Break-Glass, protected actions, tamper-evident privileged ledger, professional backup history, worker profiles and executive security/workforce oversight.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);