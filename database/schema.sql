-- CHALIN 03 SALES & INVENTORY MANAGEMENT SYSTEM
-- Database Schema
-- WARNING:
-- This file recreates the database from scratch.
-- It will delete all existing data in chalin03_db.
-- Only run the full file when you intentionally want to reset the database.

DROP DATABASE IF EXISTS chalin03_db;
CREATE DATABASE chalin03_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE chalin03_db;

-- =========================
-- 1. USERS TABLE
-- =========================
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'manager', 'cashier') NOT NULL DEFAULT 'cashier',
    phone VARCHAR(30),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_role (role),
    INDEX idx_user_active (is_active)
);

-- =========================
-- 2. PRODUCTS TABLE
-- =========================
CREATE TABLE products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    size VARCHAR(80),
    category VARCHAR(100),
    cost_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    selling_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    quantity INT NOT NULL DEFAULT 0,
    low_stock_threshold INT NOT NULL DEFAULT 5,
    barcode VARCHAR(100) UNIQUE,
    image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_product_name (name),
    INDEX idx_product_category (category),
    INDEX idx_product_barcode (barcode),
    INDEX idx_product_active (is_active),
    INDEX idx_product_low_stock (quantity, low_stock_threshold)
);

-- =========================
-- 3. STOCK ADJUSTMENTS TABLE
-- =========================
CREATE TABLE stock_adjustments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    adjustment_type ENUM('increase', 'decrease', 'set') NOT NULL,
    quantity INT NOT NULL,
    old_quantity INT NOT NULL,
    new_quantity INT NOT NULL,
    reason TEXT NOT NULL,
    adjusted_by INT,
    adjusted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (adjusted_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_stock_adjustment_product (product_id),
    INDEX idx_stock_adjustment_type (adjustment_type),
    INDEX idx_stock_adjustment_date (adjusted_at),
    INDEX idx_stock_adjustment_user (adjusted_by)
);

-- =========================
-- 4. SUPPLIERS TABLE
-- =========================
CREATE TABLE suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(150),
    phone VARCHAR(30),
    email VARCHAR(150),
    address TEXT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_supplier_name (name),
    INDEX idx_supplier_phone (phone),
    INDEX idx_supplier_active (is_active)
);

-- =========================
-- 5. PURCHASES TABLE
-- =========================
CREATE TABLE purchases (
    id INT AUTO_INCREMENT PRIMARY KEY,
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

    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_purchase_supplier (supplier_id),
    INDEX idx_purchase_date (purchase_date),
    INDEX idx_purchase_invoice (invoice_number),
    INDEX idx_purchase_payment_status (payment_status)
);

-- =========================
-- 6. PURCHASE ITEMS TABLE
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
-- 7. PURCHASE PAYMENTS TABLE
-- =========================
CREATE TABLE purchase_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method ENUM('cash', 'momo', 'bank', 'mixed', 'other') NOT NULL DEFAULT 'cash',
    paid_by INT,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,

    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_purchase_payment_purchase (purchase_id),
    INDEX idx_purchase_payment_date (paid_at),
    INDEX idx_purchase_payment_method (payment_method),
    INDEX idx_purchase_payment_user (paid_by)
);

-- =========================
-- 8. CUSTOMERS TABLE
-- =========================
CREATE TABLE customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    location VARCHAR(150),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_customer_name (name),
    INDEX idx_customer_phone (phone)
);

-- =========================
-- 9. SALES TABLE
-- =========================
CREATE TABLE sales (
    id INT AUTO_INCREMENT PRIMARY KEY,
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

    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_receipt_number (receipt_number),
    INDEX idx_sale_customer (customer_id),
    INDEX idx_sale_staff (staff_id),
    INDEX idx_sale_date (created_at),
    INDEX idx_payment_type (payment_type),
    INDEX idx_sale_status (sale_status),
    INDEX idx_sale_voided (is_voided)
);

-- =========================
-- 10. SALE ITEMS TABLE
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
-- 11. DEBTS TABLE
-- =========================
CREATE TABLE debts (
    id INT AUTO_INCREMENT PRIMARY KEY,
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

    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,

    INDEX idx_debt_sale (sale_id),
    INDEX idx_debt_customer (customer_id),
    INDEX idx_debt_status (status),
    INDEX idx_due_date (due_date),
    INDEX idx_debt_customer_phone (customer_phone)
);

-- =========================
-- 12. DEBT PAYMENTS TABLE
-- =========================
CREATE TABLE debt_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    debt_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method ENUM('cash', 'momo', 'bank') NOT NULL DEFAULT 'cash',
    received_by INT,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,

    FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE CASCADE,
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_debt_payment_debt (debt_id),
    INDEX idx_debt_payment_date (paid_at),
    INDEX idx_debt_payment_method (payment_method),
    INDEX idx_debt_payment_receiver (received_by)
);

-- =========================
-- 13. RETURNS TABLE
-- =========================
CREATE TABLE returns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    reason TEXT,
    returned_by INT,
    returned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    FOREIGN KEY (returned_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_returns_sale (sale_id),
    INDEX idx_returns_product (product_id),
    INDEX idx_returns_date (returned_at),
    INDEX idx_returns_user (returned_by)
);

-- =========================
-- 14. EXPENSES TABLE
-- =========================
CREATE TABLE expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    description TEXT,
    expense_date DATE NOT NULL,
    recorded_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_expense_date (expense_date),
    INDEX idx_expense_category (category),
    INDEX idx_expense_user (recorded_by)
);

-- =========================
-- 15. SMS LOG TABLE
-- =========================
CREATE TABLE sms_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
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
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_sms_type (sms_type),
    INDEX idx_sms_status (status),
    INDEX idx_sms_created_at (created_at)
);

-- =========================
-- 16. ACTIVITY LOG TABLE
-- =========================
CREATE TABLE activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(150) NOT NULL,
    details TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_activity_action (action),
    INDEX idx_activity_date (created_at),
    INDEX idx_activity_user (user_id)
);

-- =========================
-- 17. SETTINGS TABLE
-- =========================
CREATE TABLE settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_name VARCHAR(150) NOT NULL DEFAULT 'Chalin 03 Company Limited',
    business_address VARCHAR(255) DEFAULT 'Dunkwa Police Barrier',
    business_phone VARCHAR(50) DEFAULT '0249469080 / 0249995510',
    owner_phone VARCHAR(50) DEFAULT '0543421127',
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    debt_reminder_days INT NOT NULL DEFAULT 7,
    daily_summary_time TIME DEFAULT '18:00:00',
    receipt_footer VARCHAR(255) DEFAULT 'Thank You For Coming',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =========================
-- 18. DAILY CLOSINGS TABLE
-- =========================
CREATE TABLE daily_closings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    closing_date DATE NOT NULL UNIQUE,

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

    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_daily_closing_date (closing_date),
    INDEX idx_daily_closing_user (closed_by)
);

-- =========================
-- 19. AUDIT SIGN-OFFS TABLE
-- =========================
CREATE TABLE audit_signoffs (
    id INT AUTO_INCREMENT PRIMARY KEY,

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

    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_audit_signoff_period_type (period_type),
    INDEX idx_audit_signoff_period_dates (period_start, period_end),
    INDEX idx_audit_signoff_status (period_status),
    INDEX idx_audit_signoff_created_by (created_by),
    INDEX idx_audit_signoff_approved_by (approved_by),
    INDEX idx_audit_signoff_created_at (created_at)
);

-- =========================
-- DEFAULT DATA
-- =========================

INSERT INTO users (
    full_name,
    username,
    password_hash,
    role,
    phone,
    is_active
) VALUES (
    'System Administrator',
    'admin',
    'TEMP_PASSWORD_HASH_CHANGE_LATER',
    'admin',
    NULL,
    TRUE
);

INSERT INTO settings (
    business_name,
    business_address,
    business_phone,
    owner_phone,
    tax_rate,
    debt_reminder_days,
    daily_summary_time,
    receipt_footer
) VALUES (
    'Chalin 03 Company Limited',
    'Dunkwa Police Barrier',
    '0249469080 / 0249995510',
    '0543421127',
    0.00,
    7,
    '18:00:00',
    'Thank You For Coming'
);