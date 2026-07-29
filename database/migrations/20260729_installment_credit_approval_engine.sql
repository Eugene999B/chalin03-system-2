-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
-- Creates the Equipment Installment Finance credit application, KYC,
-- affordability, approval and activation-control foundation.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

DELIMITER $$

DROP PROCEDURE IF EXISTS installment_credit_add_column_if_missing $$
CREATE PROCEDURE installment_credit_add_column_if_missing(
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
        SET @installment_credit_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE installment_credit_stmt FROM @installment_credit_sql;
        EXECUTE installment_credit_stmt;
        DEALLOCATE PREPARE installment_credit_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS installment_credit_add_index_if_missing $$
CREATE PROCEDURE installment_credit_add_index_if_missing(
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
        SET @installment_credit_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE installment_credit_stmt FROM @installment_credit_sql;
        EXECUTE installment_credit_stmt;
        DEALLOCATE PREPARE installment_credit_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS installment_credit_add_fk_if_missing $$
CREATE PROCEDURE installment_credit_add_fk_if_missing(
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
        SET @installment_credit_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE installment_credit_stmt FROM @installment_credit_sql;
        EXECUTE installment_credit_stmt;
        DEALLOCATE PREPARE installment_credit_stmt;
    END IF;
END $$

DELIMITER ;

CREATE TABLE IF NOT EXISTS equipment_installment_applications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    customer_id INT NOT NULL,
    quotation_id BIGINT NOT NULL,
    asset_id INT NOT NULL,
    agreement_id BIGINT NULL,
    application_date DATE NOT NULL,
    status ENUM(
        'draft','submitted','verification','credit_review',
        'approved','rejected','withdrawn','converted'
    ) NOT NULL DEFAULT 'draft',

    customer_name_snapshot VARCHAR(150) NOT NULL,
    customer_phone_snapshot VARCHAR(30) NOT NULL,
    customer_address VARCHAR(255) NOT NULL,
    digital_address VARCHAR(120) NULL,
    customer_id_type VARCHAR(60) NOT NULL,
    customer_id_number VARCHAR(120) NOT NULL,

    occupation_type ENUM(
        'employed','self_employed','business_owner','farmer',
        'contractor','pensioner','other'
    ) NOT NULL DEFAULT 'other',
    employer_business_name VARCHAR(180) NULL,
    work_address VARCHAR(255) NULL,
    years_in_business_employment DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    monthly_income DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    other_monthly_income DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    monthly_expenses DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    existing_monthly_commitments DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    disposable_income DECIMAL(14,2) NOT NULL DEFAULT 0.00,

    requested_total_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    requested_deposit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    requested_finance_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    requested_frequency ENUM('weekly','fortnightly','monthly','custom') NOT NULL,
    requested_installment_count INT NOT NULL,
    requested_first_due_date DATE NOT NULL,
    requested_delivery_policy ENUM(
        'immediate','after_deposit','after_percentage','after_full_payment'
    ) NOT NULL DEFAULT 'after_deposit',
    estimated_installment_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    monthly_payment_equivalent DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    installment_to_income_percent DECIMAL(7,4) NOT NULL DEFAULT 0.0000,
    deposit_percent DECIMAL(7,4) NOT NULL DEFAULT 0.0000,

    guarantor_name VARCHAR(150) NOT NULL,
    guarantor_phone VARCHAR(30) NOT NULL,
    guarantor_location VARCHAR(180) NOT NULL,
    guarantor_id_type VARCHAR(60) NOT NULL,
    guarantor_id_number VARCHAR(120) NOT NULL,
    guarantor_relationship VARCHAR(100) NULL,

    customer_consent BOOLEAN NOT NULL DEFAULT FALSE,
    data_verification_consent BOOLEAN NOT NULL DEFAULT FALSE,
    terms_explained BOOLEAN NOT NULL DEFAULT FALSE,
    verification_checklist_json JSON NULL,
    required_documents_verified BOOLEAN NOT NULL DEFAULT FALSE,
    document_completeness_percent DECIMAL(7,4) NOT NULL DEFAULT 0.0000,

    risk_score SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    risk_level ENUM('low','medium','high','critical') NOT NULL DEFAULT 'critical',
    recommendation VARCHAR(500) NULL,
    required_approval_level ENUM('manager','senior_manager','boss') NOT NULL DEFAULT 'boss',

    approved_total_amount DECIMAL(14,2) NULL,
    approved_deposit DECIMAL(14,2) NULL,
    approved_finance_amount DECIMAL(14,2) NULL,
    approved_frequency ENUM('weekly','fortnightly','monthly','custom') NULL,
    approved_installment_count INT NULL,
    approved_first_due_date DATE NULL,
    approved_delivery_policy ENUM(
        'immediate','after_deposit','after_percentage','after_full_payment'
    ) NULL,
    approved_plan_json JSON NULL,
    affordability_snapshot_json JSON NULL,
    terms_locked_at DATETIME NULL,

    submitted_by INT NULL,
    submitted_at DATETIME NULL,
    verified_by INT NULL,
    verified_at DATETIME NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    rejected_by INT NULL,
    rejected_at DATETIME NULL,
    decision_reason VARCHAR(1000) NULL,
    converted_at DATETIME NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_equipment_installment_application_quote (quotation_id),
    UNIQUE KEY uq_equipment_installment_application_agreement (agreement_id),
    INDEX idx_installment_application_location_status (hire_location_id, status, created_at),
    INDEX idx_installment_application_customer (customer_id, status, created_at),
    INDEX idx_installment_application_asset (asset_id, status, created_at),
    INDEX idx_installment_application_risk (hire_location_id, risk_level, status),
    INDEX idx_installment_application_approval (required_approval_level, status, submitted_at),

    CONSTRAINT fk_installment_application_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_application_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_application_quotation
        FOREIGN KEY (quotation_id) REFERENCES equipment_sales_quotations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_application_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_application_submitted_by
        FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_application_verified_by
        FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_application_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_application_rejected_by
        FOREIGN KEY (rejected_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_application_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_application_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_installment_application_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NOT NULL,
    hire_location_id INT NOT NULL,
    document_type ENUM(
        'customer_identity','proof_of_address','income_evidence',
        'business_employment_evidence','bank_momo_statement',
        'guarantor_identity','guarantor_address','other'
    ) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    mime_type VARCHAR(120) NULL,
    document_reference VARCHAR(180) NULL,
    verification_status ENUM('uploaded','verified','rejected','superseded') NOT NULL DEFAULT 'uploaded',
    verification_notes VARCHAR(1000) NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_by INT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_by INT NULL,
    verified_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_installment_document_application (application_id, is_current, document_type),
    INDEX idx_installment_document_location (hire_location_id, verification_status, uploaded_at),
    INDEX idx_installment_document_verification (application_id, verification_status, is_current),

    CONSTRAINT fk_installment_document_application
        FOREIGN KEY (application_id) REFERENCES equipment_installment_applications(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_document_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_document_uploaded_by
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_installment_document_verified_by
        FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_installment_application_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NOT NULL,
    hire_location_id INT NOT NULL,
    action_code VARCHAR(100) NOT NULL,
    from_status VARCHAR(40) NULL,
    to_status VARCHAR(40) NULL,
    reason VARCHAR(1000) NULL,
    snapshot_json JSON NULL,
    acted_by INT NULL,
    acted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_installment_event_application (application_id, acted_at),
    INDEX idx_installment_event_location (hire_location_id, action_code, acted_at),

    CONSTRAINT fk_installment_event_application
        FOREIGN KEY (application_id) REFERENCES equipment_installment_applications(id) ON DELETE CASCADE,
    CONSTRAINT fk_installment_event_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_installment_event_acted_by
        FOREIGN KEY (acted_by) REFERENCES users(id) ON DELETE SET NULL
);

CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'credit_application_id',
    'BIGINT NULL AFTER quotation_id'
);
CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'credit_application_number_snapshot',
    'VARCHAR(80) NULL AFTER credit_application_id'
);
CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'credit_risk_score',
    'SMALLINT UNSIGNED NULL AFTER credit_application_number_snapshot'
);
CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'credit_risk_level',
    "ENUM('low','medium','high','critical') NULL AFTER credit_risk_score"
);
CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'credit_approval_level',
    "ENUM('manager','senior_manager','boss') NULL AFTER credit_risk_level"
);
CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'affordability_snapshot_json',
    'JSON NULL AFTER credit_approval_level'
);
CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'activation_checklist_json',
    'JSON NULL AFTER affordability_snapshot_json'
);
CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'activated_by',
    'INT NULL AFTER activation_checklist_json'
);
CALL installment_credit_add_column_if_missing(
    'equipment_sale_agreements', 'activated_at',
    'DATETIME NULL AFTER activated_by'
);

CALL installment_credit_add_index_if_missing(
    'equipment_sale_agreements', 'idx_equipment_agreement_credit_application',
    'UNIQUE INDEX `idx_equipment_agreement_credit_application` (`credit_application_id`)'
);
CALL installment_credit_add_index_if_missing(
    'equipment_sale_agreements', 'idx_equipment_agreement_credit_risk',
    'INDEX `idx_equipment_agreement_credit_risk` (`hire_location_id`, `credit_risk_level`, `agreement_status`)'
);

CALL installment_credit_add_fk_if_missing(
    'equipment_sale_agreements', 'fk_equipment_agreement_credit_application',
    'FOREIGN KEY (`credit_application_id`) REFERENCES `equipment_installment_applications` (`id`) ON DELETE RESTRICT'
);
CALL installment_credit_add_fk_if_missing(
    'equipment_sale_agreements', 'fk_equipment_agreement_activated_by',
    'FOREIGN KEY (`activated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL'
);
CALL installment_credit_add_fk_if_missing(
    'equipment_installment_applications', 'fk_installment_application_agreement',
    'FOREIGN KEY (`agreement_id`) REFERENCES `equipment_sale_agreements` (`id`) ON DELETE SET NULL'
);

DELIMITER $$

DROP TRIGGER IF EXISTS trg_equipment_installment_credit_guard_before_insert $$
CREATE TRIGGER trg_equipment_installment_credit_guard_before_insert
BEFORE INSERT ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE v_application_id BIGINT DEFAULT NULL;
    DECLARE v_application_number VARCHAR(80) DEFAULT NULL;
    DECLARE v_customer_id INT DEFAULT NULL;
    DECLARE v_asset_id INT DEFAULT NULL;
    DECLARE v_location_id INT DEFAULT NULL;
    DECLARE v_quotation_id BIGINT DEFAULT NULL;
    DECLARE v_status VARCHAR(40) DEFAULT NULL;
    DECLARE v_creator_id INT DEFAULT NULL;
    DECLARE v_approved_total DECIMAL(14,2) DEFAULT NULL;
    DECLARE v_approved_deposit DECIMAL(14,2) DEFAULT NULL;
    DECLARE v_approved_finance DECIMAL(14,2) DEFAULT NULL;
    DECLARE v_approved_frequency VARCHAR(30) DEFAULT NULL;
    DECLARE v_approved_count INT DEFAULT NULL;
    DECLARE v_approved_first_due DATE DEFAULT NULL;
    DECLARE v_approved_delivery_policy VARCHAR(40) DEFAULT NULL;
    DECLARE v_risk_score SMALLINT UNSIGNED DEFAULT NULL;
    DECLARE v_risk_level VARCHAR(20) DEFAULT NULL;
    DECLARE v_approval_level VARCHAR(30) DEFAULT NULL;
    DECLARE v_customer_id_type VARCHAR(60) DEFAULT NULL;
    DECLARE v_customer_id_number VARCHAR(120) DEFAULT NULL;
    DECLARE v_guarantor_name VARCHAR(150) DEFAULT NULL;
    DECLARE v_guarantor_phone VARCHAR(30) DEFAULT NULL;
    DECLARE v_guarantor_location VARCHAR(180) DEFAULT NULL;
    DECLARE v_guarantor_id_type VARCHAR(60) DEFAULT NULL;
    DECLARE v_guarantor_id_number VARCHAR(120) DEFAULT NULL;
    DECLARE v_affordability JSON DEFAULT NULL;
    DECLARE v_required_documents_verified BOOLEAN DEFAULT FALSE;
    DECLARE v_verified_document_count INT DEFAULT 0;

    IF NEW.sale_type = 'installment' THEN
        SELECT MAX(id)
          INTO v_application_id
        FROM equipment_installment_applications
        WHERE quotation_id = NEW.quotation_id
          AND hire_location_id = NEW.hire_location_id
          AND customer_id = NEW.customer_id
          AND asset_id = NEW.asset_id
          AND status = 'approved';

        IF v_application_id IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Approved installment credit application is required before agreement activation.';
        END IF;

        SELECT application_number, customer_id, asset_id, hire_location_id,
               quotation_id, status, created_by, approved_total_amount,
               approved_deposit, approved_finance_amount, approved_frequency,
               approved_installment_count, approved_first_due_date,
               approved_delivery_policy, risk_score, risk_level,
               required_approval_level, customer_id_type, customer_id_number,
               guarantor_name, guarantor_phone, guarantor_location,
               guarantor_id_type, guarantor_id_number,
               affordability_snapshot_json, required_documents_verified
          INTO v_application_number, v_customer_id, v_asset_id, v_location_id,
               v_quotation_id, v_status, v_creator_id, v_approved_total,
               v_approved_deposit, v_approved_finance, v_approved_frequency,
               v_approved_count, v_approved_first_due,
               v_approved_delivery_policy, v_risk_score, v_risk_level,
               v_approval_level, v_customer_id_type, v_customer_id_number,
               v_guarantor_name, v_guarantor_phone, v_guarantor_location,
               v_guarantor_id_type, v_guarantor_id_number,
               v_affordability, v_required_documents_verified
        FROM equipment_installment_applications
        WHERE id = v_application_id
        LIMIT 1;

        SELECT COUNT(DISTINCT document_type)
          INTO v_verified_document_count
        FROM equipment_installment_application_documents
        WHERE application_id = v_application_id
          AND is_current = TRUE
          AND verification_status = 'verified'
          AND document_type IN (
              'customer_identity','proof_of_address',
              'income_evidence','guarantor_identity'
          );

        IF v_status <> 'approved' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Credit application is not approved for activation.';
        END IF;
        IF v_customer_id <> NEW.customer_id OR v_asset_id <> NEW.asset_id
           OR v_location_id <> NEW.hire_location_id
           OR v_quotation_id <> NEW.quotation_id THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Credit application does not match the quotation, customer, equipment or location.';
        END IF;
        IF v_required_documents_verified = FALSE OR v_verified_document_count < 4 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'All required KYC, income and guarantor documents must be verified before activation.';
        END IF;
        IF COALESCE(NEW.terms_accepted, FALSE) = FALSE THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Customer acceptance of approved installment terms is required.';
        END IF;
        IF NEW.deposit_received + 0.01 < COALESCE(v_approved_deposit, 0) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Deposit received is below the approved installment deposit.';
        END IF;
        IF ABS(NEW.total_amount - COALESCE(v_approved_total, NEW.total_amount)) > 0.01
           OR ABS(NEW.financed_amount - GREATEST(NEW.total_amount - NEW.deposit_received, 0)) > 0.01 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Agreement totals do not match the approved credit plan.';
        END IF;
        IF NEW.payment_frequency <> v_approved_frequency
           OR NEW.installment_count <> v_approved_count
           OR NEW.first_due_date <> v_approved_first_due THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Installment frequency, count or first due date differs from the approved plan.';
        END IF;
        IF NEW.delivery_policy <> v_approved_delivery_policy THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Delivery policy differs from the approved credit plan.';
        END IF;

        SET NEW.credit_application_id = v_application_id;
        SET NEW.credit_application_number_snapshot = v_application_number;
        SET NEW.credit_risk_score = v_risk_score;
        SET NEW.credit_risk_level = v_risk_level;
        SET NEW.credit_approval_level = v_approval_level;
        SET NEW.customer_id_type = v_customer_id_type;
        SET NEW.customer_id_number = v_customer_id_number;
        SET NEW.guarantor_name = v_guarantor_name;
        SET NEW.guarantor_phone = v_guarantor_phone;
        SET NEW.guarantor_location = v_guarantor_location;
        SET NEW.guarantor_id_type = v_guarantor_id_type;
        SET NEW.guarantor_id_number = v_guarantor_id_number;
        SET NEW.affordability_snapshot_json = v_affordability;
        SET NEW.activation_checklist_json = JSON_OBJECT(
            'approved_application', TRUE,
            'required_documents_verified', TRUE,
            'customer_terms_accepted', TRUE,
            'minimum_deposit_received', TRUE,
            'approved_plan_matched', TRUE,
            'equipment_availability_checked_by_transaction', TRUE
        );
        SET NEW.activated_by = NEW.created_by;
        SET NEW.activated_at = NOW();
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_installment_credit_convert_after_insert $$
CREATE TRIGGER trg_equipment_installment_credit_convert_after_insert
AFTER INSERT ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    IF NEW.sale_type = 'installment' AND NEW.credit_application_id IS NOT NULL THEN
        UPDATE equipment_installment_applications
        SET status = 'converted',
            agreement_id = NEW.id,
            converted_at = NOW(),
            updated_by = NEW.created_by,
            updated_at = NOW()
        WHERE id = NEW.credit_application_id
          AND status = 'approved';

        INSERT INTO equipment_installment_application_events (
            application_id, hire_location_id, action_code,
            from_status, to_status, reason, snapshot_json, acted_by
        ) VALUES (
            NEW.credit_application_id, NEW.hire_location_id,
            'AGREEMENT_ACTIVATED', 'approved', 'converted',
            CONCAT('Activated as agreement ', NEW.agreement_number, '.'),
            JSON_OBJECT(
                'agreement_id', NEW.id,
                'agreement_number', NEW.agreement_number,
                'deposit_received', NEW.deposit_received,
                'financed_amount', NEW.financed_amount
            ),
            NEW.created_by
        );
    END IF;
END $$

DROP PROCEDURE IF EXISTS installment_credit_add_column_if_missing $$
DROP PROCEDURE IF EXISTS installment_credit_add_index_if_missing $$
DROP PROCEDURE IF EXISTS installment_credit_add_fk_if_missing $$

DELIMITER ;

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    '20260729_installment_credit_approval_engine',
    'Adds protected Equipment Installment Finance applications, KYC documents, affordability assessment, maker-checker approval history and database-enforced agreement activation controls without rewriting existing agreements or Hire records.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
