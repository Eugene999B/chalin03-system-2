-- CHALIN 03 PAYROLL FINANCIAL FOUNDATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: download and validate a fresh signed full-system backup plus the relevant workforce/category backup before production execution.
-- This migration does not add salary columns to worker_profiles and does not delete or rewrite worker history.

CREATE TABLE IF NOT EXISTS payroll_statutory_rule_versions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    scope_code VARCHAR(50) NOT NULL,
    jurisdiction_code VARCHAR(20) NOT NULL DEFAULT 'GH',
    rule_code VARCHAR(80) NOT NULL,
    version_label VARCHAR(120) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    status ENUM('draft', 'pending_approval', 'approved', 'superseded', 'cancelled') NOT NULL DEFAULT 'draft',
    configuration_json JSON NOT NULL,
    change_reason VARCHAR(1000) NOT NULL,
    created_by INT NULL,
    submitted_by INT NULL,
    submitted_at DATETIME NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    cancelled_by INT NULL,
    cancelled_at DATETIME NULL,
    cancellation_reason VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_payroll_statutory_rule_version (scope_code, rule_code, version_label),
    INDEX idx_payroll_statutory_rule_effective (scope_code, rule_code, status, effective_from, effective_to),
    CONSTRAINT fk_payroll_statutory_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_statutory_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_statutory_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_statutory_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_compensation_profiles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    worker_id BIGINT NOT NULL,
    workspace_code VARCHAR(50) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'GHS',
    pay_frequency VARCHAR(30) NOT NULL DEFAULT 'monthly',
    basic_salary DECIMAL(15,2) NOT NULL,
    status ENUM('draft', 'pending_approval', 'approved', 'superseded', 'cancelled') NOT NULL DEFAULT 'draft',
    change_reason VARCHAR(1000) NOT NULL,
    supersedes_profile_id BIGINT NULL,
    superseded_by_profile_id BIGINT NULL,
    created_by INT NULL,
    submitted_by INT NULL,
    submitted_at DATETIME NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    cancelled_by INT NULL,
    cancelled_at DATETIME NULL,
    cancellation_reason VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_payroll_compensation_worker_start (worker_id, effective_from),
    INDEX idx_payroll_compensation_workspace (workspace_code, status, effective_from),
    INDEX idx_payroll_compensation_worker_status (worker_id, status, effective_from, effective_to),
    CONSTRAINT fk_payroll_compensation_worker FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_compensation_supersedes FOREIGN KEY (supersedes_profile_id) REFERENCES payroll_compensation_profiles(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_compensation_superseded_by FOREIGN KEY (superseded_by_profile_id) REFERENCES payroll_compensation_profiles(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_compensation_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_compensation_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_compensation_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_compensation_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_recurring_components (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    compensation_profile_id BIGINT NOT NULL,
    component_code VARCHAR(80) NOT NULL,
    component_name VARCHAR(180) NOT NULL,
    component_type ENUM('earning', 'deduction', 'employer_contribution') NOT NULL,
    calculation_type ENUM('fixed', 'percentage_of_basic') NOT NULL DEFAULT 'fixed',
    amount_value DECIMAL(15,4) NOT NULL,
    taxable BOOLEAN NOT NULL DEFAULT FALSE,
    pensionable BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0,
    notes VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_payroll_component_profile_code (compensation_profile_id, component_code),
    INDEX idx_payroll_component_profile_type (compensation_profile_id, component_type, display_order),
    CONSTRAINT fk_payroll_component_profile FOREIGN KEY (compensation_profile_id) REFERENCES payroll_compensation_profiles(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payroll_periods (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    workspace_code VARCHAR(50) NOT NULL,
    period_code VARCHAR(20) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    scheduled_pay_date DATE NULL,
    status ENUM('draft', 'validating', 'pending_approval', 'approved', 'locked', 'paying', 'reconciled', 'closed', 'cancelled') NOT NULL DEFAULT 'draft',
    statutory_rule_snapshot_json JSON NULL,
    notes VARCHAR(2000) NULL,
    prepared_by INT NULL,
    submitted_by INT NULL,
    submitted_at DATETIME NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    locked_by INT NULL,
    locked_at DATETIME NULL,
    closed_by INT NULL,
    closed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_payroll_period_workspace_code (workspace_code, period_code),
    INDEX idx_payroll_period_workspace_status (workspace_code, status, period_start),
    CONSTRAINT fk_payroll_period_prepared_by FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_period_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_period_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_period_locked_by FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_period_closed_by FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_entries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    payroll_period_id BIGINT NOT NULL,
    worker_id BIGINT NOT NULL,
    workspace_code VARCHAR(50) NOT NULL,
    compensation_profile_id BIGINT NOT NULL,
    entry_status ENUM('draft', 'pending_approval', 'approved', 'due', 'part_paid', 'paid', 'reversed', 'cancelled') NOT NULL DEFAULT 'draft',
    employment_days INT NULL,
    payable_days DECIMAL(10,2) NULL,
    basic_earned DECIMAL(15,2) NOT NULL DEFAULT 0,
    gross_earnings DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_deductions DECIMAL(15,2) NOT NULL DEFAULT 0,
    employer_contributions DECIMAL(15,2) NOT NULL DEFAULT 0,
    net_salary DECIMAL(15,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
    remaining_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
    compensation_snapshot_json JSON NOT NULL,
    statutory_snapshot_json JSON NULL,
    calculation_checksum_sha256 CHAR(64) NULL,
    prepared_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    locked_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_payroll_entry_period_worker (payroll_period_id, worker_id),
    INDEX idx_payroll_entry_workspace_status (workspace_code, entry_status, payroll_period_id),
    INDEX idx_payroll_entry_worker_history (worker_id, payroll_period_id),
    CONSTRAINT fk_payroll_entry_period FOREIGN KEY (payroll_period_id) REFERENCES payroll_periods(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_entry_worker FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_entry_compensation FOREIGN KEY (compensation_profile_id) REFERENCES payroll_compensation_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_entry_prepared_by FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_entry_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_entry_lines (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    payroll_entry_id BIGINT NOT NULL,
    line_code VARCHAR(80) NOT NULL,
    line_name VARCHAR(180) NOT NULL,
    line_type ENUM('earning', 'deduction', 'employer_contribution', 'arrears', 'loan', 'advance', 'statutory') NOT NULL,
    source_type VARCHAR(80) NOT NULL,
    source_reference VARCHAR(191) NULL,
    quantity DECIMAL(15,4) NULL,
    rate DECIMAL(15,4) NULL,
    amount DECIMAL(15,2) NOT NULL,
    metadata_json JSON NULL,
    display_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_payroll_entry_line_code (payroll_entry_id, line_code, source_type),
    INDEX idx_payroll_entry_line_type (payroll_entry_id, line_type, display_order),
    CONSTRAINT fk_payroll_entry_line_entry FOREIGN KEY (payroll_entry_id) REFERENCES payroll_entries(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payroll_salary_payments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    payroll_entry_id BIGINT NOT NULL,
    worker_id BIGINT NOT NULL,
    workspace_code VARCHAR(50) NOT NULL,
    payment_number VARCHAR(100) NULL,
    idempotency_key VARCHAR(191) NOT NULL,
    payment_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    payment_reference VARCHAR(191) NOT NULL,
    destination_masked VARCHAR(191) NULL,
    payment_status ENUM('posted', 'reversal_pending', 'reversed') NOT NULL DEFAULT 'posted',
    reversal_of_payment_id BIGINT NULL,
    posted_by INT NULL,
    posted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata_json JSON NULL,

    UNIQUE KEY uq_payroll_payment_idempotency (idempotency_key),
    UNIQUE KEY uq_payroll_payment_number (payment_number),
    INDEX idx_payroll_payment_entry_date (payroll_entry_id, payment_date),
    INDEX idx_payroll_payment_worker_date (worker_id, payment_date),
    INDEX idx_payroll_payment_workspace_date (workspace_code, payment_date),
    CONSTRAINT fk_payroll_payment_entry FOREIGN KEY (payroll_entry_id) REFERENCES payroll_entries(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_payment_worker FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_payment_reversal_source FOREIGN KEY (reversal_of_payment_id) REFERENCES payroll_salary_payments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_payment_posted_by FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_adjustment_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    workspace_code VARCHAR(50) NOT NULL,
    worker_id BIGINT NOT NULL,
    payroll_entry_id BIGINT NULL,
    payment_id BIGINT NULL,
    adjustment_type ENUM('earning_adjustment', 'deduction_adjustment', 'payment_reversal', 'backpay', 'other') NOT NULL,
    requested_amount DECIMAL(15,2) NULL,
    reason VARCHAR(2000) NOT NULL,
    evidence_reference VARCHAR(500) NULL,
    request_status ENUM('pending', 'approved', 'rejected', 'executed', 'cancelled') NOT NULL DEFAULT 'pending',
    requested_by INT NOT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INT NULL,
    decided_at DATETIME NULL,
    decision_reason VARCHAR(2000) NULL,
    executed_by INT NULL,
    executed_at DATETIME NULL,
    result_reference VARCHAR(191) NULL,

    INDEX idx_payroll_adjustment_workspace_status (workspace_code, request_status, requested_at),
    INDEX idx_payroll_adjustment_worker (worker_id, requested_at),
    CONSTRAINT fk_payroll_adjustment_worker FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_adjustment_entry FOREIGN KEY (payroll_entry_id) REFERENCES payroll_entries(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_adjustment_payment FOREIGN KEY (payment_id) REFERENCES payroll_salary_payments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_adjustment_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_adjustment_decided_by FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_adjustment_executed_by FOREIGN KEY (executed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_worker_loans (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    workspace_code VARCHAR(50) NOT NULL,
    worker_id BIGINT NOT NULL,
    loan_number VARCHAR(100) NULL,
    loan_type ENUM('loan', 'salary_advance') NOT NULL,
    principal_amount DECIMAL(15,2) NOT NULL,
    approved_amount DECIMAL(15,2) NOT NULL,
    outstanding_balance DECIMAL(15,2) NOT NULL,
    repayment_amount DECIMAL(15,2) NULL,
    start_date DATE NOT NULL,
    target_end_date DATE NULL,
    status ENUM('draft', 'pending_approval', 'active', 'settled', 'cancelled') NOT NULL DEFAULT 'draft',
    reason VARCHAR(1500) NOT NULL,
    requested_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_payroll_worker_loan_number (loan_number),
    INDEX idx_payroll_worker_loan_workspace_status (workspace_code, status, start_date),
    INDEX idx_payroll_worker_loan_worker_status (worker_id, status, start_date),
    CONSTRAINT fk_payroll_worker_loan_worker FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_worker_loan_requested_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_worker_loan_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_loan_transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    loan_id BIGINT NOT NULL,
    payroll_entry_id BIGINT NULL,
    transaction_type ENUM('disbursement', 'repayment', 'adjustment', 'reversal') NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    transaction_date DATE NOT NULL,
    reference VARCHAR(191) NOT NULL,
    notes VARCHAR(1000) NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_payroll_loan_transaction_reference (loan_id, reference),
    INDEX idx_payroll_loan_transaction_date (loan_id, transaction_date),
    CONSTRAINT fk_payroll_loan_transaction_loan FOREIGN KEY (loan_id) REFERENCES payroll_worker_loans(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_loan_transaction_entry FOREIGN KEY (payroll_entry_id) REFERENCES payroll_entries(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_loan_transaction_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payroll_payslips (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    payroll_entry_id BIGINT NOT NULL,
    worker_id BIGINT NOT NULL,
    workspace_code VARCHAR(50) NOT NULL,
    payslip_number VARCHAR(120) NOT NULL,
    issue_version INT NOT NULL DEFAULT 1,
    issue_status ENUM('current', 'superseded', 'revoked') NOT NULL DEFAULT 'current',
    snapshot_json JSON NOT NULL,
    checksum_sha256 CHAR(64) NOT NULL,
    verification_reference VARCHAR(191) NULL,
    supersedes_payslip_id BIGINT NULL,
    issued_by INT NULL,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_by INT NULL,
    revoked_at DATETIME NULL,
    revocation_reason VARCHAR(1000) NULL,

    UNIQUE KEY uq_payroll_payslip_number_version (payslip_number, issue_version),
    UNIQUE KEY uq_payroll_payslip_checksum (checksum_sha256),
    INDEX idx_payroll_payslip_entry_status (payroll_entry_id, issue_status, issue_version),
    INDEX idx_payroll_payslip_worker_date (worker_id, issued_at),
    CONSTRAINT fk_payroll_payslip_entry FOREIGN KEY (payroll_entry_id) REFERENCES payroll_entries(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_payslip_worker FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_payroll_payslip_supersedes FOREIGN KEY (supersedes_payslip_id) REFERENCES payroll_payslips(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_payslip_issued_by FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_payroll_payslip_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260810_payroll_financial_foundation',
    'Adds effective-dated compensation, payroll periods and immutable entry/line/payment/adjustment/loan/payslip foundations with category isolation and no worker-history rewrite.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT 'PAYROLL FINANCIAL FOUNDATION MIGRATION COMPLETE' AS result;
