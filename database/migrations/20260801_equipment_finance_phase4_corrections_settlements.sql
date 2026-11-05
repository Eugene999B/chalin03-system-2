-- CHALIN 03 PRODUCTION MIGRATION
-- EQUIPMENT FINANCE PHASE 4 CORRECTIONS, RETURNS AND SETTLEMENTS
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
-- Existing agreements, schedules, payments, delivery, ownership, Hire, Mining
-- and Spare Parts records are preserved. Corrections are append-only records.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS equipment_finance_correction_policies (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    policy_version VARCHAR(60) NOT NULL DEFAULT 'FIN-CORR-1',
    return_credit_method VARCHAR(60) NOT NULL DEFAULT 'approved_amount',
    default_return_credit_percent DECIMAL(7,4) NOT NULL DEFAULT 70.0000,
    refundable_amount_method VARCHAR(60) NOT NULL DEFAULT 'approved_amount',
    maximum_penalty_percent DECIMAL(7,4) NOT NULL DEFAULT 10.0000,
    maximum_damage_charge_percent DECIMAL(7,4) NOT NULL DEFAULT 25.0000,
    allow_customer_refund_due BOOLEAN NOT NULL DEFAULT TRUE,
    require_independent_approval BOOLEAN NOT NULL DEFAULT TRUE,
    require_return_evidence BOOLEAN NOT NULL DEFAULT TRUE,
    require_payment_reversal_evidence BOOLEAN NOT NULL DEFAULT TRUE,
    return_terms TEXT NOT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_equipment_finance_correction_policy_singleton CHECK (id = 1),
    CONSTRAINT fk_equipment_finance_correction_policy_user
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_finance_correction_policy_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    policy_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
    old_snapshot_json LONGTEXT NULL,
    new_snapshot_json LONGTEXT NOT NULL,
    change_reason VARCHAR(1000) NOT NULL,
    changed_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_finance_correction_policy_history_created (created_at, changed_by),
    CONSTRAINT fk_finance_correction_policy_history_policy
        FOREIGN KEY (policy_id) REFERENCES equipment_finance_correction_policies(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_correction_policy_history_user
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_finance_correction_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    request_number VARCHAR(100) NOT NULL UNIQUE,
    agreement_id BIGINT NOT NULL,
    payment_id BIGINT NULL,
    schedule_id BIGINT NULL,
    request_type VARCHAR(60) NOT NULL,
    request_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    reason VARCHAR(2000) NOT NULL,
    evidence_reference VARCHAR(500) NULL,
    policy_version VARCHAR(60) NOT NULL,
    policy_snapshot_json LONGTEXT NOT NULL,
    financial_snapshot_json LONGTEXT NOT NULL,
    proposed_entries_json LONGTEXT NOT NULL,
    requested_by INT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INT NULL,
    decided_at DATETIME NULL,
    decision_reason VARCHAR(1000) NULL,
    execution_reference VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_finance_correction_request_agreement (agreement_id, request_status, created_at),
    INDEX idx_finance_correction_request_payment (payment_id, request_status),
    INDEX idx_finance_correction_request_queue (request_type, request_status, requested_at),
    CONSTRAINT fk_finance_correction_request_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_correction_request_payment
        FOREIGN KEY (payment_id) REFERENCES equipment_sale_payments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_correction_request_schedule
        FOREIGN KEY (schedule_id) REFERENCES equipment_installment_schedule(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_correction_request_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_finance_correction_request_decided_by
        FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_finance_ledger_entries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    entry_number VARCHAR(100) NOT NULL UNIQUE,
    request_id BIGINT NOT NULL,
    agreement_id BIGINT NOT NULL,
    payment_id BIGINT NULL,
    schedule_id BIGINT NULL,
    entry_type VARCHAR(60) NOT NULL,
    direction ENUM('debit','credit','memo') NOT NULL,
    amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    balance_before DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    balance_after DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    description VARCHAR(1000) NOT NULL,
    metadata_json LONGTEXT NULL,
    posted_by INT NULL,
    posted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_finance_ledger_agreement (agreement_id, posted_at, id),
    INDEX idx_finance_ledger_request (request_id, id),
    INDEX idx_finance_ledger_payment (payment_id, posted_at),
    INDEX idx_finance_ledger_type (entry_type, direction, posted_at),
    CONSTRAINT fk_finance_ledger_request
        FOREIGN KEY (request_id) REFERENCES equipment_finance_correction_requests(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_ledger_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_ledger_payment
        FOREIGN KEY (payment_id) REFERENCES equipment_sale_payments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_ledger_schedule
        FOREIGN KEY (schedule_id) REFERENCES equipment_installment_schedule(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_ledger_posted_by
        FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_finance_asset_returns (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    return_number VARCHAR(100) NOT NULL UNIQUE,
    request_id BIGINT NOT NULL UNIQUE,
    agreement_id BIGINT NOT NULL UNIQUE,
    asset_id INT NOT NULL,
    return_type VARCHAR(40) NOT NULL,
    return_date DATE NOT NULL,
    condition_status VARCHAR(60) NOT NULL,
    meter_reading DECIMAL(14,2) NULL,
    approved_return_credit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    refundable_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    penalty_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    damage_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    settlement_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    refund_due DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    policy_version VARCHAR(60) NOT NULL,
    evidence_reference VARCHAR(500) NOT NULL,
    notes VARCHAR(2000) NULL,
    return_status VARCHAR(30) NOT NULL DEFAULT 'approved',
    received_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_finance_asset_return_asset (asset_id, return_date),
    INDEX idx_finance_asset_return_status (return_status, return_date),
    CONSTRAINT fk_finance_asset_return_request
        FOREIGN KEY (request_id) REFERENCES equipment_finance_correction_requests(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_asset_return_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_asset_return_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_asset_return_received_by
        FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_finance_asset_return_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO equipment_finance_correction_policies (
    id,
    policy_version,
    return_terms
)
VALUES (
    1,
    'FIN-CORR-1',
    'Every cancellation, reversal, waiver, return, repossession and settlement requires a recorded reason, financial snapshot and independent approval. A returned machine settlement is calculated as outstanding balance less approved return credit less approved refundable amounts plus approved penalties and damage charges. Original transactions remain preserved; corrections are posted through the Finance ledger.'
)
ON DUPLICATE KEY UPDATE id = VALUES(id);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'equipment_finance_phase4_corrections_settlements',
    'Adds configurable Finance correction policy, approval requests, append-only ledger entries and equipment return settlements without deleting original transactions.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
