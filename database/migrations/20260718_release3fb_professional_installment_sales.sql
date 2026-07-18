-- CHALIN 03 RELEASE 3F-B
-- Professional Installment Sales, Payment Scheduling and Reminder Controls.
-- ADDITIVE / IDEMPOTENT MIGRATION ONLY.
-- Existing sales, stock, debts, payments and accounting evidence are preserved.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

ALTER TABLE sales
    MODIFY COLUMN payment_type ENUM(
        'cash',
        'momo',
        'bank',
        'credit',
        'mixed',
        'installment'
    ) NOT NULL DEFAULT 'cash';

CREATE TABLE IF NOT EXISTS installment_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    default_frequency ENUM('weekly','fortnightly','monthly','custom') NOT NULL DEFAULT 'monthly',
    default_installment_count INT NOT NULL DEFAULT 3,
    default_grace_days INT NOT NULL DEFAULT 3,
    reminder_days_before INT NOT NULL DEFAULT 3,
    overdue_reminder_days VARCHAR(80) NOT NULL DEFAULT '1,3,7',
    late_charge_type ENUM('none','fixed','percentage') NOT NULL DEFAULT 'none',
    late_charge_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    require_manager_approval BOOLEAN NOT NULL DEFAULT FALSE,
    default_delivery_policy ENUM('immediate','after_full_payment') NOT NULL DEFAULT 'immediate',
    sms_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_installment_settings_branch (branch_id),
    CONSTRAINT fk_installment_settings_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_settings_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_settings_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS installment_sequences (
    branch_id INT NOT NULL,
    sequence_year INT NOT NULL,
    last_number INT NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (branch_id, sequence_year),
    CONSTRAINT fk_installment_sequences_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS installment_agreements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    agreement_number VARCHAR(80) NOT NULL,
    sale_id INT NOT NULL,
    debt_id INT NULL,
    customer_id INT NULL,
    customer_name VARCHAR(150) NOT NULL,
    customer_phone VARCHAR(30) NOT NULL,
    customer_location VARCHAR(180) NULL,

    agreement_status ENUM(
        'draft',
        'pending_approval',
        'active',
        'due_soon',
        'payment_due',
        'overdue',
        'completed',
        'cancelled',
        'defaulted'
    ) NOT NULL DEFAULT 'active',
    approval_status ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required',

    sale_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    deposit_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    financed_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    scheduled_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    late_charges_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    waived_charges_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    outstanding_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    overdue_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    payment_frequency ENUM('weekly','fortnightly','monthly','custom') NOT NULL DEFAULT 'monthly',
    installment_count INT NOT NULL DEFAULT 1,
    first_due_date DATE NOT NULL,
    next_due_date DATE NULL,
    final_due_date DATE NULL,
    grace_days INT NOT NULL DEFAULT 0,
    late_charge_type ENUM('none','fixed','percentage') NOT NULL DEFAULT 'none',
    late_charge_value DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    delivery_policy ENUM('immediate','after_full_payment') NOT NULL DEFAULT 'immediate',
    delivery_status ENUM('reserved','delivered','cancelled') NOT NULL DEFAULT 'delivered',
    delivered_at DATETIME NULL,
    delivered_by INT NULL,

    guarantor_name VARCHAR(150) NULL,
    guarantor_phone VARCHAR(30) NULL,
    guarantor_location VARCHAR(180) NULL,
    terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    agreement_notes TEXT NULL,

    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    cancelled_by INT NULL,
    cancelled_at DATETIME NULL,
    cancellation_reason VARCHAR(500) NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_installment_agreement_number (agreement_number),
    UNIQUE KEY uq_installment_agreement_sale (sale_id),
    INDEX idx_installment_branch_status (branch_id, agreement_status, next_due_date),
    INDEX idx_installment_customer (branch_id, customer_id, created_at),
    INDEX idx_installment_phone (branch_id, customer_phone),
    INDEX idx_installment_due (branch_id, next_due_date, agreement_status),
    INDEX idx_installment_approval (branch_id, approval_status, created_at),

    CONSTRAINT fk_installment_agreement_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_agreement_sale
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_agreement_debt
        FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_agreement_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_agreement_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_agreement_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_agreement_cancelled_by
        FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_agreement_delivered_by
        FOREIGN KEY (delivered_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS installment_agreement_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    agreement_id BIGINT NOT NULL,
    sale_item_id INT NULL,
    product_id INT NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    line_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    reservation_status ENUM('reserved','delivered','released') NOT NULL DEFAULT 'delivered',
    delivered_quantity INT NOT NULL DEFAULT 0,
    delivered_at DATETIME NULL,
    delivered_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_installment_items_agreement (agreement_id),
    INDEX idx_installment_items_product (product_id),
    CONSTRAINT fk_installment_items_agreement
        FOREIGN KEY (agreement_id) REFERENCES installment_agreements(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_items_sale_item
        FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_items_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_items_delivered_by
        FOREIGN KEY (delivered_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS installment_schedule (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    agreement_id BIGINT NOT NULL,
    sequence_number INT NOT NULL,
    due_date DATE NOT NULL,
    scheduled_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    late_charge_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    waived_charge_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    schedule_status ENUM(
        'upcoming',
        'due',
        'partial',
        'paid',
        'overdue',
        'waived',
        'cancelled'
    ) NOT NULL DEFAULT 'upcoming',
    fully_paid_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_installment_schedule_sequence (agreement_id, sequence_number),
    INDEX idx_installment_schedule_due (due_date, schedule_status),
    INDEX idx_installment_schedule_agreement_status (agreement_id, schedule_status),
    CONSTRAINT fk_installment_schedule_agreement
        FOREIGN KEY (agreement_id) REFERENCES installment_agreements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS installment_payments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    agreement_id BIGINT NOT NULL,
    receipt_number VARCHAR(100) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method ENUM('cash','momo','bank','other') NOT NULL DEFAULT 'cash',
    payment_reference VARCHAR(150) NULL,
    notes VARCHAR(500) NULL,
    received_by INT NULL,
    paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_voided BOOLEAN NOT NULL DEFAULT FALSE,
    void_reason VARCHAR(500) NULL,
    voided_by INT NULL,
    voided_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_installment_payment_receipt (receipt_number),
    INDEX idx_installment_payment_branch_date (branch_id, paid_at),
    INDEX idx_installment_payment_agreement (agreement_id, paid_at),
    INDEX idx_installment_payment_method (payment_method, paid_at),
    CONSTRAINT fk_installment_payment_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_payment_agreement
        FOREIGN KEY (agreement_id) REFERENCES installment_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_payment_received_by
        FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_payment_voided_by
        FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS installment_payment_allocations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    payment_id BIGINT NOT NULL,
    schedule_id BIGINT NOT NULL,
    allocated_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_installment_payment_schedule (payment_id, schedule_id),
    INDEX idx_installment_allocation_schedule (schedule_id),
    CONSTRAINT fk_installment_allocation_payment
        FOREIGN KEY (payment_id) REFERENCES installment_payments(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_allocation_schedule
        FOREIGN KEY (schedule_id) REFERENCES installment_schedule(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS installment_reschedules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    agreement_id BIGINT NOT NULL,
    old_frequency VARCHAR(30) NULL,
    new_frequency VARCHAR(30) NULL,
    old_next_due_date DATE NULL,
    new_first_due_date DATE NOT NULL,
    old_installment_count INT NULL,
    new_installment_count INT NOT NULL,
    remaining_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    reason VARCHAR(500) NOT NULL,
    approval_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    requested_by INT NULL,
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_by INT NULL,
    decided_at DATETIME NULL,
    decision_notes VARCHAR(500) NULL,

    INDEX idx_installment_reschedule_agreement (agreement_id, requested_at),
    INDEX idx_installment_reschedule_status (approval_status, requested_at),
    CONSTRAINT fk_installment_reschedule_agreement
        FOREIGN KEY (agreement_id) REFERENCES installment_agreements(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_reschedule_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_reschedule_decided_by
        FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS installment_reminder_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    agreement_id BIGINT NOT NULL,
    schedule_id BIGINT NULL,
    reminder_key VARCHAR(191) NOT NULL,
    reminder_type ENUM(
        'agreement_created',
        'due_soon',
        'due_today',
        'overdue',
        'payment_receipt',
        'rescheduled',
        'completed',
        'manual'
    ) NOT NULL DEFAULT 'manual',
    recipient_phone VARCHAR(30) NOT NULL,
    sms_log_id INT NULL,
    delivery_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    message_preview VARCHAR(500) NULL,
    sent_by INT NULL,
    sent_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_installment_reminder_key (reminder_key),
    INDEX idx_installment_reminder_agreement (agreement_id, created_at),
    INDEX idx_installment_reminder_schedule (schedule_id, created_at),
    INDEX idx_installment_reminder_branch (branch_id, created_at),
    CONSTRAINT fk_installment_reminder_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_reminder_agreement
        FOREIGN KEY (agreement_id) REFERENCES installment_agreements(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_reminder_schedule
        FOREIGN KEY (schedule_id) REFERENCES installment_schedule(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_reminder_sms
        FOREIGN KEY (sms_log_id) REFERENCES sms_log(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_reminder_sent_by
        FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO installment_settings (branch_id)
SELECT id
FROM branches
ON DUPLICATE KEY UPDATE branch_id = VALUES(branch_id);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260718_release3fb_professional_installment_sales',
    'Adds branch-isolated installment agreements, schedules, payments, rescheduling, stock-delivery evidence, reminders and professional reporting.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT 'RELEASE 3F-B INSTALLMENT MIGRATION COMPLETE' AS result;
