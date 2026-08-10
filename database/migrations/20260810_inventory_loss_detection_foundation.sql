-- CHALIN 03 INVENTORY LOSS DETECTION — BLIND COUNTS, INVESTIGATIONS & CUSTODY
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Before any future production use, create and verify both a current Professional Backup and a separate SQL/database backup.
-- Depends on 20260810_inventory_traceability_foundation.sql.

CREATE TABLE IF NOT EXISTS inventory_count_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(48) NOT NULL,
    branch_id INT NOT NULL,
    count_type VARCHAR(30) NOT NULL DEFAULT 'blind_cycle',
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    blind_mode TINYINT(1) NOT NULL DEFAULT 1,
    selection_method VARCHAR(30) NOT NULL DEFAULT 'manual',
    reason VARCHAR(500) NULL,
    area_label VARCHAR(120) NULL,
    created_by INT NULL,
    started_by INT NULL,
    submitted_by INT NULL,
    reviewed_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    submitted_at DATETIME NULL,
    reviewed_at DATETIME NULL,
    closed_at DATETIME NULL,
    notes TEXT NULL,

    UNIQUE KEY uq_inventory_count_session_code (session_code),
    INDEX idx_inventory_count_session_branch_status (branch_id, status, created_at),
    INDEX idx_inventory_count_session_type (branch_id, count_type, created_at),

    CONSTRAINT fk_inventory_count_session_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_session_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_count_session_started_by
        FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_count_session_submitted_by
        FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_count_session_reviewed_by
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_count_scope (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT NOT NULL,
    product_id INT NOT NULL,
    expected_system_quantity INT NOT NULL,
    expected_identity_count INT NOT NULL DEFAULT 0,
    tracking_mode_snapshot VARCHAR(20) NOT NULL,
    risk_tier_snapshot VARCHAR(20) NOT NULL DEFAULT 'standard',
    expected_snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sequence_number INT NOT NULL DEFAULT 1,

    UNIQUE KEY uq_inventory_count_scope_product (session_id, product_id),
    INDEX idx_inventory_count_scope_product (product_id, session_id),

    CONSTRAINT fk_inventory_count_scope_session
        FOREIGN KEY (session_id) REFERENCES inventory_count_sessions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_scope_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inventory_count_observations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT NOT NULL,
    scope_id BIGINT NOT NULL,
    product_id INT NOT NULL,
    unit_id BIGINT NULL,
    unit_code_snapshot VARCHAR(40) NULL,
    observation_type VARCHAR(30) NOT NULL DEFAULT 'unit_scan',
    quantity_observed INT NOT NULL DEFAULT 1,
    validation_status VARCHAR(30) NOT NULL DEFAULT 'accepted',
    observed_by INT NULL,
    observed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    device_note VARCHAR(200) NULL,
    metadata_json JSON NULL,

    INDEX idx_inventory_count_observation_session (session_id, observed_at),
    INDEX idx_inventory_count_observation_scope (scope_id, observed_at),
    INDEX idx_inventory_count_observation_unit (unit_id, observed_at),
    INDEX idx_inventory_count_observation_code (unit_code_snapshot),

    CONSTRAINT fk_inventory_count_observation_session
        FOREIGN KEY (session_id) REFERENCES inventory_count_sessions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_observation_scope
        FOREIGN KEY (scope_id) REFERENCES inventory_count_scope(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_observation_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_observation_unit
        FOREIGN KEY (unit_id) REFERENCES inventory_units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_observation_user
        FOREIGN KEY (observed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_count_variances (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT NOT NULL,
    scope_id BIGINT NOT NULL,
    branch_id INT NOT NULL,
    product_id INT NOT NULL,
    expected_quantity INT NOT NULL,
    observed_quantity INT NOT NULL,
    variance_quantity INT NOT NULL,
    expected_identity_count INT NOT NULL DEFAULT 0,
    observed_identity_count INT NOT NULL DEFAULT 0,
    missing_identity_count INT NOT NULL DEFAULT 0,
    unexpected_identity_count INT NOT NULL DEFAULT 0,
    review_status VARCHAR(24) NOT NULL DEFAULT 'open',
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    resolution_notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_inventory_count_variance_scope (scope_id),
    INDEX idx_inventory_count_variance_branch (branch_id, review_status, created_at),
    INDEX idx_inventory_count_variance_product (product_id, created_at),

    CONSTRAINT fk_inventory_count_variance_session
        FOREIGN KEY (session_id) REFERENCES inventory_count_sessions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_variance_scope
        FOREIGN KEY (scope_id) REFERENCES inventory_count_scope(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_variance_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_variance_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_variance_reviewer
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_count_variance_units (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    variance_id BIGINT NOT NULL,
    unit_id BIGINT NULL,
    unit_code_snapshot VARCHAR(40) NULL,
    variance_type VARCHAR(30) NOT NULL,
    last_known_status VARCHAR(30) NULL,
    last_known_branch_id INT NULL,
    last_known_event_id BIGINT NULL,
    resolution_status VARCHAR(24) NOT NULL DEFAULT 'unresolved',
    resolution_note VARCHAR(1000) NULL,
    resolved_by INT NULL,
    resolved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_inventory_variance_unit_variance (variance_id, variance_type),
    INDEX idx_inventory_variance_unit_code (unit_code_snapshot),
    INDEX idx_inventory_variance_unit_status (resolution_status, created_at),

    CONSTRAINT fk_inventory_variance_unit_variance
        FOREIGN KEY (variance_id) REFERENCES inventory_count_variances(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_variance_unit_unit
        FOREIGN KEY (unit_id) REFERENCES inventory_units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_variance_unit_branch
        FOREIGN KEY (last_known_branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_variance_unit_event
        FOREIGN KEY (last_known_event_id) REFERENCES inventory_unit_events(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_variance_unit_resolver
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_loss_investigations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    investigation_code VARCHAR(48) NOT NULL,
    branch_id INT NOT NULL,
    product_id INT NOT NULL,
    unit_id BIGINT NULL,
    count_session_id BIGINT NULL,
    variance_id BIGINT NULL,
    variance_unit_id BIGINT NULL,
    investigation_type VARCHAR(40) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'review',
    status VARCHAR(24) NOT NULL DEFAULT 'open',
    discovered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_known_event_id BIGINT NULL,
    last_known_at DATETIME NULL,
    assigned_to INT NULL,
    opened_by INT NULL,
    resolution_category VARCHAR(40) NULL,
    resolution_notes TEXT NULL,
    resolved_by INT NULL,
    resolved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_inventory_loss_investigation_code (investigation_code),
    INDEX idx_inventory_loss_investigation_branch (branch_id, status, severity, created_at),
    INDEX idx_inventory_loss_investigation_product (product_id, status, created_at),
    INDEX idx_inventory_loss_investigation_unit (unit_id, status, created_at),

    CONSTRAINT fk_inventory_loss_investigation_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_loss_investigation_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_loss_investigation_unit
        FOREIGN KEY (unit_id) REFERENCES inventory_units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_loss_investigation_session
        FOREIGN KEY (count_session_id) REFERENCES inventory_count_sessions(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_loss_investigation_variance
        FOREIGN KEY (variance_id) REFERENCES inventory_count_variances(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_loss_investigation_variance_unit
        FOREIGN KEY (variance_unit_id) REFERENCES inventory_count_variance_units(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_loss_investigation_last_event
        FOREIGN KEY (last_known_event_id) REFERENCES inventory_unit_events(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_loss_investigation_assignee
        FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_loss_investigation_opener
        FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_loss_investigation_resolver
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_custody_handovers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    handover_code VARCHAR(48) NOT NULL,
    branch_id INT NOT NULL,
    area_label VARCHAR(120) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    outgoing_user_id INT NULL,
    incoming_user_id INT NULL,
    expected_unit_count INT NOT NULL DEFAULT 0,
    verified_unit_count INT NOT NULL DEFAULT 0,
    variance_unit_count INT NOT NULL DEFAULT 0,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    outgoing_confirmed_at DATETIME NULL,
    incoming_confirmed_at DATETIME NULL,
    closed_at DATETIME NULL,
    notes TEXT NULL,

    UNIQUE KEY uq_inventory_custody_handover_code (handover_code),
    INDEX idx_inventory_custody_handover_branch (branch_id, status, created_at),
    INDEX idx_inventory_custody_handover_users (outgoing_user_id, incoming_user_id, created_at),

    CONSTRAINT fk_inventory_custody_handover_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_custody_handover_outgoing
        FOREIGN KEY (outgoing_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_custody_handover_incoming
        FOREIGN KEY (incoming_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_custody_handover_creator
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_custody_handover_units (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    handover_id BIGINT NOT NULL,
    unit_id BIGINT NOT NULL,
    unit_code_snapshot VARCHAR(40) NOT NULL,
    expected_status VARCHAR(30) NOT NULL,
    verification_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    verified_by INT NULL,
    verified_at DATETIME NULL,
    note VARCHAR(500) NULL,

    UNIQUE KEY uq_inventory_handover_unit (handover_id, unit_id),
    INDEX idx_inventory_handover_unit_code (unit_code_snapshot),
    INDEX idx_inventory_handover_unit_status (handover_id, verification_status),

    CONSTRAINT fk_inventory_handover_unit_handover
        FOREIGN KEY (handover_id) REFERENCES inventory_custody_handovers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_handover_unit_unit
        FOREIGN KEY (unit_id) REFERENCES inventory_units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_handover_unit_verifier
        FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260810_inventory_loss_detection_foundation',
    'Adds blind inventory count sessions, exact serialized variance evidence, loss investigations and high-risk custody handovers.'
WHERE NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE migration_name = '20260810_inventory_loss_detection_foundation'
);
