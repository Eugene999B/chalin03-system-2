-- CHALIN 03 SALES & INVENTORY MANAGEMENT SYSTEM
-- Version 2 Multi-Store Database Schema
-- Prepared for: Chalin 03 Company Limited
-- Store 1: Chalin 03 Main Store - Dunkwa Police Barrier
-- Store 2: Chalin 03 Store - Ajakaa Manso
--
-- WARNING:
-- This file recreates the database from scratch.
-- It will delete all existing data in chalin03_db.
-- Only run the full file when you intentionally want to reset the database.
--
-- Default login after fresh import:
-- Username: admin
-- Password: admin123
-- Change this password immediately after first login.

DROP DATABASE IF EXISTS chalin03_db;
CREATE DATABASE chalin03_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE chalin03_db;

-- =========================
-- 1. BRANCHES / STORES TABLE
-- =========================
CREATE TABLE branches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    location VARCHAR(255),
    phone VARCHAR(50),
    manager_name VARCHAR(150),
    is_head_office BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_branch_code (branch_code),
    INDEX idx_branch_name (name),
    INDEX idx_branch_active (is_active)
);

-- =========================
-- 2. USERS TABLE
-- =========================
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'manager', 'cashier') NOT NULL DEFAULT 'cashier',
    phone VARCHAR(30),
    default_branch_id INT NULL,
    can_access_all_branches BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (default_branch_id) REFERENCES branches(id) ON DELETE SET NULL,

    INDEX idx_user_role (role),
    INDEX idx_user_active (is_active),
    INDEX idx_user_default_branch (default_branch_id),
    INDEX idx_user_all_branches (can_access_all_branches)
);

-- =========================
-- 3. USER BRANCH ACCESS TABLE
-- =========================
CREATE TABLE user_branch_access (
    user_id INT NOT NULL,
    branch_id INT NOT NULL,
    access_role ENUM('admin', 'manager', 'cashier') NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, branch_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,

    INDEX idx_user_branch_access_branch (branch_id),
    INDEX idx_user_branch_access_primary (is_primary)
);

-- =========================
-- 4. PRODUCTS TABLE
-- =========================
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

-- =========================
-- 5. STOCK ADJUSTMENTS TABLE
-- =========================
CREATE TABLE stock_adjustments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    product_id INT NOT NULL,
    adjustment_type ENUM('increase', 'decrease', 'set') NOT NULL,
    quantity INT NOT NULL,
    old_quantity INT NOT NULL,
    new_quantity INT NOT NULL,
    reason TEXT NOT NULL,
    adjusted_by INT,
    adjusted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (adjusted_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_stock_adjustment_branch (branch_id),
    INDEX idx_stock_adjustment_product (product_id),
    INDEX idx_stock_adjustment_type (adjustment_type),
    INDEX idx_stock_adjustment_date (adjusted_at),
    INDEX idx_stock_adjustment_user (adjusted_by)
);

-- =========================
-- 6. SUPPLIERS TABLE
-- =========================
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

-- =========================
-- 7. PURCHASES TABLE
-- =========================
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

-- =========================
-- 8. PURCHASE ITEMS TABLE
-- =========================
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

-- =========================
-- 9. PURCHASE PAYMENTS TABLE
-- =========================
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

-- =========================
-- 10. CUSTOMERS TABLE
-- =========================
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

-- =========================
-- 11. SALES TABLE
-- =========================
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
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    sale_status ENUM('completed', 'returned', 'cancelled') NOT NULL DEFAULT 'completed',

    is_voided TINYINT(1) NOT NULL DEFAULT 0,
    void_reason TEXT NULL,
    voided_by INT NULL,
    voided_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_sale_branch (branch_id),
    INDEX idx_receipt_number (receipt_number),
    INDEX idx_sale_customer (customer_id),
    INDEX idx_sale_staff (staff_id),
    INDEX idx_sale_date (created_at),
    INDEX idx_payment_type (payment_type),
    INDEX idx_sale_status (sale_status),
    INDEX idx_sale_voided (is_voided)
);

-- =========================
-- 12. SALE ITEMS TABLE
-- =========================
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

-- =========================
-- 13. DEBTS TABLE
-- =========================
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

-- =========================
-- 14. DEBT PAYMENTS TABLE
-- =========================
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

-- =========================
-- 15. RETURNS TABLE
-- =========================
CREATE TABLE returns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    reason TEXT,
    returned_by INT,
    returned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    FOREIGN KEY (returned_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_returns_branch (branch_id),
    INDEX idx_returns_sale (sale_id),
    INDEX idx_returns_product (product_id),
    INDEX idx_returns_date (returned_at),
    INDEX idx_returns_user (returned_by)
);

-- =========================
-- 16. EXPENSES TABLE
-- =========================
CREATE TABLE expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    category VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    description TEXT,
    expense_date DATE NOT NULL,
    recorded_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_expense_branch (branch_id),
    INDEX idx_expense_date (expense_date),
    INDEX idx_expense_category (category),
    INDEX idx_expense_user (recorded_by)
);

-- =========================
-- 17. SMS LOG TABLE
-- =========================
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
        'other'
    ) NOT NULL DEFAULT 'other',
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    provider_response TEXT,
    sent_by INT NULL,
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_sms_branch (branch_id),
    INDEX idx_sms_type (sms_type),
    INDEX idx_sms_status (status),
    INDEX idx_sms_sent_by (sent_by),
    INDEX idx_sms_created_at (created_at)
);

-- =========================
-- 18. ACTIVITY LOG TABLE
-- =========================
CREATE TABLE activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NULL,
    user_id INT,
    action VARCHAR(150) NOT NULL,
    details TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_activity_branch (branch_id),
    INDEX idx_activity_action (action),
    INDEX idx_activity_date (created_at),
    INDEX idx_activity_user (user_id)
);

-- =========================
-- 19. SETTINGS TABLE
-- =========================
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

-- =========================
-- 20. DAILY CLOSINGS TABLE
-- =========================
CREATE TABLE daily_closings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL DEFAULT 1,
    closing_date DATE NOT NULL,

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

    difference_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    notes TEXT,
    closed_by INT,
    closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,

    UNIQUE KEY unique_daily_closing_branch_date (branch_id, closing_date),
    INDEX idx_daily_closing_branch (branch_id),
    INDEX idx_daily_closing_date (closing_date),
    INDEX idx_daily_closing_user (closed_by)
);

-- =========================
-- 21. AUDIT SIGN-OFFS TABLE
-- =========================
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

-- =========================
-- 22. AUDIT UNLOCK REQUESTS TABLE
-- =========================
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

-- =========================
-- 23. AUDIT RE-APPROVAL LOG TABLE
-- =========================
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

-- =========================
-- DEFAULT DATA
-- =========================

INSERT INTO branches (
    id,
    branch_code,
    name,
    location,
    phone,
    manager_name,
    is_head_office,
    is_active
) VALUES
(
    1,
    'MAIN',
    'Chalin 03 Main Store',
    'Dunkwa Police Barrier',
    '0249469080 / 0249995510',
    NULL,
    TRUE,
    TRUE
),
(
    2,
    'AJAKAA',
    'Chalin 03 Store',
    'Ajakaa Manso',
    '0249469080 / 0249995510',
    NULL,
    FALSE,
    TRUE
);

INSERT INTO users (
    id,
    full_name,
    username,
    password_hash,
    role,
    phone,
    default_branch_id,
    can_access_all_branches,
    is_active
) VALUES (
    1,
    'System Administrator',
    'admin',
    '$2b$10$5KI9kuJtv1w6CzEDy7m/3OlEIHMftt5.BMLa/duLZZ.sro6VOEHBy',
    'admin',
    NULL,
    1,
    TRUE,
    TRUE
);

INSERT INTO user_branch_access (
    user_id,
    branch_id,
    access_role,
    is_primary
) VALUES
(1, 1, 'admin', TRUE),
(1, 2, 'admin', FALSE);

INSERT INTO settings (
    branch_id,
    business_name,
    branch_name,
    business_address,
    business_phone,
    owner_phone,
    receipt_prefix,
    tax_rate,
    debt_reminder_days,
    daily_summary_time,
    receipt_footer
) VALUES
(
    1,
    'Chalin 03 Company Limited',
    'Chalin 03 Main Store',
    'Dunkwa Police Barrier',
    '0249469080 / 0249995510',
    '0543421127',
    'CHL-MAIN',
    0.00,
    7,
    '18:00:00',
    'Thank You For Coming'
),
(
    2,
    'Chalin 03 Company Limited',
    'Chalin 03 Store',
    'Ajakaa Manso',
    '0249469080 / 0249995510',
    '0543421127',
    'CHL-AJM',
    0.00,
    7,
    '18:00:00',
    'Thank You For Coming'
);

-- =========================
-- MULTI-STORE QUICK CHECKS
-- =========================
SELECT id, branch_code, name, location, is_active
FROM branches
ORDER BY id;

SELECT
    u.id,
    u.full_name,
    u.username,
    u.role,
    u.default_branch_id,
    u.can_access_all_branches,
    b.name AS default_branch_name
FROM users u
LEFT JOIN branches b ON u.default_branch_id = b.id
ORDER BY u.id;

SELECT
    s.id,
    s.branch_id,
    b.name AS branch_name,
    s.business_name,
    s.branch_name,
    s.business_address,
    s.receipt_prefix
FROM settings s
JOIN branches b ON s.branch_id = b.id
ORDER BY s.branch_id;
