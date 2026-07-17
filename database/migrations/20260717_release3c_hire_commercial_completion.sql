-- CHALIN 03 RELEASE 3C
-- Equipment Hire commercial completion: multi-item quotations, rate cards,
-- contract amendments, deposits/refunds, evidence, damage settlement and controlled numbering.
-- ADDITIVE MIGRATION ONLY. No existing business record is deleted.
-- Do not run database/schema.sql against production.

DELIMITER $$

DROP PROCEDURE IF EXISTS release3c_add_column_if_missing $$
CREATE PROCEDURE release3c_add_column_if_missing(
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
        SET @release3c_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE release3c_stmt FROM @release3c_sql;
        EXECUTE release3c_stmt;
        DEALLOCATE PREPARE release3c_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS release3c_add_index_if_missing $$
CREATE PROCEDURE release3c_add_index_if_missing(
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
        SET @release3c_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE release3c_stmt FROM @release3c_sql;
        EXECUTE release3c_stmt;
        DEALLOCATE PREPARE release3c_stmt;
    END IF;
END $$

DELIMITER ;

CALL release3c_add_column_if_missing(
    'hire_dispatches',
    'dispatch_number',
    'VARCHAR(80) NULL AFTER id'
);
CALL release3c_add_index_if_missing(
    'hire_dispatches',
    'uq_hire_dispatch_number',
    'UNIQUE KEY `uq_hire_dispatch_number` (`dispatch_number`)'
);

CALL release3c_add_column_if_missing(
    'hire_return_inspections',
    'return_number',
    'VARCHAR(80) NULL AFTER id'
);
CALL release3c_add_index_if_missing(
    'hire_return_inspections',
    'uq_hire_return_number',
    'UNIQUE KEY `uq_hire_return_number` (`return_number`)'
);

CALL release3c_add_column_if_missing(
    'hire_quotations',
    'commercial_version',
    'INT NOT NULL DEFAULT 1 AFTER quotation_number'
);
CALL release3c_add_column_if_missing(
    'hire_quotations',
    'approval_reason',
    'VARCHAR(500) NULL AFTER status'
);
CALL release3c_add_column_if_missing(
    'hire_contracts',
    'commercial_version',
    'INT NOT NULL DEFAULT 1 AFTER contract_number'
);

DROP PROCEDURE IF EXISTS release3c_add_column_if_missing;
DROP PROCEDURE IF EXISTS release3c_add_index_if_missing;

CREATE TABLE IF NOT EXISTS hire_rate_cards (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    rate_card_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    asset_type VARCHAR(100) NOT NULL,
    asset_id INT NULL,
    charging_method VARCHAR(30) NOT NULL,
    standard_rate DECIMAL(14,2) NOT NULL,
    minimum_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    mobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    demobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    operator_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    fuel_responsibility VARCHAR(30) NOT NULL DEFAULT 'customer',
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    notes TEXT NULL,
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_hire_rate_card_location_status (hire_location_id, status, effective_from),
    INDEX idx_hire_rate_card_asset (asset_id, effective_from),
    INDEX idx_hire_rate_card_type_method (asset_type, charging_method),

    CONSTRAINT fk_hire_rate_card_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_rate_card_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_rate_card_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_rate_card_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hire_quotation_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    quotation_id INT NOT NULL,
    line_number INT NOT NULL,
    rate_card_id BIGINT NULL,
    asset_type VARCHAR(100) NOT NULL,
    preferred_asset_id INT NULL,
    description VARCHAR(255) NOT NULL,
    charging_method VARCHAR(30) NOT NULL,
    rate DECIMAL(14,2) NOT NULL,
    estimated_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    minimum_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    mobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    demobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    operator_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    fuel_responsibility VARCHAR(30) NOT NULL DEFAULT 'customer',
    line_subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    line_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_hire_quote_item_line (quotation_id, line_number),
    INDEX idx_hire_quote_item_location (hire_location_id, quotation_id),
    INDEX idx_hire_quote_item_asset (preferred_asset_id),
    INDEX idx_hire_quote_item_rate_card (rate_card_id),

    CONSTRAINT fk_hire_quote_item_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_quote_item_quote
        FOREIGN KEY (quotation_id) REFERENCES hire_quotations(id) ON DELETE CASCADE,
    CONSTRAINT fk_hire_quote_item_rate_card
        FOREIGN KEY (rate_card_id) REFERENCES hire_rate_cards(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_quote_item_asset
        FOREIGN KEY (preferred_asset_id) REFERENCES fleet_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hire_contract_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    contract_id INT NOT NULL,
    quotation_item_id BIGINT NULL,
    line_number INT NOT NULL,
    asset_type VARCHAR(100) NOT NULL,
    preferred_asset_id INT NULL,
    description VARCHAR(255) NOT NULL,
    charging_method VARCHAR(30) NOT NULL,
    rate DECIMAL(14,2) NOT NULL,
    minimum_quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    mobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    demobilization_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    operator_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    fuel_responsibility VARCHAR(30) NOT NULL DEFAULT 'customer',
    agreed_line_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_hire_contract_item_line (contract_id, line_number),
    INDEX idx_hire_contract_item_location (hire_location_id, contract_id),
    INDEX idx_hire_contract_item_asset (preferred_asset_id),

    CONSTRAINT fk_hire_contract_item_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_contract_item_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE CASCADE,
    CONSTRAINT fk_hire_contract_item_quote_item
        FOREIGN KEY (quotation_item_id) REFERENCES hire_quotation_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_contract_item_asset
        FOREIGN KEY (preferred_asset_id) REFERENCES fleet_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hire_contract_amendments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    amendment_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    contract_id INT NOT NULL,
    amendment_type VARCHAR(40) NOT NULL,
    effective_date DATE NOT NULL,
    previous_end_date DATE NULL,
    proposed_end_date DATE NULL,
    previous_rate DECIMAL(14,2) NULL,
    proposed_rate DECIMAL(14,2) NULL,
    amount_adjustment DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    reason VARCHAR(500) NOT NULL,
    terms TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
    requested_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    rejection_reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_hire_amendment_location_status (hire_location_id, status, effective_date),
    INDEX idx_hire_amendment_contract (contract_id, created_at),

    CONSTRAINT fk_hire_amendment_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_amendment_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_amendment_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_amendment_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hire_deposit_transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    contract_id INT NOT NULL,
    customer_id INT NOT NULL,
    invoice_id INT NULL,
    transaction_type VARCHAR(30) NOT NULL,
    transaction_date DATETIME NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    payment_method VARCHAR(40) NULL,
    reference_number VARCHAR(120) NULL,
    reason VARCHAR(500) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'approved',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    voided_by INT NULL,
    voided_at DATETIME NULL,
    void_reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_hire_deposit_location_date (hire_location_id, transaction_date),
    INDEX idx_hire_deposit_contract (contract_id, status),
    INDEX idx_hire_deposit_customer (customer_id, transaction_date),
    INDEX idx_hire_deposit_invoice (invoice_id),

    CONSTRAINT fk_hire_deposit_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_deposit_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_deposit_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_deposit_invoice
        FOREIGN KEY (invoice_id) REFERENCES hire_invoices(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_deposit_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_deposit_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_deposit_voided_by
        FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hire_commercial_approvals (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    approval_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    approval_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id BIGINT NOT NULL,
    customer_id INT NULL,
    requested_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    threshold_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    reason VARCHAR(500) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    requested_by INT NULL,
    decided_by INT NULL,
    decided_at DATETIME NULL,
    decision_notes VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_hire_commercial_approval_location (hire_location_id, status, approval_type),
    INDEX idx_hire_commercial_approval_entity (entity_type, entity_id),
    INDEX idx_hire_commercial_approval_customer (customer_id, status),

    CONSTRAINT fk_hire_commercial_approval_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_commercial_approval_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_commercial_approval_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_commercial_approval_decided_by
        FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hire_evidence_files (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    evidence_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id BIGINT NOT NULL,
    evidence_type VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NULL,
    size_bytes BIGINT NULL,
    storage_reference VARCHAR(1000) NOT NULL,
    checksum_sha256 VARCHAR(64) NULL,
    captured_at DATETIME NULL,
    notes TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_hire_evidence_location_entity (hire_location_id, entity_type, entity_id),
    INDEX idx_hire_evidence_type (evidence_type, captured_at),

    CONSTRAINT fk_hire_evidence_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_evidence_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hire_damage_assessments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    assessment_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    return_inspection_id INT NOT NULL,
    contract_id INT NOT NULL,
    contract_asset_id INT NOT NULL,
    customer_id INT NOT NULL,
    assessed_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    customer_liability_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    deposit_applied_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    invoiced_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    waived_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    settled_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    settlement_method VARCHAR(40) NULL,
    damage_summary VARCHAR(500) NOT NULL,
    assessment_notes TEXT NULL,
    settlement_notes TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    assessed_by INT NULL,
    settled_by INT NULL,
    settled_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_hire_damage_return (return_inspection_id),
    INDEX idx_hire_damage_location_status (hire_location_id, status, created_at),
    INDEX idx_hire_damage_contract (contract_id, status),
    INDEX idx_hire_damage_customer (customer_id, status),

    CONSTRAINT fk_hire_damage_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_damage_return
        FOREIGN KEY (return_inspection_id) REFERENCES hire_return_inspections(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_damage_contract
        FOREIGN KEY (contract_id) REFERENCES hire_contracts(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_damage_contract_asset
        FOREIGN KEY (contract_asset_id) REFERENCES hire_contract_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_damage_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_hire_damage_assessed_by
        FOREIGN KEY (assessed_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_hire_damage_settled_by
        FOREIGN KEY (settled_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Backfill one normalized quotation line for every legacy single-line quotation.
INSERT INTO hire_quotation_items (
    hire_location_id,
    quotation_id,
    line_number,
    asset_type,
    preferred_asset_id,
    description,
    charging_method,
    rate,
    estimated_quantity,
    minimum_quantity,
    mobilization_amount,
    demobilization_amount,
    operator_amount,
    fuel_responsibility,
    line_subtotal,
    discount_amount,
    tax_amount,
    line_total,
    notes
)
SELECT
    hq.hire_location_id,
    hq.id,
    1,
    hq.requested_asset_type,
    hq.preferred_asset_id,
    CONCAT(hq.requested_asset_type, ' hire'),
    hq.charging_method,
    hq.rate,
    hq.estimated_quantity,
    hq.minimum_quantity,
    hq.mobilization_amount,
    hq.demobilization_amount,
    hq.operator_amount,
    hq.fuel_responsibility,
    hq.subtotal,
    hq.discount_amount,
    hq.tax_amount,
    hq.total_amount,
    hq.notes
FROM hire_quotations hq
WHERE NOT EXISTS (
    SELECT 1
    FROM hire_quotation_items hqi
    WHERE hqi.quotation_id = hq.id
);

-- Backfill one commercial contract line for every legacy single-line contract.
INSERT INTO hire_contract_items (
    hire_location_id,
    contract_id,
    line_number,
    asset_type,
    description,
    charging_method,
    rate,
    minimum_quantity,
    mobilization_amount,
    demobilization_amount,
    operator_amount,
    fuel_responsibility,
    agreed_line_total,
    notes
)
SELECT
    hc.hire_location_id,
    hc.id,
    1,
    COALESCE(hq.requested_asset_type, 'Equipment'),
    CONCAT(COALESCE(hq.requested_asset_type, 'Equipment'), ' hire'),
    hc.charging_method,
    hc.rate,
    hc.minimum_quantity,
    hc.mobilization_amount,
    hc.demobilization_amount,
    hc.operator_amount,
    hc.fuel_responsibility,
    COALESCE(hq.total_amount, 0.00),
    hc.notes
FROM hire_contracts hc
LEFT JOIN hire_quotations hq ON hq.id = hc.quotation_id
WHERE NOT EXISTS (
    SELECT 1
    FROM hire_contract_items hci
    WHERE hci.contract_id = hc.id
);

INSERT INTO document_sequences (
    sequence_code,
    workspace_code,
    document_name,
    prefix,
    next_number,
    padding,
    reset_policy,
    include_year,
    include_month,
    number_separator,
    is_active
)
VALUES
    ('HRTC', 'equipment_hire', 'Hire Rate Card', 'HRTC', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HAMD', 'equipment_hire', 'Hire Contract Amendment', 'HAMD', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HDEP', 'equipment_hire', 'Hire Deposit Transaction', 'HDEP', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HAPR', 'equipment_hire', 'Hire Commercial Approval', 'HAPR', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HEVD', 'equipment_hire', 'Hire Evidence', 'HEVD', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HDMG', 'equipment_hire', 'Hire Damage Assessment', 'HDMG', 1, 6, 'year', TRUE, FALSE, '-', TRUE)
ON DUPLICATE KEY UPDATE
    workspace_code = VALUES(workspace_code),
    document_name = VALUES(document_name),
    is_active = TRUE;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'release3c_hire_commercial_completion',
    'Adds Equipment Hire multi-item quotation and contract lines, rate cards, amendments, deposits/refunds, commercial approvals, evidence records, damage settlement and controlled dispatch/return numbers.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
