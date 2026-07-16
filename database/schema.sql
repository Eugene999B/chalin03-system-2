-- CHALIN 03 CLEAN MASTER DATABASE SCHEMA
-- Generated for reset/restore packaging.
-- Creates the 53 current application tables plus schema_migrations.
-- Select the target database before running this file.
-- Do not run the old reference schema.

SELECT DATABASE() AS selected_database_for_clean_schema;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- CORE APPLICATION TABLES
-- ============================================================

-- branches
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

-- schema_migrations
CREATE TABLE schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,

    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

-- users
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

-- user_branch_access
CREATE TABLE user_branch_access (
    user_id INT NOT NULL,
    branch_id INT NOT NULL,
    access_role ENUM('admin', 'manager', 'staff', 'cashier', 'auditor') NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    can_access BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, branch_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,

    INDEX idx_user_branch_access_user (user_id),
    INDEX idx_user_branch_access_branch (branch_id),
    INDEX idx_user_branch_access_primary (is_primary),
    INDEX idx_user_branch_access_active (can_access)
);

-- business_units
CREATE TABLE business_units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(255) NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_business_unit_enabled (is_enabled),
    INDEX idx_business_unit_order (display_order)
);

-- business_locations
CREATE TABLE business_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_unit_id INT NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    location_type VARCHAR(50) NOT NULL,
    address VARCHAR(255) NULL,
    phone VARCHAR(50) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_business_location_code (business_unit_id, code),
    INDEX idx_business_location_unit (business_unit_id),
    INDEX idx_business_location_active (is_active),

    CONSTRAINT fk_business_location_unit
        FOREIGN KEY (business_unit_id) REFERENCES business_units(id) ON DELETE CASCADE
);

-- user_business_access
CREATE TABLE user_business_access (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    business_unit_id INT NOT NULL,
    access_role VARCHAR(50) NOT NULL,
    can_access BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_user_business_access (user_id, business_unit_id),
    INDEX idx_user_business_access_user (user_id),
    INDEX idx_user_business_access_unit (business_unit_id),
    INDEX idx_user_business_access_active (can_access),

    CONSTRAINT fk_user_business_access_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_business_access_unit
        FOREIGN KEY (business_unit_id) REFERENCES business_units(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_business_access_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- products
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

-- stock_adjustments
CREATE TABLE stock_adjustments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    product_id INT NOT NULL,
    adjustment_type ENUM('increase', 'decrease', 'set') NOT NULL,
    movement_type VARCHAR(40) NOT NULL DEFAULT 'other',
    quantity INT NOT NULL,
    old_quantity INT NOT NULL,
    new_quantity INT NOT NULL,
    reason TEXT NOT NULL,
    source_name VARCHAR(150),
    reference_number VARCHAR(120),
    unit_cost DECIMAL(12,2),
    cost_price_before DECIMAL(12,2),
    cost_price_after DECIMAL(12,2),
    movement_date DATE,
    notes TEXT,
    adjusted_by INT,
    adjusted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (adjusted_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_stock_adjustment_branch (branch_id),
    INDEX idx_stock_adjustment_product (product_id),
    INDEX idx_stock_adjustment_type (adjustment_type),
    INDEX idx_stock_movement_type (movement_type),
    INDEX idx_stock_movement_date (movement_date),
    INDEX idx_stock_adjustment_date (adjusted_at),
    INDEX idx_stock_adjustment_user (adjusted_by)
);

-- suppliers
CREATE TABLE suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(150),
    phone VARCHAR(30),
    email VARCHAR(150),
    address TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,

    INDEX idx_supplier_branch (branch_id),
    INDEX idx_supplier_name (name),
    INDEX idx_supplier_phone (phone),
    INDEX idx_supplier_active (is_active)
);

-- purchases
CREATE TABLE purchases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    supplier_id INT,
    invoice_number VARCHAR(100),
    purchase_date DATE NOT NULL,
    total_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_status ENUM('unpaid', 'partial', 'paid') NOT NULL DEFAULT 'paid',
    notes TEXT,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_purchase_branch (branch_id),
    INDEX idx_purchase_supplier (supplier_id),
    INDEX idx_purchase_date (purchase_date),
    INDEX idx_purchase_invoice (invoice_number),
    INDEX idx_purchase_payment_status (payment_status)
);

-- purchase_items
CREATE TABLE purchase_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT NOT NULL,
    product_id INT NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    quantity INT NOT NULL,
    cost_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,

    INDEX idx_purchase_items_purchase (purchase_id),
    INDEX idx_purchase_items_product (product_id)
);

-- purchase_payments
CREATE TABLE purchase_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    purchase_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method ENUM('cash', 'momo', 'bank', 'mixed', 'other') NOT NULL DEFAULT 'cash',
    paid_by INT,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_purchase_payment_branch (branch_id),
    INDEX idx_purchase_payment_purchase (purchase_id),
    INDEX idx_purchase_payment_date (paid_at),
    INDEX idx_purchase_payment_method (payment_method),
    INDEX idx_purchase_payment_user (paid_by)
);

-- customers
CREATE TABLE customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    location VARCHAR(150),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,

    INDEX idx_customer_branch (branch_id),
    INDEX idx_customer_name (name),
    INDEX idx_customer_phone (phone)
);

-- sales
CREATE TABLE sales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    receipt_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id INT,
    customer_name VARCHAR(150),
    customer_phone VARCHAR(30),
    staff_id INT,

    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    payment_type ENUM('cash', 'momo', 'bank', 'credit', 'mixed') NOT NULL DEFAULT 'cash',
    amount_tendered DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    change_due DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    sale_status ENUM('completed', 'returned', 'cancelled') NOT NULL DEFAULT 'completed',

    is_voided TINYINT(1) NOT NULL DEFAULT 0,
    void_reason TEXT NULL,
    voided_by INT NULL,
    voided_at DATETIME NULL,
    edited_by INT NULL,
    edited_at DATETIME NULL,
    edit_reason TEXT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (edited_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_sale_branch (branch_id),
    INDEX idx_receipt_number (receipt_number),
    INDEX idx_sale_customer (customer_id),
    INDEX idx_sale_staff (staff_id),
    INDEX idx_sale_date (created_at),
    INDEX idx_payment_type (payment_type),
    INDEX idx_sale_status (sale_status),
    INDEX idx_sale_voided (is_voided),
    INDEX idx_sale_change_due (change_due),
    INDEX idx_sale_edited_by (edited_by)
);

-- sale_items
CREATE TABLE sale_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    cost_price_at_sale DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,

    INDEX idx_sale_items_sale (sale_id),
    INDEX idx_sale_items_product (product_id)
);

-- sale_payment_allocations
CREATE TABLE sale_payment_allocations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    sale_id INT NOT NULL,
    payment_channel ENUM('cash', 'momo', 'bank', 'other') NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    recorded_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE KEY unique_sale_payment_channel (sale_id, payment_channel),
    INDEX idx_sale_allocation_branch (branch_id),
    INDEX idx_sale_allocation_sale (sale_id),
    INDEX idx_sale_allocation_channel (payment_channel)
);

-- debts
CREATE TABLE debts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    sale_id INT NOT NULL,
    customer_id INT,
    customer_name VARCHAR(150) NOT NULL,
    customer_phone VARCHAR(30),
    amount_owed DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status ENUM('unpaid', 'partial', 'paid') NOT NULL DEFAULT 'unpaid',
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,

    INDEX idx_debt_branch (branch_id),
    INDEX idx_debt_sale (sale_id),
    INDEX idx_debt_customer (customer_id),
    INDEX idx_debt_status (status),
    INDEX idx_due_date (due_date),
    INDEX idx_debt_customer_phone (customer_phone)
);

-- debt_payments
CREATE TABLE debt_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    debt_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method ENUM('cash', 'momo', 'bank') NOT NULL DEFAULT 'cash',
    received_by INT,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE CASCADE,
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_debt_payment_branch (branch_id),
    INDEX idx_debt_payment_debt (debt_id),
    INDEX idx_debt_payment_date (paid_at),
    INDEX idx_debt_payment_method (payment_method),
    INDEX idx_debt_payment_receiver (received_by)
);

-- returns
CREATE TABLE returns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    reason TEXT,
    return_type ENUM('stock_only', 'refund', 'exchange', 'store_credit') NOT NULL DEFAULT 'stock_only',
    refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    refund_method ENUM('none', 'cash', 'momo', 'bank', 'other') NOT NULL DEFAULT 'none',
    refund_reference VARCHAR(180) NULL,
    returned_by INT,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    returned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    FOREIGN KEY (returned_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_returns_branch (branch_id),
    INDEX idx_returns_sale (sale_id),
    INDEX idx_returns_product (product_id),
    INDEX idx_returns_date (returned_at),
    INDEX idx_returns_user (returned_by),
    INDEX idx_return_refund_method (refund_method),
    INDEX idx_return_approved_by (approved_by)
);

-- expenses
CREATE TABLE expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    category VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method ENUM('cash', 'momo', 'bank', 'other') NOT NULL DEFAULT 'cash',
    description TEXT,
    expense_date DATE NOT NULL,
    recorded_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_expense_branch (branch_id),
    INDEX idx_expense_date (expense_date),
    INDEX idx_expense_category (category),
    INDEX idx_expense_payment_method (payment_method),
    INDEX idx_expense_user (recorded_by)
);

-- sms_log
CREATE TABLE sms_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NULL,
    recipient_phone VARCHAR(30) NOT NULL,
    message TEXT NOT NULL,
    sms_type ENUM(
        'receipt',
        'debt_reminder',
        'low_stock',
        'daily_summary',
        'sale_confirmation',
        'security_alert',
        'other'
    ) NOT NULL DEFAULT 'other',
    status ENUM(
        'pending',
        'accepted',
        'delivered',
        'undelivered',
        'expired',
        'failed',
        'delivery_unknown'
    ) NOT NULL DEFAULT 'pending',
    provider VARCHAR(30),
    sender_id VARCHAR(20),
    provider_message_id VARCHAR(191),
    provider_status VARCHAR(80),
    status_reason TEXT,
    segment_count INT NOT NULL DEFAULT 1,
    estimated_credits INT NOT NULL DEFAULT 1,
    retry_count INT NOT NULL DEFAULT 0,
    original_log_id INT NULL,
    source_reference VARCHAR(191),
    provider_response TEXT,
    delivery_report_response TEXT,
    sent_by INT NULL,
    sent_at TIMESTAMP NULL,
    submitted_at DATETIME NULL,
    delivery_confirmed_at DATETIME NULL,
    last_status_at DATETIME NULL,
    archived_at DATETIME NULL,
    archived_by INT NULL,
    archive_reason VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_sms_branch (branch_id),
    INDEX idx_sms_type (sms_type),
    INDEX idx_sms_status (status),
    INDEX idx_sms_provider_message_id (provider_message_id),
    INDEX idx_sms_original_log (original_log_id),
    INDEX idx_sms_sent_by (sent_by),
    INDEX idx_sms_created_at (created_at),
    INDEX idx_sms_branch_archived (branch_id, archived_at)
);

-- activity_log
CREATE TABLE activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NULL,
    user_id INT,
    action VARCHAR(150) NOT NULL,
    details TEXT,
    ip_address VARCHAR(50),
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

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_activity_branch (branch_id),
    INDEX idx_activity_action (action),
    INDEX idx_activity_date (created_at),
    INDEX idx_activity_user (user_id),
    INDEX idx_activity_workspace (workspace_code),
    INDEX idx_activity_business_unit (business_unit_id),
    INDEX idx_activity_mining_site (mining_site_id),
    INDEX idx_activity_hire_location (hire_location_id),
    INDEX idx_activity_action_type (action_type),
    INDEX idx_activity_entity (entity_type, entity_id),
    INDEX idx_activity_outcome (outcome),
    INDEX idx_activity_severity (severity),
    INDEX idx_activity_request (request_id)
);

CREATE TABLE application_error_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    request_id VARCHAR(100) NULL,
    user_id INT NULL,
    route VARCHAR(500) NULL,
    method VARCHAR(12) NULL,
    status_code INT NULL,
    error_code VARCHAR(120) NULL,
    safe_message VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_application_error_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_application_error_request (request_id),
    INDEX idx_application_error_user (user_id),
    INDEX idx_application_error_status (status_code),
    INDEX idx_application_error_created (created_at)
);

-- settings
CREATE TABLE settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    business_name VARCHAR(150) NOT NULL DEFAULT 'Chalin 03 Company Limited',
    branch_name VARCHAR(150) NOT NULL DEFAULT 'Chalin 03 Main Store',
    business_address VARCHAR(255) DEFAULT 'Dunkwa Police Barrier',
    business_phone VARCHAR(50) DEFAULT '0249469080 / 0249995510',
    owner_phone VARCHAR(50) DEFAULT '0543421127',
    receipt_prefix VARCHAR(20) DEFAULT 'CHL-MAIN',
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    debt_reminder_days INT NOT NULL DEFAULT 7,
    daily_summary_time TIME DEFAULT '18:00:00',
    receipt_footer VARCHAR(255) DEFAULT 'Thank You For Coming',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,

    UNIQUE KEY unique_settings_branch (branch_id),
    INDEX idx_settings_branch (branch_id)
);

-- daily_closings
CREATE TABLE daily_closings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    closing_date DATE NOT NULL,

    opening_cash_float DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    cash_deposits DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    cash_withdrawals DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    other_cash_in DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    other_cash_out DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    sales_count INT NOT NULL DEFAULT 0,
    sales_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    sales_received DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    cash_sales DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    momo_sales DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    bank_sales DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    mixed_sales DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    credit_sales_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    credit_sales_received DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    debt_payment_count INT NOT NULL DEFAULT 0,
    debt_payments_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    debt_cash DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    debt_momo DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    debt_bank DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    expenses_count INT NOT NULL DEFAULT 0,
    expenses_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,

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
    denomination_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    denomination_json LONGTEXT NULL,
    counted_confirmed TINYINT(1) NOT NULL DEFAULT 0,

    difference_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    notes TEXT,
    stale_after_close TINYINT(1) NOT NULL DEFAULT 0,
    stale_detected_at DATETIME NULL,
    latest_revision_number INT NOT NULL DEFAULT 1,
    closed_by INT,
    verified_by INT NULL,
    verified_at DATETIME NULL,
    verification_status ENUM('submitted', 'verified', 'variance_review', 'revised') NOT NULL DEFAULT 'submitted',
    closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE KEY unique_daily_closing_branch_date (branch_id, closing_date),
    INDEX idx_daily_closing_branch (branch_id),
    INDEX idx_daily_closing_date (closing_date),
    INDEX idx_daily_closing_user (closed_by),
    INDEX idx_daily_closing_stale (stale_after_close),
    INDEX idx_daily_closing_verified_by (verified_by)
);

-- sale_change_history
CREATE TABLE sale_change_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    sale_id INT NOT NULL,
    change_type ENUM('edit', 'void', 'restore', 'correction') NOT NULL DEFAULT 'edit',
    reason TEXT NOT NULL,
    before_snapshot_json LONGTEXT NOT NULL,
    after_snapshot_json LONGTEXT NULL,
    changed_by INT NOT NULL,
    approved_by INT NOT NULL,
    affected_closing_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (affected_closing_id) REFERENCES daily_closings(id) ON DELETE SET NULL,

    INDEX idx_sale_change_branch (branch_id),
    INDEX idx_sale_change_sale (sale_id),
    INDEX idx_sale_change_created (created_at),
    INDEX idx_sale_change_closing (affected_closing_id)
);

-- daily_closing_revisions
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

    FOREIGN KEY (daily_closing_id) REFERENCES daily_closings(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE KEY unique_closing_revision (daily_closing_id, revision_number),
    INDEX idx_closing_revision_branch_date (branch_id, closing_date),
    INDEX idx_closing_revision_source (source_entity_type, source_entity_id)
);

-- audit_signoffs
CREATE TABLE audit_signoffs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,

    period_type ENUM('all', 'today', 'week', 'month', 'year', 'custom') NOT NULL DEFAULT 'month',
    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,

    audit_score INT NOT NULL DEFAULT 0,
    audit_status VARCHAR(50) NOT NULL DEFAULT 'Needs Review',

    prepared_by_name VARCHAR(150),
    reviewed_by_name VARCHAR(150),
    approved_by_name VARCHAR(150),

    review_date DATE NULL,
    period_status ENUM('draft', 'reviewed', 'approved', 'rejected') NOT NULL DEFAULT 'draft',

    sales_checked BOOLEAN NOT NULL DEFAULT FALSE,
    expenses_checked BOOLEAN NOT NULL DEFAULT FALSE,
    debts_checked BOOLEAN NOT NULL DEFAULT FALSE,
    stock_checked BOOLEAN NOT NULL DEFAULT FALSE,
    warnings_checked BOOLEAN NOT NULL DEFAULT FALSE,
    reports_checked BOOLEAN NOT NULL DEFAULT FALSE,

    accountant_notes TEXT,
    management_notes TEXT,

    created_by INT,
    approved_by INT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_audit_signoff_branch (branch_id),
    INDEX idx_audit_signoff_period_type (period_type),
    INDEX idx_audit_signoff_period_dates (period_start, period_end),
    INDEX idx_audit_signoff_status (period_status),
    INDEX idx_audit_signoff_created_by (created_by),
    INDEX idx_audit_signoff_approved_by (approved_by),
    INDEX idx_audit_signoff_created_at (created_at)
);

-- audit_unlock_requests
CREATE TABLE audit_unlock_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,

    audit_signoff_id INT NULL,

    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,

    request_area ENUM(
        'sale',
        'expense',
        'debt_payment',
        'stock',
        'purchase',
        'return',
        'other'
    ) NOT NULL DEFAULT 'other',

    requested_action VARCHAR(150) NOT NULL DEFAULT 'Correction needed',
    reason TEXT NOT NULL,

    status ENUM('pending', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',

    requested_by INT NULL,
    reviewed_by INT NULL,
    reviewed_at TIMESTAMP NULL,

    review_notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_audit_unlock_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_audit_unlock_signoff
        FOREIGN KEY (audit_signoff_id) REFERENCES audit_signoffs(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_audit_unlock_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_audit_unlock_reviewed_by
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_unlock_request_branch (branch_id),
    INDEX idx_unlock_request_signoff (audit_signoff_id),
    INDEX idx_unlock_request_status (status),
    INDEX idx_unlock_request_area (request_area),
    INDEX idx_unlock_request_requested_by (requested_by),
    INDEX idx_unlock_request_reviewed_by (reviewed_by),
    INDEX idx_unlock_request_created_at (created_at)
);

-- audit_reapproval_log
CREATE TABLE audit_reapproval_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,

    audit_signoff_id INT NULL,
    unlock_request_id INT NULL,

    period_label VARCHAR(255) NOT NULL,
    period_start DATE NULL,
    period_end DATE NULL,

    previous_status VARCHAR(50) NULL,
    new_status VARCHAR(50) NOT NULL DEFAULT 'approved',

    audit_score INT NOT NULL DEFAULT 0,
    audit_status VARCHAR(50) NULL,

    reapproved_by INT NULL,
    reapproved_by_name VARCHAR(150) NULL,
    reapproved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    reapproval_notes TEXT,
    accountant_notes TEXT,
    management_notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_reapproval_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_reapproval_signoff
        FOREIGN KEY (audit_signoff_id) REFERENCES audit_signoffs(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_reapproval_unlock_request
        FOREIGN KEY (unlock_request_id) REFERENCES audit_unlock_requests(id)
        ON DELETE SET NULL,

    CONSTRAINT fk_reapproval_user
        FOREIGN KEY (reapproved_by) REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_reapproval_branch (branch_id),
    INDEX idx_reapproval_signoff (audit_signoff_id),
    INDEX idx_reapproval_unlock_request (unlock_request_id),
    INDEX idx_reapproval_period_dates (period_start, period_end),
    INDEX idx_reapproval_user (reapproved_by),
    INDEX idx_reapproval_date (reapproved_at)
);

-- stock_transfers
CREATE TABLE stock_transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,

  transfer_number VARCHAR(80) NOT NULL UNIQUE,

  from_branch_id INT NOT NULL,
  to_branch_id INT NOT NULL,

  status ENUM(
    'draft',
    'requested',
    'approved',
    'dispatched',
    'received',
    'cancelled',
    'rejected'
  ) NOT NULL DEFAULT 'requested',

  requested_by INT NULL,
  approved_by INT NULL,
  dispatched_by INT NULL,
  received_by INT NULL,
  cancelled_by INT NULL,
  rejected_by INT NULL,

  request_note TEXT NULL,
  approval_note TEXT NULL,
  dispatch_note TEXT NULL,
  receive_note TEXT NULL,
  cancel_note TEXT NULL,
  reject_note TEXT NULL,

  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL,
  dispatched_at DATETIME NULL,
  received_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  rejected_at DATETIME NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_stock_transfers_from_branch (from_branch_id),
  INDEX idx_stock_transfers_to_branch (to_branch_id),
  INDEX idx_stock_transfers_status (status),
  INDEX idx_stock_transfers_requested_at (requested_at),

  CONSTRAINT fk_stock_transfers_from_branch
    FOREIGN KEY (from_branch_id) REFERENCES branches(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_stock_transfers_to_branch
    FOREIGN KEY (to_branch_id) REFERENCES branches(id)
    ON DELETE RESTRICT
);

-- stock_transfer_items
CREATE TABLE stock_transfer_items (
  id INT AUTO_INCREMENT PRIMARY KEY,

  transfer_id INT NOT NULL,

  source_product_id INT NOT NULL,
  destination_product_id INT NULL,

  product_name VARCHAR(255) NOT NULL,
  barcode VARCHAR(100) NULL,
  category VARCHAR(100) NULL,
  size VARCHAR(100) NULL,

  requested_quantity INT NOT NULL,
  dispatched_quantity INT NULL,
  received_quantity INT NULL,

  source_quantity_before INT NULL,
  source_quantity_after INT NULL,
  destination_quantity_before INT NULL,
  destination_quantity_after INT NULL,

  item_note TEXT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_stock_transfer_items_transfer (transfer_id),
  INDEX idx_stock_transfer_items_source_product (source_product_id),
  INDEX idx_stock_transfer_items_destination_product (destination_product_id),
  INDEX idx_stock_transfer_items_barcode (barcode),

  CONSTRAINT fk_stock_transfer_items_transfer
    FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_stock_transfer_items_source_product
    FOREIGN KEY (source_product_id) REFERENCES products(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_stock_transfer_items_destination_product
    FOREIGN KEY (destination_product_id) REFERENCES products(id)
    ON DELETE SET NULL
);

-- fleet_assets
CREATE TABLE fleet_assets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asset_code VARCHAR(50) NOT NULL UNIQUE,
    asset_name VARCHAR(150) NOT NULL,
    asset_type VARCHAR(60) NOT NULL,
    make VARCHAR(100) NULL,
    model VARCHAR(100) NULL,
    serial_number VARCHAR(120) NULL,
    registration_number VARCHAR(80) NULL,
    ownership_type VARCHAR(40) NOT NULL DEFAULT 'company_owned',
    current_status VARCHAR(40) NOT NULL DEFAULT 'available',
    current_location VARCHAR(180) NULL,
    assigned_operator_name VARCHAR(150) NULL,
    meter_type VARCHAR(30) NOT NULL DEFAULT 'hour_meter',
    current_meter DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    fuel_type VARCHAR(50) NULL,
    service_interval DECIMAL(14,2) NULL,
    next_service_meter DECIMAL(14,2) NULL,
    insurance_expiry DATE NULL,
    registration_expiry DATE NULL,
    notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_fleet_asset_name (asset_name),
    INDEX idx_fleet_asset_type (asset_type),
    INDEX idx_fleet_asset_status (current_status),
    INDEX idx_fleet_asset_location (current_location),
    INDEX idx_fleet_asset_active (is_active),
    INDEX idx_fleet_asset_service (next_service_meter, current_meter),
    INDEX idx_fleet_asset_documents (insurance_expiry, registration_expiry),
    INDEX idx_fleet_asset_created_by (created_by),
    INDEX idx_fleet_asset_updated_by (updated_by),

    CONSTRAINT fk_fleet_asset_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_fleet_asset_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- fleet_meter_readings
CREATE TABLE fleet_meter_readings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asset_id INT NOT NULL,
    reading_value DECIMAL(14,2) NOT NULL,
    reading_datetime DATETIME NOT NULL,
    source_type VARCHAR(50) NOT NULL DEFAULT 'manual',
    notes TEXT NULL,
    is_correction BOOLEAN NOT NULL DEFAULT FALSE,
    correction_reason TEXT NULL,
    recorded_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_fleet_meter_asset_date (asset_id, reading_datetime),
    INDEX idx_fleet_meter_recorded_by (recorded_by),

    CONSTRAINT fk_fleet_meter_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_fleet_meter_user
        FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
);

-- fleet_fuel_logs
CREATE TABLE fleet_fuel_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asset_id INT NOT NULL,
    log_datetime DATETIME NOT NULL,
    quantity_litres DECIMAL(14,2) NOT NULL,
    meter_reading DECIMAL(14,2) NULL,
    supplier_or_source VARCHAR(150) NULL,
    reference_number VARCHAR(120) NULL,
    cost_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    notes TEXT NULL,
    recorded_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_fleet_fuel_asset_date (asset_id, log_datetime),
    INDEX idx_fleet_fuel_reference (reference_number),
    INDEX idx_fleet_fuel_recorded_by (recorded_by),

    CONSTRAINT fk_fleet_fuel_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_fleet_fuel_user
        FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
);

-- fleet_maintenance_records
CREATE TABLE fleet_maintenance_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asset_id INT NOT NULL,
    maintenance_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    reported_at DATETIME NOT NULL,
    completed_at DATETIME NULL,
    meter_reading DECIMAL(14,2) NULL,
    description TEXT NOT NULL,
    technician VARCHAR(150) NULL,
    cost_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    next_service_meter DECIMAL(14,2) NULL,
    notes TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_fleet_maintenance_asset_date (asset_id, reported_at),
    INDEX idx_fleet_maintenance_status (status),
    INDEX idx_fleet_maintenance_type (maintenance_type),
    INDEX idx_fleet_maintenance_created_by (created_by),

    CONSTRAINT fk_fleet_maintenance_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_fleet_maintenance_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_fleet_maintenance_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- fleet_inspections
CREATE TABLE fleet_inspections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asset_id INT NOT NULL,
    inspection_type VARCHAR(50) NOT NULL,
    inspection_datetime DATETIME NOT NULL,
    meter_reading DECIMAL(14,2) NULL,
    condition_status VARCHAR(30) NOT NULL,
    findings TEXT NULL,
    action_required TEXT NULL,
    inspected_by_name VARCHAR(150) NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_fleet_inspection_asset_date (asset_id, inspection_datetime),
    INDEX idx_fleet_inspection_condition (condition_status),
    INDEX idx_fleet_inspection_created_by (created_by),

    CONSTRAINT fk_fleet_inspection_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_fleet_inspection_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- mining_sites
CREATE TABLE mining_sites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_code VARCHAR(50) NOT NULL UNIQUE,
    site_name VARCHAR(150) NOT NULL,
    location VARCHAR(255) NULL,
    material_type VARCHAR(100) NULL,
    production_unit VARCHAR(40) NOT NULL DEFAULT 'tonnes',
    daily_target DECIMAL(14,3) NULL,
    manager_name VARCHAR(150) NULL,
    manager_phone VARCHAR(40) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_mining_site_name (site_name),
    INDEX idx_mining_site_status (status, is_active),
    INDEX idx_mining_site_created_by (created_by),

    CONSTRAINT fk_mining_site_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_site_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- user_mining_site_access
CREATE TABLE user_mining_site_access (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    site_id INT NOT NULL,
    can_access BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_user_mining_site_access (user_id, site_id),
    INDEX idx_user_mining_site_access_user (user_id),
    INDEX idx_user_mining_site_access_site (site_id),
    INDEX idx_user_mining_site_access_active (can_access),
    INDEX idx_user_mining_site_access_default (user_id, is_default),

    CONSTRAINT fk_user_mining_site_access_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_mining_site_access_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_mining_site_access_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- user_hire_location_access
CREATE TABLE user_hire_location_access (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    location_id INT NOT NULL,
    can_access BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_user_hire_location_access (user_id, location_id),
    INDEX idx_user_hire_location_access_user (user_id),
    INDEX idx_user_hire_location_access_location (location_id),
    INDEX idx_user_hire_location_access_active (can_access),
    INDEX idx_user_hire_location_access_default (user_id, is_default),

    CONSTRAINT fk_user_hire_location_access_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_hire_location_access_location
        FOREIGN KEY (location_id) REFERENCES business_locations(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_hire_location_access_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- mining_daily_logs
CREATE TABLE mining_daily_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    log_date DATE NOT NULL,
    shift_code VARCHAR(30) NOT NULL DEFAULT 'day',
    supervisor_name VARCHAR(150) NULL,
    weather_conditions VARCHAR(150) NULL,
    workforce_count INT NOT NULL DEFAULT 0,
    opening_notes TEXT NULL,
    closing_notes TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_mining_daily_log (site_id, log_date, shift_code),
    INDEX idx_mining_daily_log_date (log_date),
    INDEX idx_mining_daily_log_status (status),

    CONSTRAINT fk_mining_daily_log_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_daily_log_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_daily_log_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- mining_production_records
CREATE TABLE mining_production_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    daily_log_id INT NULL,
    production_datetime DATETIME NOT NULL,
    work_area VARCHAR(150) NULL,
    material_type VARCHAR(100) NULL,
    quantity DECIMAL(14,3) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    grade_quality VARCHAR(120) NULL,
    destination VARCHAR(180) NULL,
    notes TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'recorded',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_mining_production_site_date (site_id, production_datetime),
    INDEX idx_mining_production_daily_log (daily_log_id),
    INDEX idx_mining_production_unit (unit),

    CONSTRAINT fk_mining_production_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_production_daily_log
        FOREIGN KEY (daily_log_id) REFERENCES mining_daily_logs(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_production_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_production_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- mining_equipment_logs
CREATE TABLE mining_equipment_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    daily_log_id INT NULL,
    asset_id INT NOT NULL,
    work_date DATE NOT NULL,
    shift_code VARCHAR(30) NOT NULL DEFAULT 'day',
    operator_name VARCHAR(150) NULL,
    start_meter DECIMAL(14,2) NOT NULL,
    end_meter DECIMAL(14,2) NOT NULL,
    working_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    idle_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    breakdown_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    fuel_litres DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    task_description TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'recorded',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_mining_equipment_shift (site_id, asset_id, work_date, shift_code),
    INDEX idx_mining_equipment_site_date (site_id, work_date),
    INDEX idx_mining_equipment_asset_date (asset_id, work_date),
    INDEX idx_mining_equipment_daily_log (daily_log_id),

    CONSTRAINT fk_mining_equipment_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_equipment_daily_log
        FOREIGN KEY (daily_log_id) REFERENCES mining_daily_logs(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_equipment_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_equipment_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_equipment_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- mining_fuel_logs
CREATE TABLE mining_fuel_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    asset_id INT NULL,
    log_datetime DATETIME NOT NULL,
    transaction_type VARCHAR(30) NOT NULL,
    quantity_litres DECIMAL(14,2) NOT NULL,
    storage_name VARCHAR(120) NULL,
    supplier_or_source VARCHAR(150) NULL,
    recipient_name VARCHAR(150) NULL,
    meter_reading DECIMAL(14,2) NULL,
    unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    total_cost DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    reference_number VARCHAR(120) NULL,
    notes TEXT NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_mining_fuel_site_date (site_id, log_datetime),
    INDEX idx_mining_fuel_asset_date (asset_id, log_datetime),
    INDEX idx_mining_fuel_type (transaction_type),
    INDEX idx_mining_fuel_reference (reference_number),

    CONSTRAINT fk_mining_fuel_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_fuel_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_fuel_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- mining_expenses
CREATE TABLE mining_expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    expense_date DATE NOT NULL,
    category VARCHAR(80) NOT NULL,
    description TEXT NULL,
    amount DECIMAL(14,2) NOT NULL,
    payment_method VARCHAR(40) NULL,
    reference_number VARCHAR(120) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'recorded',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_mining_expense_site_date (site_id, expense_date),
    INDEX idx_mining_expense_category (category),
    INDEX idx_mining_expense_status (status),

    CONSTRAINT fk_mining_expense_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_expense_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_expense_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- mining_incidents
CREATE TABLE mining_incidents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    incident_datetime DATETIME NOT NULL,
    incident_type VARCHAR(80) NOT NULL,
    severity VARCHAR(30) NOT NULL DEFAULT 'low',
    exact_area VARCHAR(150) NULL,
    people_involved TEXT NULL,
    description TEXT NOT NULL,
    immediate_action TEXT NULL,
    corrective_action TEXT NULL,
    responsible_officer VARCHAR(150) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    created_by INT NULL,
    closed_by INT NULL,
    closed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_mining_incident_site_date (site_id, incident_datetime),
    INDEX idx_mining_incident_status (status),
    INDEX idx_mining_incident_severity (severity),

    CONSTRAINT fk_mining_incident_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_incident_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_incident_closed_by
        FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_customers
CREATE TABLE hire_customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_code VARCHAR(50) NOT NULL UNIQUE,
    customer_name VARCHAR(180) NOT NULL,
    customer_type VARCHAR(30) NOT NULL DEFAULT 'individual',
    phone VARCHAR(40) NULL,
    whatsapp_phone VARCHAR(40) NULL,
    email VARCHAR(150) NULL,
    address VARCHAR(255) NULL,
    contact_person VARCHAR(150) NULL,
    payment_terms_days INT NOT NULL DEFAULT 0,
    credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    risk_notes TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_hire_customer_name (customer_name),
    INDEX idx_hire_customer_phone (phone),
    INDEX idx_hire_customer_active (is_active),

    CONSTRAINT fk_hire_customer_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_customer_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_enquiries
CREATE TABLE hire_enquiries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    enquiry_number VARCHAR(80) NOT NULL UNIQUE,
    customer_id INT NOT NULL,
    enquiry_date DATE NOT NULL,
    equipment_type VARCHAR(100) NOT NULL,
    work_location VARCHAR(255) NOT NULL,
    requested_start_date DATE NULL,
    expected_end_date DATE NULL,
    preferred_charging_method VARCHAR(30) NULL,
    estimated_quantity DECIMAL(14,2) NULL,
    notes TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_hire_enquiry_customer (customer_id),
    INDEX idx_hire_enquiry_location_date (hire_location_id, enquiry_date),
    INDEX idx_hire_enquiry_dates (requested_start_date, expected_end_date),
    INDEX idx_hire_enquiry_status (status),

    CONSTRAINT fk_hire_enquiry_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_enquiry_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_enquiry_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_enquiry_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_quotations
CREATE TABLE hire_quotations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    quotation_number VARCHAR(80) NOT NULL UNIQUE,
    enquiry_id INT NULL,
    customer_id INT NOT NULL,
    requested_asset_type VARCHAR(100) NOT NULL,
    preferred_asset_id INT NULL,
    work_location VARCHAR(255) NOT NULL,
    requested_start_date DATE NULL,
    expected_end_date DATE NULL,
    charging_method VARCHAR(30) NOT NULL,
    rate DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    estimated_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    minimum_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    mobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    demobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    operator_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    fuel_responsibility VARCHAR(30) NOT NULL DEFAULT 'customer',
    subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    validity_date DATE NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    terms TEXT NULL,
    notes TEXT NULL,
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_hire_quote_customer (customer_id),
    INDEX idx_hire_quote_location_status (hire_location_id, status),
    INDEX idx_hire_quote_enquiry (enquiry_id),
    INDEX idx_hire_quote_status (status),
    INDEX idx_hire_quote_dates (requested_start_date, expected_end_date),
    INDEX idx_hire_quote_asset (preferred_asset_id),

    CONSTRAINT fk_hire_quote_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_quote_enquiry
        FOREIGN KEY (enquiry_id) REFERENCES hire_enquiries(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_quote_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_quote_asset
        FOREIGN KEY (preferred_asset_id) REFERENCES fleet_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_quote_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_quote_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_quote_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_contracts
CREATE TABLE hire_contracts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    contract_number VARCHAR(80) NOT NULL UNIQUE,
    quotation_id INT NULL,
    customer_id INT NOT NULL,
    work_location VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    expected_end_date DATE NULL,
    actual_end_date DATE NULL,
    charging_method VARCHAR(30) NOT NULL,
    rate DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    minimum_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    mobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    demobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    operator_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    deposit_required DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    deposit_received DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    fuel_responsibility VARCHAR(30) NOT NULL DEFAULT 'customer',
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    terms TEXT NULL,
    notes TEXT NULL,
    closure_notes TEXT NULL,
    operational_status VARCHAR(30) NOT NULL DEFAULT 'open',
    financial_status VARCHAR(30) NOT NULL DEFAULT 'open',
    closed_by INT NULL,
    closed_at DATETIME NULL,
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_hire_contract_customer (customer_id),
    INDEX idx_hire_contract_location_status (hire_location_id, status, start_date),
    INDEX idx_hire_contract_quote (quotation_id),
    INDEX idx_hire_contract_status_dates (status, start_date, expected_end_date),
    INDEX idx_hire_contract_closure (operational_status, financial_status, closed_at),

    CONSTRAINT fk_hire_contract_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_contract_quote
        FOREIGN KEY (quotation_id) REFERENCES hire_quotations(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_contract_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_contract_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_contract_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_contract_closed_by
        FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_contract_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_contract_assets
CREATE TABLE hire_contract_assets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    contract_id INT NOT NULL,
    asset_id INT NOT NULL,
    operator_name VARCHAR(150) NULL,
    assigned_from DATETIME NOT NULL,
    assigned_to DATETIME NULL,
    opening_meter DECIMAL(14,2) NULL,
    closing_meter DECIMAL(14,2) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'assigned',
    notes TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_hire_contract_asset_contract (contract_id),
    INDEX idx_hire_contract_asset_dates (asset_id, assigned_from, assigned_to),
    INDEX idx_hire_contract_asset_status (status),

    CONSTRAINT fk_hire_contract_asset_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_contract_asset_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_contract_asset_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_contract_asset_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_dispatches
CREATE TABLE hire_dispatches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    contract_id INT NOT NULL,
    contract_asset_id INT NOT NULL,
    dispatch_datetime DATETIME NOT NULL,
    destination VARCHAR(255) NOT NULL,
    opening_meter DECIMAL(14,2) NOT NULL,
    fuel_level_percent DECIMAL(5,2) NULL,
    condition_status VARCHAR(30) NOT NULL DEFAULT 'good',
    attachments_tools TEXT NULL,
    transport_details TEXT NULL,
    receiving_person VARCHAR(150) NULL,
    notes TEXT NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_hire_dispatch_contract_asset (contract_asset_id),
    INDEX idx_hire_dispatch_contract_date (contract_id, dispatch_datetime),
    INDEX idx_hire_dispatch_location_date (hire_location_id, dispatch_datetime),

    CONSTRAINT fk_hire_dispatch_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_dispatch_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_dispatch_contract_asset
        FOREIGN KEY (contract_asset_id) REFERENCES hire_contract_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_dispatch_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_work_logs
CREATE TABLE hire_work_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    contract_id INT NOT NULL,
    contract_asset_id INT NOT NULL,
    asset_id INT NOT NULL,
    work_date DATE NOT NULL,
    start_meter DECIMAL(14,2) NOT NULL,
    end_meter DECIMAL(14,2) NOT NULL,
    billable_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    idle_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    breakdown_hours DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    fuel_litres DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    work_description TEXT NULL,
    customer_representative VARCHAR(150) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_hire_work_log (contract_asset_id, work_date),
    INDEX idx_hire_work_contract_date (contract_id, work_date),
    INDEX idx_hire_work_location_date (hire_location_id, work_date),
    INDEX idx_hire_work_asset_date (asset_id, work_date),
    INDEX idx_hire_work_status (status),

    CONSTRAINT fk_hire_work_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_work_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_work_contract_asset
        FOREIGN KEY (contract_asset_id) REFERENCES hire_contract_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_work_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_work_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_work_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_invoices
CREATE TABLE hire_invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    invoice_number VARCHAR(80) NOT NULL UNIQUE,
    contract_id INT NOT NULL,
    customer_id INT NOT NULL,
    invoice_date DATE NOT NULL,
    due_date DATE NULL,
    period_start DATE NULL,
    period_end DATE NULL,
    billable_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    rate DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    base_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    mobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    demobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    operator_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    other_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'issued',
    notes TEXT NULL,
    created_by INT NULL,
    issued_by INT NULL,
    issued_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_hire_invoice_contract (contract_id),
    INDEX idx_hire_invoice_location_date (hire_location_id, invoice_date),
    INDEX idx_hire_invoice_customer_status (customer_id, status),
    INDEX idx_hire_invoice_due_date (due_date),

    CONSTRAINT fk_hire_invoice_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_invoice_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_invoice_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_invoice_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_invoice_issued_by
        FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_invoice_lines
CREATE TABLE hire_invoice_lines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id INT NOT NULL,
    work_log_id INT NULL,
    contract_asset_id INT NULL,
    asset_id INT NULL,
    description VARCHAR(255) NOT NULL,
    quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    unit_rate DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    line_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_hire_invoice_line_work_log (work_log_id),
    INDEX idx_hire_invoice_line_invoice (invoice_id),
    INDEX idx_hire_invoice_line_asset (asset_id),

    CONSTRAINT fk_hire_invoice_line_invoice
        FOREIGN KEY (invoice_id) REFERENCES hire_invoices(id) ON DELETE CASCADE,
    CONSTRAINT fk_hire_invoice_line_work_log
        FOREIGN KEY (work_log_id) REFERENCES hire_work_logs(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_invoice_line_contract_asset
        FOREIGN KEY (contract_asset_id) REFERENCES hire_contract_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_invoice_line_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE SET NULL
);

-- hire_payments
CREATE TABLE hire_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    invoice_id INT NULL,
    contract_id INT NOT NULL,
    customer_id INT NOT NULL,
    payment_date DATETIME NOT NULL,
    payment_category VARCHAR(30) NOT NULL DEFAULT 'invoice',
    amount DECIMAL(14,2) NOT NULL,
    payment_method VARCHAR(40) NOT NULL,
    reference_number VARCHAR(120) NULL,
    notes TEXT NULL,
    received_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_hire_payment_invoice (invoice_id),
    INDEX idx_hire_payment_location_date (hire_location_id, payment_date),
    INDEX idx_hire_payment_contract (contract_id),
    INDEX idx_hire_payment_customer_date (customer_id, payment_date),

    CONSTRAINT fk_hire_payment_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_payment_invoice
        FOREIGN KEY (invoice_id) REFERENCES hire_invoices(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_payment_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_payment_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_payment_received_by
        FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL
);

-- hire_return_inspections
CREATE TABLE hire_return_inspections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    contract_id INT NOT NULL,
    contract_asset_id INT NOT NULL,
    return_datetime DATETIME NOT NULL,
    closing_meter DECIMAL(14,2) NOT NULL,
    fuel_level_percent DECIMAL(5,2) NULL,
    condition_status VARCHAR(30) NOT NULL,
    damage_details TEXT NULL,
    missing_items TEXT NULL,
    estimated_damage_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    customer_representative VARCHAR(150) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'completed',
    notes TEXT NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_hire_return_contract_asset (contract_asset_id),
    INDEX idx_hire_return_contract_date (contract_id, return_datetime),
    INDEX idx_hire_return_location_date (hire_location_id, return_datetime),

    CONSTRAINT fk_hire_return_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_return_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_return_contract_asset
        FOREIGN KEY (contract_asset_id) REFERENCES hire_contract_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_return_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- EQUIPMENT HIRE LOCATION CONSISTENCY TRIGGERS
-- Created only after all parent and target tables exist.
-- ============================================================

DELIMITER $$

DROP TRIGGER IF EXISTS trg_hire_enquiry_location_before_insert $$
CREATE TRIGGER trg_hire_enquiry_location_before_insert
BEFORE INSERT ON hire_enquiries
FOR EACH ROW
BEGIN
  DECLARE inherited_location_id INT DEFAULT NULL;
  DECLARE valid_location_count INT DEFAULT 0;

  IF NEW.hire_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Equipment Hire location is required for an enquiry.';
  END IF;

  SELECT COUNT(*)
  INTO valid_location_count
  FROM business_locations bl
  INNER JOIN business_units bu ON bu.id = bl.business_unit_id
  WHERE bl.id = NEW.hire_location_id
    AND bl.is_active = TRUE
    AND bu.code = 'equipment_hire'
    AND bu.is_enabled = TRUE;

  IF valid_location_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected location is not an active Equipment Hire location.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_quotation_location_before_insert $$
CREATE TRIGGER trg_hire_quotation_location_before_insert
BEFORE INSERT ON hire_quotations
FOR EACH ROW
BEGIN
  DECLARE inherited_location_id INT DEFAULT NULL;
  DECLARE valid_location_count INT DEFAULT 0;

  IF NEW.enquiry_id IS NOT NULL THEN
    SET inherited_location_id = (
      SELECT hire_location_id
      FROM hire_enquiries
      WHERE id = NEW.enquiry_id
      LIMIT 1
    );

    IF inherited_location_id IS NOT NULL THEN
      IF NEW.hire_location_id IS NULL THEN
        SET NEW.hire_location_id = inherited_location_id;
      ELSEIF NEW.hire_location_id <> inherited_location_id THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Quotation location must match the linked record location.';
      END IF;
    END IF;
  END IF;

  IF NEW.hire_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Equipment Hire location is required for quotation.';
  END IF;

  SELECT COUNT(*)
  INTO valid_location_count
  FROM business_locations bl
  INNER JOIN business_units bu ON bu.id = bl.business_unit_id
  WHERE bl.id = NEW.hire_location_id
    AND bl.is_active = TRUE
    AND bu.code = 'equipment_hire'
    AND bu.is_enabled = TRUE;

  IF valid_location_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected location is not an active Equipment Hire location.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_contract_location_before_insert $$
CREATE TRIGGER trg_hire_contract_location_before_insert
BEFORE INSERT ON hire_contracts
FOR EACH ROW
BEGIN
  DECLARE inherited_location_id INT DEFAULT NULL;
  DECLARE valid_location_count INT DEFAULT 0;

  IF NEW.quotation_id IS NOT NULL THEN
    SET inherited_location_id = (
      SELECT hire_location_id
      FROM hire_quotations
      WHERE id = NEW.quotation_id
      LIMIT 1
    );

    IF inherited_location_id IS NOT NULL THEN
      IF NEW.hire_location_id IS NULL THEN
        SET NEW.hire_location_id = inherited_location_id;
      ELSEIF NEW.hire_location_id <> inherited_location_id THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Contract location must match the linked record location.';
      END IF;
    END IF;
  END IF;

  IF NEW.hire_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Equipment Hire location is required for contract.';
  END IF;

  SELECT COUNT(*)
  INTO valid_location_count
  FROM business_locations bl
  INNER JOIN business_units bu ON bu.id = bl.business_unit_id
  WHERE bl.id = NEW.hire_location_id
    AND bl.is_active = TRUE
    AND bu.code = 'equipment_hire'
    AND bu.is_enabled = TRUE;

  IF valid_location_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected location is not an active Equipment Hire location.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_dispatch_location_before_insert $$
CREATE TRIGGER trg_hire_dispatch_location_before_insert
BEFORE INSERT ON hire_dispatches
FOR EACH ROW
BEGIN
  DECLARE inherited_location_id INT DEFAULT NULL;
  DECLARE valid_location_count INT DEFAULT 0;

  SET inherited_location_id = (
    SELECT hire_location_id
    FROM hire_contracts
    WHERE id = NEW.contract_id
    LIMIT 1
  );

  IF NEW.hire_location_id IS NULL THEN
    SET NEW.hire_location_id = inherited_location_id;
  ELSEIF inherited_location_id IS NOT NULL
     AND NEW.hire_location_id <> inherited_location_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Dispatch location must match the contract location.';
  END IF;

  IF NEW.hire_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Equipment Hire location is required for dispatch.';
  END IF;

  SELECT COUNT(*)
  INTO valid_location_count
  FROM business_locations bl
  INNER JOIN business_units bu ON bu.id = bl.business_unit_id
  WHERE bl.id = NEW.hire_location_id
    AND bl.is_active = TRUE
    AND bu.code = 'equipment_hire'
    AND bu.is_enabled = TRUE;

  IF valid_location_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected location is not an active Equipment Hire location.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_work_location_before_insert $$
CREATE TRIGGER trg_hire_work_location_before_insert
BEFORE INSERT ON hire_work_logs
FOR EACH ROW
BEGIN
  DECLARE inherited_location_id INT DEFAULT NULL;
  DECLARE valid_location_count INT DEFAULT 0;

  SET inherited_location_id = (
    SELECT hire_location_id
    FROM hire_contracts
    WHERE id = NEW.contract_id
    LIMIT 1
  );

  IF NEW.hire_location_id IS NULL THEN
    SET NEW.hire_location_id = inherited_location_id;
  ELSEIF inherited_location_id IS NOT NULL
     AND NEW.hire_location_id <> inherited_location_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Work log location must match the contract location.';
  END IF;

  IF NEW.hire_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Equipment Hire location is required for work log.';
  END IF;

  SELECT COUNT(*)
  INTO valid_location_count
  FROM business_locations bl
  INNER JOIN business_units bu ON bu.id = bl.business_unit_id
  WHERE bl.id = NEW.hire_location_id
    AND bl.is_active = TRUE
    AND bu.code = 'equipment_hire'
    AND bu.is_enabled = TRUE;

  IF valid_location_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected location is not an active Equipment Hire location.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_invoice_location_before_insert $$
CREATE TRIGGER trg_hire_invoice_location_before_insert
BEFORE INSERT ON hire_invoices
FOR EACH ROW
BEGIN
  DECLARE inherited_location_id INT DEFAULT NULL;
  DECLARE valid_location_count INT DEFAULT 0;

  SET inherited_location_id = (
    SELECT hire_location_id
    FROM hire_contracts
    WHERE id = NEW.contract_id
    LIMIT 1
  );

  IF NEW.hire_location_id IS NULL THEN
    SET NEW.hire_location_id = inherited_location_id;
  ELSEIF inherited_location_id IS NOT NULL
     AND NEW.hire_location_id <> inherited_location_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Invoice location must match the contract location.';
  END IF;

  IF NEW.hire_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Equipment Hire location is required for invoice.';
  END IF;

  SELECT COUNT(*)
  INTO valid_location_count
  FROM business_locations bl
  INNER JOIN business_units bu ON bu.id = bl.business_unit_id
  WHERE bl.id = NEW.hire_location_id
    AND bl.is_active = TRUE
    AND bu.code = 'equipment_hire'
    AND bu.is_enabled = TRUE;

  IF valid_location_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected location is not an active Equipment Hire location.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_payment_location_before_insert $$
CREATE TRIGGER trg_hire_payment_location_before_insert
BEFORE INSERT ON hire_payments
FOR EACH ROW
BEGIN
  DECLARE inherited_location_id INT DEFAULT NULL;
  DECLARE valid_location_count INT DEFAULT 0;

  SET inherited_location_id = (
    SELECT hire_location_id
    FROM hire_contracts
    WHERE id = NEW.contract_id
    LIMIT 1
  );

  IF NEW.hire_location_id IS NULL THEN
    SET NEW.hire_location_id = inherited_location_id;
  ELSEIF inherited_location_id IS NOT NULL
     AND NEW.hire_location_id <> inherited_location_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Payment location must match the contract location.';
  END IF;

  IF NEW.hire_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Equipment Hire location is required for payment.';
  END IF;

  SELECT COUNT(*)
  INTO valid_location_count
  FROM business_locations bl
  INNER JOIN business_units bu ON bu.id = bl.business_unit_id
  WHERE bl.id = NEW.hire_location_id
    AND bl.is_active = TRUE
    AND bu.code = 'equipment_hire'
    AND bu.is_enabled = TRUE;

  IF valid_location_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected location is not an active Equipment Hire location.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_return_location_before_insert $$
CREATE TRIGGER trg_hire_return_location_before_insert
BEFORE INSERT ON hire_return_inspections
FOR EACH ROW
BEGIN
  DECLARE inherited_location_id INT DEFAULT NULL;
  DECLARE valid_location_count INT DEFAULT 0;

  SET inherited_location_id = (
    SELECT hire_location_id
    FROM hire_contracts
    WHERE id = NEW.contract_id
    LIMIT 1
  );

  IF NEW.hire_location_id IS NULL THEN
    SET NEW.hire_location_id = inherited_location_id;
  ELSEIF inherited_location_id IS NOT NULL
     AND NEW.hire_location_id <> inherited_location_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Return inspection location must match the contract location.';
  END IF;

  IF NEW.hire_location_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Equipment Hire location is required for return inspection.';
  END IF;

  SELECT COUNT(*)
  INTO valid_location_count
  FROM business_locations bl
  INNER JOIN business_units bu ON bu.id = bl.business_unit_id
  WHERE bl.id = NEW.hire_location_id
    AND bl.is_active = TRUE
    AND bu.code = 'equipment_hire'
    AND bu.is_enabled = TRUE;

  IF valid_location_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'The selected location is not an active Equipment Hire location.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_enquiry_location_before_update $$
CREATE TRIGGER trg_hire_enquiry_location_before_update
BEFORE UPDATE ON hire_enquiries
FOR EACH ROW
BEGIN
  IF NOT (NEW.hire_location_id <=> OLD.hire_location_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Enquiry Equipment Hire location cannot be changed after creation.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_quotation_location_before_update $$
CREATE TRIGGER trg_hire_quotation_location_before_update
BEFORE UPDATE ON hire_quotations
FOR EACH ROW
BEGIN
  IF NOT (NEW.hire_location_id <=> OLD.hire_location_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Quotation Equipment Hire location cannot be changed after creation.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_contract_location_before_update $$
CREATE TRIGGER trg_hire_contract_location_before_update
BEFORE UPDATE ON hire_contracts
FOR EACH ROW
BEGIN
  IF NOT (NEW.hire_location_id <=> OLD.hire_location_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Contract Equipment Hire location cannot be changed after creation.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_dispatch_location_before_update $$
CREATE TRIGGER trg_hire_dispatch_location_before_update
BEFORE UPDATE ON hire_dispatches
FOR EACH ROW
BEGIN
  IF NOT (NEW.hire_location_id <=> OLD.hire_location_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Dispatch Equipment Hire location cannot be changed after creation.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_work_location_before_update $$
CREATE TRIGGER trg_hire_work_location_before_update
BEFORE UPDATE ON hire_work_logs
FOR EACH ROW
BEGIN
  IF NOT (NEW.hire_location_id <=> OLD.hire_location_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Work log Equipment Hire location cannot be changed after creation.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_invoice_location_before_update $$
CREATE TRIGGER trg_hire_invoice_location_before_update
BEFORE UPDATE ON hire_invoices
FOR EACH ROW
BEGIN
  IF NOT (NEW.hire_location_id <=> OLD.hire_location_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Invoice Equipment Hire location cannot be changed after creation.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_payment_location_before_update $$
CREATE TRIGGER trg_hire_payment_location_before_update
BEFORE UPDATE ON hire_payments
FOR EACH ROW
BEGIN
  IF NOT (NEW.hire_location_id <=> OLD.hire_location_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Payment Equipment Hire location cannot be changed after creation.';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_return_location_before_update $$
CREATE TRIGGER trg_hire_return_location_before_update
BEFORE UPDATE ON hire_return_inspections
FOR EACH ROW
BEGIN
  IF NOT (NEW.hire_location_id <=> OLD.hire_location_id) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Return inspection Equipment Hire location cannot be changed after creation.';
  END IF;
END $$

DELIMITER ;

SELECT 'CLEAN MASTER SCHEMA FINISHED' AS result;
