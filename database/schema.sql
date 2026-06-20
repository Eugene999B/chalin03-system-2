-- CHALIN 03 SALES & INVENTORY MANAGEMENT SYSTEM
-- Database Schema
-- Step 1: Database structure

DROP DATABASE IF EXISTS chalin03_db;
CREATE DATABASE chalin03_db;
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
    INDEX idx_product_barcode (barcode)
);

-- =========================
-- 3. SUPPLIERS TABLE
-- =========================
CREATE TABLE suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    location VARCHAR(150),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =========================
-- 4. PURCHASES TABLE
-- =========================
CREATE TABLE purchases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_id INT,
    total_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    purchase_date DATE NOT NULL,
    notes TEXT,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_purchase_date (purchase_date)
);

-- =========================
-- 5. PURCHASE ITEMS TABLE
-- =========================
CREATE TABLE purchase_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_cost DECIMAL(12,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,

    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- =========================
-- 6. CUSTOMERS TABLE
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
-- 7. SALES TABLE
-- =========================
CREATE TABLE sales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    receipt_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id INT,
    customer_name VARCHAR(150),
    customer_phone VARCHAR(30),
    staff_id INT,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_type ENUM('cash', 'momo', 'bank', 'credit', 'mixed') NOT NULL DEFAULT 'cash',
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    sale_status ENUM('completed', 'returned', 'cancelled') NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_receipt_number (receipt_number),
    INDEX idx_sale_date (created_at),
    INDEX idx_payment_type (payment_type)
);

-- =========================
-- 8. SALE ITEMS TABLE
-- =========================
CREATE TABLE sale_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,

    -- Very important for profit history
    cost_price_at_sale DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- =========================
-- 9. DEBTS TABLE
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
    INDEX idx_debt_status (status),
    INDEX idx_due_date (due_date)
);

-- =========================
-- 10. DEBT PAYMENTS TABLE
-- =========================
CREATE TABLE debt_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    debt_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    payment_method ENUM('cash', 'momo', 'bank') NOT NULL DEFAULT 'cash',
    received_by INT,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,

    FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE CASCADE,
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL
);

-- =========================
-- 11. RETURNS TABLE
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
    FOREIGN KEY (returned_by) REFERENCES users(id) ON DELETE SET NULL
);

-- =========================
-- 12. EXPENSES TABLE
-- =========================
CREATE TABLE expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    description TEXT,
    expense_date DATE NOT NULL,
    recorded_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_expense_date (expense_date),
    INDEX idx_expense_category (category)
);

-- =========================
-- 13. SMS LOG TABLE
-- =========================
CREATE TABLE sms_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    recipient_phone VARCHAR(30) NOT NULL,
    message TEXT NOT NULL,
    sms_type ENUM('receipt', 'debt_reminder', 'low_stock', 'daily_summary', 'sale_confirmation', 'other') NOT NULL DEFAULT 'other',
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    provider_response TEXT,
    sent_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_sms_type (sms_type),
    INDEX idx_sms_status (status)
);

-- =========================
-- 14. ACTIVITY LOG TABLE
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
    INDEX idx_activity_date (created_at)
);

-- =========================
-- 15. SETTINGS TABLE
-- =========================
CREATE TABLE settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    business_name VARCHAR(150) NOT NULL DEFAULT 'Chalin 03 Company Limited',
    business_address VARCHAR(255) DEFAULT 'Dunkwa Police Barrier',
    business_phone VARCHAR(30),
    owner_phone VARCHAR(30),
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    debt_reminder_days INT NOT NULL DEFAULT 7,
    daily_summary_time TIME DEFAULT '18:00:00',
    receipt_footer VARCHAR(255) DEFAULT 'Thank you for doing business with us.',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- =========================
-- DEFAULT DATA
-- =========================

-- This is a temporary admin user placeholder.
-- Later, we will create a proper hashed password using bcrypt.
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
    NULL,
    NULL,
    0.00,
    7,
    '18:00:00',
    'Thank you for doing business with Chalin 03.'
);