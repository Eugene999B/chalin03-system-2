-- CHALIN 03 AUDIT UNLOCK + RE-APPROVAL SAFE MIGRATION
-- Use this on an existing working database.
-- This file does NOT drop the database and does NOT delete data.

USE chalin03_db;

CREATE TABLE IF NOT EXISTS audit_unlock_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,

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

    INDEX idx_unlock_request_signoff (audit_signoff_id),
    INDEX idx_unlock_request_status (status),
    INDEX idx_unlock_request_area (request_area),
    INDEX idx_unlock_request_requested_by (requested_by),
    INDEX idx_unlock_request_reviewed_by (reviewed_by),
    INDEX idx_unlock_request_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS audit_reapproval_log (
    id INT AUTO_INCREMENT PRIMARY KEY,

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

    INDEX idx_reapproval_signoff (audit_signoff_id),
    INDEX idx_reapproval_unlock_request (unlock_request_id),
    INDEX idx_reapproval_period_dates (period_start, period_end),
    INDEX idx_reapproval_user (reapproved_by),
    INDEX idx_reapproval_date (reapproved_at)
);

SHOW TABLES LIKE 'audit_unlock_requests';
SHOW TABLES LIKE 'audit_reapproval_log';

DESCRIBE audit_unlock_requests;
DESCRIBE audit_reapproval_log;
