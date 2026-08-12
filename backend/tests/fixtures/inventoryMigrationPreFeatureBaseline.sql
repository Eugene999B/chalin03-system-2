-- CHALIN 03 INVENTORY MIGRATION REHEARSAL — PRE-FEATURE BASELINE
-- TEST FIXTURE ONLY. Never use this file as a production schema or restore source.
-- This mirrors the core table shapes that the inventory traceability migrations
-- depend on before any inventory-loss-prevention columns/tables exist.

CREATE TABLE branches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    branch_code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    location VARCHAR(255),
    phone VARCHAR(50),
    manager_name VARCHAR(150),
    is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_branch_code_alias (code),
    INDEX idx_branch_code (branch_code),
    INDEX idx_branch_name (name),
    INDEX idx_branch_active (is_active)
);

CREATE TABLE schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,

    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'manager', 'staff', 'cashier', 'auditor') NOT NULL DEFAULT 'cashier',
    phone VARCHAR(30),
    default_branch_id INT NULL,
    can_access_all_branches BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    password_changed_at DATETIME NULL,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    last_login_at DATETIME NULL,
    last_login_ip VARCHAR(50) NULL,
    token_version INT NOT NULL DEFAULT 0,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (default_branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    CONSTRAINT fk_users_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_user_role (role),
    INDEX idx_user_active (is_active),
    INDEX idx_user_must_change_password (must_change_password),
    INDEX idx_user_locked_until (locked_until),
    INDEX idx_user_last_login_at (last_login_at),
    INDEX idx_user_token_version (token_version),
    INDEX idx_user_default_branch (default_branch_id),
    INDEX idx_user_all_branches (can_access_all_branches),
    INDEX idx_user_created_by (created_by)
);

CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    name VARCHAR(150) NOT NULL,
    size VARCHAR(80),
    category VARCHAR(100),
    cost_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    selling_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    quantity INT NOT NULL DEFAULT 0,
    low_stock_threshold INT NOT NULL DEFAULT 5,
    barcode VARCHAR(100),
    image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE KEY unique_product_branch_barcode (branch_id, barcode),
    INDEX idx_product_branch (branch_id),
    INDEX idx_product_name (name),
    INDEX idx_product_category (category),
    INDEX idx_product_barcode (barcode),
    INDEX idx_product_active (is_active),
    INDEX idx_product_low_stock (quantity, low_stock_threshold)
);
