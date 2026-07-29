-- CHALIN 03 EQUIPMENT INSTALLMENT FINANCE
-- CREDIT APPLICATION, KYC AND AFFORDABILITY FOUNDATION
-- ADDITIVE MIGRATION ONLY.
-- Idempotent: rerunning this migration preserves existing records.
-- BACKUP REQUIRED BEFORE PRODUCTION EXECUTION.
-- Existing customers, quotations, agreements, schedules, payments, Hire contracts
-- and fleet records are preserved.
-- Never run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS equipment_credit_applications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    customer_id INT NOT NULL,
    enquiry_id BIGINT NULL,
    quotation_id BIGINT NOT NULL,
    asset_id INT NOT NULL,
    application_date DATE NOT NULL,
    application_status ENUM(
        'draft','submitted','under_review','changes_requested',
        'approved','declined','withdrawn'
    ) NOT NULL DEFAULT 'draft',
    kyc_status ENUM(
        'not_started','incomplete','complete','verified','rejected'
    ) NOT NULL DEFAULT 'not_started',
    affordability_status ENUM(
        'not_assessed','eligible','manual_review','ineligible'
    ) NOT NULL DEFAULT 'not_assessed',
    risk_band ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
    risk_score SMALLINT UNSIGNED NOT NULL DEFAULT 50,

    quoted_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    proposed_deposit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    financed_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    proposed_frequency ENUM('weekly','fortnightly','monthly','custom') NOT NULL DEFAULT 'monthly',
    proposed_installment_count SMALLINT UNSIGNED NOT NULL DEFAULT 12,
    proposed_installment_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,

    monthly_salary_income DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    monthly_business_income DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    monthly_other_income DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    monthly_business_costs DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    monthly_household_expenses DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    existing_monthly_debt DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    total_monthly_income DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    total_monthly_commitments DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    net_monthly_surplus DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    debt_service_ratio_percent DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    total_commitment_ratio_percent DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    deposit_ratio_percent DECIMAL(7,2) NOT NULL DEFAULT 0.00,

    assessment_recommendation VARCHAR(120) NULL,
    assessment_notes TEXT NULL,
    customer_consent_at DATETIME NULL,
    submitted_by INT NULL,
    submitted_at DATETIME NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    decision_reason VARCHAR(1500) NULL,
    decision_version INT UNSIGNED NOT NULL DEFAULT 0,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_equipment_credit_location_status (
        hire_location_id, application_status, created_at
    ),
    INDEX idx_equipment_credit_customer (customer_id, created_at),
    INDEX idx_equipment_credit_quotation (quotation_id, application_status),
    INDEX idx_equipment_credit_asset (asset_id, application_status),
    INDEX idx_equipment_credit_risk (
        hire_location_id, affordability_status, risk_band, risk_score
    ),

    CONSTRAINT fk_equipment_credit_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_credit_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_credit_enquiry
        FOREIGN KEY (enquiry_id) REFERENCES equipment_sales_enquiries(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_credit_quotation
        FOREIGN KEY (quotation_id) REFERENCES equipment_sales_quotations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_credit_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_credit_submitted_by
        FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_credit_reviewed_by
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_credit_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_credit_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_credit_application_kyc (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NOT NULL UNIQUE,

    customer_name_snapshot VARCHAR(180) NOT NULL,
    customer_phone_snapshot VARCHAR(40) NULL,
    customer_email_snapshot VARCHAR(180) NULL,
    customer_address_snapshot TEXT NULL,
    id_type VARCHAR(80) NULL,
    id_number VARCHAR(150) NULL,
    date_of_birth DATE NULL,
    nationality VARCHAR(100) NOT NULL DEFAULT 'Ghana',
    employment_type ENUM(
        'salaried','self_employed','contractor','pensioner','farmer','other'
    ) NULL,
    occupation VARCHAR(150) NULL,
    employer_business_name VARCHAR(200) NULL,
    business_registration_number VARCHAR(150) NULL,
    residential_address TEXT NULL,
    work_address TEXT NULL,
    years_at_residence DECIMAL(5,2) NULL,
    years_in_employment_business DECIMAL(5,2) NULL,

    emergency_contact_name VARCHAR(180) NULL,
    emergency_contact_phone VARCHAR(40) NULL,
    emergency_contact_relationship VARCHAR(100) NULL,
    guarantor_name VARCHAR(180) NULL,
    guarantor_phone VARCHAR(40) NULL,
    guarantor_address TEXT NULL,
    guarantor_id_type VARCHAR(80) NULL,
    guarantor_id_number VARCHAR(150) NULL,
    guarantor_relationship VARCHAR(100) NULL,

    identity_document_url TEXT NULL,
    address_evidence_url TEXT NULL,
    income_evidence_url TEXT NULL,
    bank_statement_url TEXT NULL,
    business_registration_url TEXT NULL,
    guarantor_document_url TEXT NULL,

    identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
    address_verified BOOLEAN NOT NULL DEFAULT FALSE,
    income_verified BOOLEAN NOT NULL DEFAULT FALSE,
    guarantor_verified BOOLEAN NOT NULL DEFAULT FALSE,
    customer_consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    credit_assessment_consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by INT NULL,
    verified_at DATETIME NULL,
    verification_notes TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_equipment_credit_kyc_identity (id_type, id_number),
    INDEX idx_equipment_credit_kyc_verification (
        identity_verified, address_verified, income_verified, guarantor_verified
    ),

    CONSTRAINT fk_equipment_credit_kyc_application
        FOREIGN KEY (application_id) REFERENCES equipment_credit_applications(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_credit_kyc_verified_by
        FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_credit_kyc_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_credit_kyc_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_credit_application_decisions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    application_id BIGINT NOT NULL,
    decision_version INT UNSIGNED NOT NULL,
    action_type ENUM(
        'created','updated','assessed','submitted','review_started',
        'changes_requested','approved','declined','withdrawn','kyc_verified'
    ) NOT NULL,
    from_status VARCHAR(40) NULL,
    to_status VARCHAR(40) NULL,
    affordability_status VARCHAR(40) NULL,
    risk_band VARCHAR(40) NULL,
    risk_score SMALLINT UNSIGNED NULL,
    debt_service_ratio_percent DECIMAL(7,2) NULL,
    net_monthly_surplus DECIMAL(14,2) NULL,
    notes VARCHAR(2000) NULL,
    snapshot_json JSON NULL,
    decided_by INT NULL,
    decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_equipment_credit_decision_version (
        application_id, decision_version
    ),
    INDEX idx_equipment_credit_decision_action (
        application_id, action_type, decided_at
    ),

    CONSTRAINT fk_equipment_credit_decision_application
        FOREIGN KEY (application_id) REFERENCES equipment_credit_applications(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_credit_decision_user
        FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260729_equipment_credit_application_foundation',
    'Additive Equipment Installment Finance credit application, KYC, affordability and decision-history foundation.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
