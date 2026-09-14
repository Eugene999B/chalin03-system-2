-- CHALIN 03 PROFESSIONAL EQUIPMENT INSTALLMENT FINANCE
-- SETTINGS, DOCUMENT SNAPSHOTS, SIGNATURES, PAYMENT ALERTS AND MACHINE EVIDENCE
-- ADDITIVE MIGRATION ONLY.
-- FORWARD-ONLY CHANGE.
-- BACKUP REQUIRED BEFORE PRODUCTION EXECUTION.
-- Existing Finance applications, agreements, schedules, payments, deliveries,
-- ownership transfers, Hire records and fleet records are preserved.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS equipment_finance_professional_add_column_if_missing $$
DROP PROCEDURE IF EXISTS equipment_finance_professional_add_index_if_missing $$
DROP PROCEDURE IF EXISTS equipment_finance_professional_add_fk_if_missing $$

CREATE PROCEDURE equipment_finance_professional_add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @professional_finance_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE professional_finance_stmt FROM @professional_finance_sql;
        EXECUTE professional_finance_stmt;
        DEALLOCATE PREPARE professional_finance_stmt;
    END IF;
END $$

CREATE PROCEDURE equipment_finance_professional_add_index_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @professional_finance_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE professional_finance_stmt FROM @professional_finance_sql;
        EXECUTE professional_finance_stmt;
        DEALLOCATE PREPARE professional_finance_stmt;
    END IF;
END $$

CREATE PROCEDURE equipment_finance_professional_add_fk_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_constraint_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND CONSTRAINT_NAME = p_constraint_name
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ) THEN
        SET @professional_finance_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE professional_finance_stmt FROM @professional_finance_sql;
        EXECUTE professional_finance_stmt;
        DEALLOCATE PREPARE professional_finance_stmt;
    END IF;
END $$

DELIMITER ;

-- ============================================================
-- MACHINE IDENTITY AND AGREEMENT DOCUMENT STATE
-- ============================================================

CALL equipment_finance_professional_add_column_if_missing(
    'fleet_assets',
    'registration_number',
    'VARCHAR(120) NULL AFTER engine_number'
);
CALL equipment_finance_professional_add_column_if_missing(
    'fleet_assets',
    'customs_reference',
    'VARCHAR(150) NULL AFTER acquisition_reference'
);
CALL equipment_finance_professional_add_column_if_missing(
    'fleet_assets',
    'title_document_reference',
    'VARCHAR(150) NULL AFTER customs_reference'
);
CALL equipment_finance_professional_add_column_if_missing(
    'fleet_assets',
    'insurance_reference',
    'VARCHAR(150) NULL AFTER title_document_reference'
);
CALL equipment_finance_professional_add_column_if_missing(
    'fleet_assets',
    'minimum_selling_price',
    'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER target_selling_price'
);

CALL equipment_finance_professional_add_column_if_missing(
    'equipment_sale_agreements',
    'terms_version',
    'VARCHAR(60) NULL AFTER agreement_notes'
);
CALL equipment_finance_professional_add_column_if_missing(
    'equipment_sale_agreements',
    'agreement_document_number',
    'VARCHAR(100) NULL AFTER terms_version'
);
CALL equipment_finance_professional_add_column_if_missing(
    'equipment_sale_agreements',
    'agreement_issued_at',
    'DATETIME NULL AFTER agreement_document_number'
);
CALL equipment_finance_professional_add_column_if_missing(
    'equipment_sale_agreements',
    'agreement_signed_at',
    'DATETIME NULL AFTER agreement_issued_at'
);

CALL equipment_finance_professional_add_index_if_missing(
    'fleet_assets',
    'idx_finance_machine_registration',
    'INDEX `idx_finance_machine_registration` (`registration_number`, `engine_number`)'
);
CALL equipment_finance_professional_add_index_if_missing(
    'equipment_sale_agreements',
    'idx_finance_agreement_document',
    'INDEX `idx_finance_agreement_document` (`agreement_document_number`, `agreement_issued_at`)'
);

-- ============================================================
-- COMPANY-WIDE FINANCE POLICY
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_finance_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    company_name VARCHAR(180) NOT NULL DEFAULT 'CHALIN 03 COMPANY LIMITED',
    company_phone VARCHAR(40) NULL,
    company_email VARCHAR(180) NULL,
    company_address VARCHAR(255) NULL,
    company_postal_address VARCHAR(180) NULL,
    company_digital_address VARCHAR(80) NULL,
    currency CHAR(3) NOT NULL DEFAULT 'GHS',

    boss_payment_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    boss_payment_alert_phone VARCHAR(40) NULL,
    customer_payment_receipt_sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    deposit_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    settlement_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ownership_ready_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    automatic_reminders_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_time TIME NOT NULL DEFAULT '09:00:00',
    due_soon_days VARCHAR(100) NOT NULL DEFAULT '7,3,1',
    overdue_repeat_days INT NOT NULL DEFAULT 3,
    max_sms_7_days INT NOT NULL DEFAULT 3,
    max_sms_30_days INT NOT NULL DEFAULT 8,
    minimum_hours_between_sms INT NOT NULL DEFAULT 24,
    quiet_hours_start TIME NOT NULL DEFAULT '19:00:00',
    quiet_hours_end TIME NOT NULL DEFAULT '08:00:00',
    skip_weekends BOOLEAN NOT NULL DEFAULT FALSE,

    minimum_deposit_percent DECIMAL(7,4) NOT NULL DEFAULT 20.0000,
    maximum_term_months INT NOT NULL DEFAULT 36,
    maximum_installment_count INT NOT NULL DEFAULT 156,
    default_payment_frequency ENUM('weekly','fortnightly','monthly','custom') NOT NULL DEFAULT 'monthly',
    default_first_due_days INT NOT NULL DEFAULT 30,
    default_grace_days INT NOT NULL DEFAULT 3,
    late_charge_type ENUM('none','fixed','percentage') NOT NULL DEFAULT 'none',
    late_charge_value DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    late_charge_cap DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    delivery_policy ENUM('immediate','after_deposit','after_percentage','after_full_payment') NOT NULL DEFAULT 'after_deposit',
    delivery_threshold_percent DECIMAL(7,4) NOT NULL DEFAULT 20.0000,
    payment_allocation_policy ENUM('oldest_due_first') NOT NULL DEFAULT 'oldest_due_first',
    allow_partial_payments BOOLEAN NOT NULL DEFAULT TRUE,
    advance_excess_to_future BOOLEAN NOT NULL DEFAULT TRUE,

    default_review_missed_installments INT NOT NULL DEFAULT 3,
    notice_cure_days INT NOT NULL DEFAULT 14,
    legal_review_status ENUM('draft','reviewed','approved') NOT NULL DEFAULT 'draft',
    legal_reviewed_by VARCHAR(180) NULL,
    legal_review_date DATE NULL,
    terms_version VARCHAR(60) NOT NULL DEFAULT 'FIN-TERMS-1',
    agreement_terms LONGTEXT NOT NULL,

    authorised_seller_name VARCHAR(180) NULL,
    authorised_seller_title VARCHAR(120) NULL,
    authorised_seller_signature_data_url LONGTEXT NULL,
    buyer_signature_required BOOLEAN NOT NULL DEFAULT TRUE,
    witness_signature_required BOOLEAN NOT NULL DEFAULT TRUE,
    guarantor_signature_required BOOLEAN NOT NULL DEFAULT TRUE,
    complimentary_service_count INT NOT NULL DEFAULT 1,

    payment_alert_template VARCHAR(480) NOT NULL DEFAULT 'CHALIN03 FINANCE: {customer_name} paid GHS {amount} for {agreement_number} / {equipment_name}. Receipt {receipt_number}. Balance GHS {outstanding_balance}. Received by {staff_name}.',
    customer_receipt_template VARCHAR(480) NOT NULL DEFAULT 'CHALIN03: Payment of GHS {amount} received for {agreement_number}. Receipt {receipt_number}. Outstanding GHS {outstanding_balance}. Thank you.',
    reminder_template VARCHAR(480) NOT NULL DEFAULT 'CHALIN03: Dear {customer_name}, installment {agreement_number} for {equipment_name} has GHS {outstanding_balance} outstanding. {due_sentence}',

    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_equipment_finance_settings_singleton CHECK (id = 1),
    CONSTRAINT fk_equipment_finance_settings_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_finance_settings_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    settings_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
    old_snapshot_json LONGTEXT NULL,
    new_snapshot_json LONGTEXT NOT NULL,
    change_reason VARCHAR(500) NOT NULL,
    changed_by INT NULL,
    request_id VARCHAR(120) NULL,
    ip_address VARCHAR(80) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_finance_settings_history_created (created_at, changed_by),
    CONSTRAINT fk_finance_settings_history_settings
        FOREIGN KEY (settings_id) REFERENCES equipment_finance_settings(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_settings_history_user
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO equipment_finance_settings (
    id,
    company_name,
    company_phone,
    company_email,
    company_address,
    company_postal_address,
    agreement_terms
)
VALUES (
    1,
    'CHALIN 03 COMPANY LIMITED',
    '0249469080',
    'agyapongcharles3@gmail.com',
    'Dunkwa-On-Offin, Ghana',
    'P. O. Box 187, Dunkwa-On-Offin',
    '1. IDENTIFIED MACHINE. The Seller agrees to sell and the Buyer agrees to buy only the excavator or machine identified in this Agreement and its Machine Identity Annexure.\n\n2. PURCHASE PRICE AND INSTALLMENTS. The purchase price, deposit, financed balance, installment frequency, amounts and due dates are those shown in the approved commercial schedule attached to this Agreement. Payments are allocated to the oldest outstanding scheduled amount first unless an approved variation states otherwise.\n\n3. TITLE AND OWNERSHIP. Legal title remains with CHALIN 03 COMPANY LIMITED until the account is fully settled and the controlled ownership-transfer process is completed. Possession or delivery alone does not transfer title.\n\n4. LAWFUL USE. The Buyer shall not use or permit the machine to be used for illegal mining, unlawful activity or any purpose prohibited by the laws of Ghana.\n\n5. CARE, MAINTENANCE AND RISK. From delivery, the Buyer shall keep the machine secure, properly operated and maintained, promptly report loss or material damage and comply with any insurance, inspection and location obligations stated in the Delivery Annexure.\n\n6. LATE OR MISSED PAYMENTS. Grace days and any approved late charge are shown in the Agreement settings and schedule. A missed payment creates arrears evidence and may trigger reminders, notices, a promise-to-pay process, rescheduling review or default review.\n\n7. NOTICE, CURE AND RECOVERY. No automatic repossession or forfeiture occurs merely because a number of payments were missed. The Seller shall preserve payment evidence, issue the required notice and cure opportunity, record approvals and follow the lawful recovery route applicable in Ghana. The treatment of prior payments shall be governed by the legally reviewed Agreement and applicable law.\n\n8. DELIVERY AND CONDITION. Delivery is subject to the approved payment threshold. The Buyer shall inspect and sign the Delivery and Condition Report, including meter, attachments, visible condition and photo evidence.\n\n9. SERVICE. The Seller shall provide the number of complimentary services stated in this Agreement. Additional maintenance is the Buyer''s responsibility unless separately agreed in writing.\n\n10. GUARANTOR. A named guarantor signs a separate undertaking where required and confirms that the information supplied is true.\n\n11. VARIATIONS AND WAIVERS. Rescheduling, waivers, discounts or amendments are valid only when recorded in a numbered written variation approved by authorised staff.\n\n12. SETTLEMENT AND OWNERSHIP TRANSFER. After full settlement and controlled delivery, the Seller shall prepare settlement and ownership-transfer evidence. Registration or authority transfers remain subject to the required external process and documents.\n\n13. COMMUNICATION AND DATA. The Buyer consents to lawful account communications and to the secure processing of identity, payment, machine and signature evidence for this transaction.\n\n14. GOVERNING LAW AND DISPUTES. This Agreement is governed by the laws of the Republic of Ghana. Parties should first attempt good-faith resolution before using the dispute process stated in the issued Agreement.\n\n15. ENTIRE AGREEMENT. This Agreement, its approved schedule, machine annexure, guarantor undertaking, delivery report and numbered written variations form the complete agreement. If a clause is invalid, the remaining clauses continue to apply.'
)
ON DUPLICATE KEY UPDATE id = VALUES(id);

-- ============================================================
-- SIGNATURES, ISSUED DOCUMENTS AND BOSS ALERT EVIDENCE
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_finance_document_signatures (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    agreement_id BIGINT NOT NULL,
    signer_role ENUM('seller','buyer','buyer_witness','seller_witness','guarantor') NOT NULL,
    signer_name VARCHAR(180) NOT NULL,
    signer_phone VARCHAR(40) NULL,
    signature_data_url LONGTEXT NOT NULL,
    signed_at DATETIME NOT NULL,
    captured_by INT NULL,
    notes VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_finance_signature_agreement_role (agreement_id, signer_role),
    INDEX idx_finance_signature_signed (signed_at, captured_by),
    CONSTRAINT fk_finance_signature_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_signature_captured_by
        FOREIGN KEY (captured_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_finance_issued_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    document_number VARCHAR(100) NOT NULL UNIQUE,
    agreement_id BIGINT NOT NULL,
    document_type VARCHAR(80) NOT NULL,
    document_format ENUM('pdf','word','print','json') NOT NULL,
    template_version VARCHAR(60) NOT NULL,
    snapshot_json LONGTEXT NOT NULL,
    snapshot_checksum CHAR(64) NOT NULL,
    issued_by INT NULL,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at DATETIME NULL,
    archived_by INT NULL,
    archive_reason VARCHAR(500) NULL,

    INDEX idx_finance_document_agreement (agreement_id, document_type, issued_at),
    INDEX idx_finance_document_active (archived_at, issued_at),
    CONSTRAINT fk_finance_document_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_document_issued_by
        FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_finance_document_archived_by
        FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_finance_payment_alerts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    payment_id BIGINT NOT NULL,
    agreement_id BIGINT NOT NULL,
    boss_phone VARCHAR(40) NULL,
    alert_message VARCHAR(480) NOT NULL,
    alert_status ENUM('pending','accepted','delivered','delivery_unknown','failed','skipped') NOT NULL DEFAULT 'pending',
    sms_log_id BIGINT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    last_error VARCHAR(1000) NULL,
    submitted_at DATETIME NULL,
    delivered_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_finance_payment_boss_alert (payment_id),
    INDEX idx_finance_payment_alert_status (alert_status, created_at),
    INDEX idx_finance_payment_alert_agreement (agreement_id, created_at),
    CONSTRAINT fk_finance_payment_alert_payment
        FOREIGN KEY (payment_id) REFERENCES equipment_sale_payments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_finance_payment_alert_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT
);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260731_equipment_finance_professional_rebuild',
    'Professional Finance settings, excavator identity, document snapshots, signatures and boss payment alerts.'
)
ON DUPLICATE KEY UPDATE migration_name = VALUES(migration_name);

DROP PROCEDURE IF EXISTS equipment_finance_professional_add_column_if_missing;
DROP PROCEDURE IF EXISTS equipment_finance_professional_add_index_if_missing;
DROP PROCEDURE IF EXISTS equipment_finance_professional_add_fk_if_missing;
