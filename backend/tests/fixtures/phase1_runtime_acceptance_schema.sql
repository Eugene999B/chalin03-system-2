-- Disposable GitHub Actions fixture for Phase 1 runtime acceptance only.
-- This is not a production migration and must never be used for application setup.

CREATE TABLE schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE branches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    branch_code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    location VARCHAR(255) NULL,
    is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'manager', 'staff', 'cashier', 'auditor') NOT NULL DEFAULT 'cashier',
    default_branch_id INT NULL,
    can_access_all_branches BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fixture_user_branch (default_branch_id),
    INDEX idx_fixture_user_active (is_active)
);

CREATE TABLE user_branch_access (
    user_id INT NOT NULL,
    branch_id INT NOT NULL,
    access_role ENUM('admin', 'manager', 'staff', 'cashier', 'auditor') NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    can_access BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, branch_id),
    INDEX idx_fixture_access_branch (branch_id),
    INDEX idx_fixture_access_active (can_access)
);

CREATE TABLE expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    category VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method ENUM('cash', 'momo', 'bank', 'other') NOT NULL DEFAULT 'cash',
    description TEXT NULL,
    expense_date DATE NOT NULL,
    recorded_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_fixture_expense_branch (branch_id),
    INDEX idx_fixture_expense_date (expense_date)
);

CREATE TABLE daily_closings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    closing_date DATE NOT NULL,
    expected_cash DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    expected_momo DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    expected_bank DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    expected_other DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    expected_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    cash_counted DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    momo_counted DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    bank_counted DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    other_counted DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_counted DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    difference_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    counted_confirmed TINYINT(1) NOT NULL DEFAULT 0,
    stale_after_close TINYINT(1) NOT NULL DEFAULT 0,
    stale_detected_at DATETIME NULL,
    latest_revision_number INT NOT NULL DEFAULT 1,
    closed_by INT NULL,
    verified_by INT NULL,
    verified_at DATETIME NULL,
    verification_status ENUM('submitted', 'verified', 'variance_review', 'revised') NOT NULL DEFAULT 'submitted',
    closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_fixture_closing (branch_id, closing_date)
);

CREATE TABLE daily_closing_revisions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    daily_closing_id INT NOT NULL,
    branch_id INT NOT NULL,
    closing_date DATE NOT NULL,
    revision_number INT NOT NULL,
    revision_type ENUM('original', 'post_closing_change', 'manager_revision') NOT NULL DEFAULT 'original',
    reason TEXT NULL,
    expected_snapshot_json LONGTEXT NOT NULL,
    counted_snapshot_json LONGTEXT NOT NULL,
    difference_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    source_entity_type VARCHAR(80) NULL,
    source_entity_id VARCHAR(80) NULL,
    changed_by INT NULL,
    approved_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_fixture_closing_revision (daily_closing_id, revision_number),
    INDEX idx_fixture_revision_source (source_entity_type, source_entity_id)
);

CREATE TABLE audit_signoffs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    period_type ENUM('all', 'today', 'week', 'month', 'year', 'custom') NOT NULL DEFAULT 'month',
    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    audit_score INT NOT NULL DEFAULT 0,
    audit_status VARCHAR(50) NOT NULL DEFAULT 'Needs Review',
    period_status ENUM('draft', 'reviewed', 'approved', 'rejected') NOT NULL DEFAULT 'draft',
    approved_by_name VARCHAR(150) NULL,
    review_date DATE NULL,
    created_by INT NULL,
    approved_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fixture_signoff_period (branch_id, period_status, period_start, period_end)
);

CREATE TABLE activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NULL,
    user_id INT NULL,
    action VARCHAR(150) NOT NULL,
    details TEXT NULL,
    ip_address VARCHAR(50) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    workspace_code VARCHAR(50) NULL,
    business_unit_id INT NULL,
    mining_site_id INT NULL,
    hire_location_id INT NULL,
    entity_type VARCHAR(80) NULL,
    entity_id VARCHAR(80) NULL,
    action_type VARCHAR(100) NULL,
    outcome VARCHAR(40) NOT NULL DEFAULT 'success',
    severity VARCHAR(40) NOT NULL DEFAULT 'info',
    request_id VARCHAR(100) NULL,
    user_agent VARCHAR(500) NULL,
    metadata_json LONGTEXT NULL,
    INDEX idx_fixture_activity_action (action),
    INDEX idx_fixture_activity_entity (entity_type, entity_id)
);
