-- CHALIN 03 EQUIPMENT SALES & HIRE FOUNDATION
-- Heavy-equipment catalogue, media, sales, installment schedules, delivery and ownership transfer.
-- ADDITIVE / IDEMPOTENT MIGRATION ONLY.
-- BACKUP REQUIRED BEFORE PRODUCTION EXECUTION.
-- Existing Spare Parts sales, installments, Hire contracts, payments and fleet records are preserved.
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

DROP PROCEDURE IF EXISTS equipment_sales_add_column_if_missing $$
CREATE PROCEDURE equipment_sales_add_column_if_missing(
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
        SET @equipment_sales_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD COLUMN `', REPLACE(p_column_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE equipment_sales_stmt FROM @equipment_sales_sql;
        EXECUTE equipment_sales_stmt;
        DEALLOCATE PREPARE equipment_sales_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS equipment_sales_add_index_if_missing $$
CREATE PROCEDURE equipment_sales_add_index_if_missing(
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
        SET @equipment_sales_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD ', p_definition
        );
        PREPARE equipment_sales_stmt FROM @equipment_sales_sql;
        EXECUTE equipment_sales_stmt;
        DEALLOCATE PREPARE equipment_sales_stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS equipment_sales_add_fk_if_missing $$
CREATE PROCEDURE equipment_sales_add_fk_if_missing(
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
        SET @equipment_sales_sql = CONCAT(
            'ALTER TABLE `', REPLACE(p_table_name, '`', '``'),
            '` ADD CONSTRAINT `', REPLACE(p_constraint_name, '`', '``'),
            '` ', p_definition
        );
        PREPARE equipment_sales_stmt FROM @equipment_sales_sql;
        EXECUTE equipment_sales_stmt;
        DEALLOCATE PREPARE equipment_sales_stmt;
    END IF;
END $$

DELIMITER ;

-- ============================================================
-- SHARED EQUIPMENT MASTER
-- ============================================================

CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'hire_location_id',
    'INT NULL AFTER current_location'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'equipment_category',
    'VARCHAR(80) NULL AFTER asset_type'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'model_year',
    'SMALLINT UNSIGNED NULL AFTER model'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'chassis_number',
    'VARCHAR(120) NULL AFTER serial_number'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'engine_number',
    'VARCHAR(120) NULL AFTER chassis_number'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'colour',
    'VARCHAR(60) NULL AFTER engine_number'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'capacity_description',
    'VARCHAR(120) NULL AFTER colour'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'condition_status',
    "ENUM('new','excellent','good','fair','poor','damaged','under_inspection') NOT NULL DEFAULT 'good' AFTER capacity_description"
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'operational_purpose',
    "ENUM('hire_only','sale_only','sale_or_hire','company_operations') NOT NULL DEFAULT 'hire_only' AFTER ownership_type"
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'sale_status',
    "ENUM('not_for_sale','available','reserved','installment_active','sold','cancelled') NOT NULL DEFAULT 'not_for_sale' AFTER current_status"
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'acquisition_date',
    'DATE NULL AFTER registration_expiry'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'acquisition_cost',
    'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER acquisition_date'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'target_selling_price',
    'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER acquisition_cost'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'standard_hire_rate',
    'DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER target_selling_price'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'supplier_name',
    'VARCHAR(150) NULL AFTER standard_hire_rate'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'acquisition_reference',
    'VARCHAR(120) NULL AFTER supplier_name'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'main_image_url',
    'TEXT NULL AFTER acquisition_reference'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'sale_reserved_until',
    'DATETIME NULL AFTER main_image_url'
);
CALL equipment_sales_add_column_if_missing(
    'fleet_assets', 'sold_at',
    'DATETIME NULL AFTER sale_reserved_until'
);

CALL equipment_sales_add_index_if_missing(
    'fleet_assets', 'idx_fleet_asset_hire_location',
    'INDEX `idx_fleet_asset_hire_location` (`hire_location_id`, `is_active`)'
);
CALL equipment_sales_add_index_if_missing(
    'fleet_assets', 'idx_fleet_asset_purpose_status',
    'INDEX `idx_fleet_asset_purpose_status` (`operational_purpose`, `current_status`, `sale_status`)'
);
CALL equipment_sales_add_index_if_missing(
    'fleet_assets', 'idx_fleet_asset_make_model',
    'INDEX `idx_fleet_asset_make_model` (`make`, `model`, `model_year`)'
);
CALL equipment_sales_add_index_if_missing(
    'fleet_assets', 'idx_fleet_asset_serial_chassis',
    'INDEX `idx_fleet_asset_serial_chassis` (`serial_number`, `chassis_number`)'
);
CALL equipment_sales_add_index_if_missing(
    'fleet_assets', 'idx_fleet_asset_sale_reservation',
    'INDEX `idx_fleet_asset_sale_reservation` (`sale_status`, `sale_reserved_until`)'
);
CALL equipment_sales_add_fk_if_missing(
    'fleet_assets', 'fk_fleet_asset_hire_location',
    'FOREIGN KEY (`hire_location_id`) REFERENCES `business_locations` (`id`) ON DELETE SET NULL'
);

CREATE TABLE IF NOT EXISTS equipment_media (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    asset_id INT NOT NULL,
    hire_location_id INT NULL,
    media_category ENUM('photo','video','document') NOT NULL DEFAULT 'photo',
    evidence_type ENUM(
        'main','front','rear','left_side','right_side','cabin','engine',
        'serial_plate','chassis_plate','attachment','inspection','damage',
        'delivery','return','registration','insurance','ownership','other'
    ) NOT NULL DEFAULT 'other',
    file_url TEXT NOT NULL,
    storage_key VARCHAR(500) NULL,
    thumbnail_url TEXT NULL,
    file_name VARCHAR(255) NULL,
    mime_type VARCHAR(120) NULL,
    file_size_bytes BIGINT UNSIGNED NULL,
    caption VARCHAR(500) NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    captured_at DATETIME NULL,
    created_by INT NULL,
    archived_at DATETIME NULL,
    archived_by INT NULL,
    archive_reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_equipment_media_asset (asset_id, archived_at, sort_order),
    INDEX idx_equipment_media_location (hire_location_id, created_at),
    INDEX idx_equipment_media_type (asset_id, evidence_type, archived_at),
    INDEX idx_equipment_media_primary (asset_id, is_primary, archived_at),

    CONSTRAINT fk_equipment_media_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_media_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_media_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_media_archived_by
        FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- EQUIPMENT SALES ENQUIRIES AND QUOTATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_sales_enquiries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    enquiry_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    customer_id INT NOT NULL,
    enquiry_date DATE NOT NULL,
    asset_type VARCHAR(100) NOT NULL DEFAULT 'Excavator',
    preferred_make VARCHAR(100) NULL,
    preferred_model VARCHAR(100) NULL,
    condition_preference ENUM('new','used','either') NOT NULL DEFAULT 'either',
    budget_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    purchase_method ENUM('cash','installment','undecided') NOT NULL DEFAULT 'undecided',
    expected_purchase_date DATE NULL,
    source_channel VARCHAR(80) NULL,
    status ENUM('open','quoted','won','lost','cancelled') NOT NULL DEFAULT 'open',
    notes TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_equipment_sales_enquiry_location (hire_location_id, enquiry_date, status),
    INDEX idx_equipment_sales_enquiry_customer (customer_id, created_at),
    INDEX idx_equipment_sales_enquiry_asset (asset_type, preferred_make, preferred_model),

    CONSTRAINT fk_equipment_sales_enquiry_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sales_enquiry_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sales_enquiry_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sales_enquiry_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_sales_quotations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    quotation_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    enquiry_id BIGINT NULL,
    customer_id INT NOT NULL,
    quotation_date DATE NOT NULL,
    validity_date DATE NULL,
    status ENUM(
        'draft','pending_approval','approved','accepted','rejected',
        'expired','converted','cancelled'
    ) NOT NULL DEFAULT 'draft',
    subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    tax_rate_percent DECIMAL(7,4) NOT NULL DEFAULT 0.0000,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    deposit_required DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    proposed_frequency ENUM('weekly','fortnightly','monthly','custom') NULL,
    proposed_installment_count INT NULL,
    proposed_first_due_date DATE NULL,
    delivery_policy ENUM(
        'immediate','after_deposit','after_percentage','after_full_payment'
    ) NOT NULL DEFAULT 'after_deposit',
    delivery_threshold_percent DECIMAL(7,4) NOT NULL DEFAULT 0.0000,
    terms TEXT NULL,
    notes TEXT NULL,
    approval_reason VARCHAR(500) NULL,
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_equipment_sales_quote_location (hire_location_id, quotation_date, status),
    INDEX idx_equipment_sales_quote_customer (customer_id, created_at),
    INDEX idx_equipment_sales_quote_enquiry (enquiry_id),
    INDEX idx_equipment_sales_quote_approval (hire_location_id, status, created_at),

    CONSTRAINT fk_equipment_sales_quote_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sales_quote_enquiry
        FOREIGN KEY (enquiry_id) REFERENCES equipment_sales_enquiries(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sales_quote_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sales_quote_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sales_quote_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_sales_quotation_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    quotation_id BIGINT NOT NULL,
    hire_location_id INT NOT NULL,
    line_number INT NOT NULL,
    asset_id INT NOT NULL,
    asset_code_snapshot VARCHAR(50) NOT NULL,
    asset_name_snapshot VARCHAR(150) NOT NULL,
    asset_type_snapshot VARCHAR(100) NOT NULL,
    make_snapshot VARCHAR(100) NULL,
    model_snapshot VARCHAR(100) NULL,
    model_year_snapshot SMALLINT UNSIGNED NULL,
    serial_number_snapshot VARCHAR(120) NULL,
    main_image_url_snapshot TEXT NULL,
    description VARCHAR(500) NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    line_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_equipment_sales_quote_line (quotation_id, line_number),
    INDEX idx_equipment_sales_quote_item_location (hire_location_id, quotation_id),
    INDEX idx_equipment_sales_quote_item_asset (asset_id, quotation_id),

    CONSTRAINT fk_equipment_sales_quote_item_quote
        FOREIGN KEY (quotation_id) REFERENCES equipment_sales_quotations(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_sales_quote_item_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sales_quote_item_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT
);

-- ============================================================
-- EQUIPMENT SALE / INSTALLMENT AGREEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_sale_agreements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    agreement_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    quotation_id BIGINT NULL,
    quotation_item_id BIGINT NULL,
    enquiry_id BIGINT NULL,
    customer_id INT NOT NULL,
    asset_id INT NOT NULL,
    sale_type ENUM('cash','installment') NOT NULL,
    agreement_status ENUM(
        'draft','pending_approval','approved','active','due_soon',
        'payment_due','overdue','completed','cancelled','defaulted'
    ) NOT NULL DEFAULT 'draft',
    approval_status ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required',

    customer_name_snapshot VARCHAR(150) NOT NULL,
    customer_phone_snapshot VARCHAR(30) NOT NULL,
    customer_location_snapshot VARCHAR(180) NULL,
    customer_id_type VARCHAR(60) NULL,
    customer_id_number VARCHAR(120) NULL,
    customer_id_document_url TEXT NULL,

    asset_code_snapshot VARCHAR(50) NOT NULL,
    asset_name_snapshot VARCHAR(150) NOT NULL,
    asset_type_snapshot VARCHAR(100) NOT NULL,
    make_snapshot VARCHAR(100) NULL,
    model_snapshot VARCHAR(100) NULL,
    model_year_snapshot SMALLINT UNSIGNED NULL,
    serial_number_snapshot VARCHAR(120) NULL,
    main_image_url_snapshot TEXT NULL,

    sale_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    deposit_required DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    deposit_received DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    financed_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    scheduled_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    late_charges_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    waived_charges_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    outstanding_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    overdue_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,

    payment_frequency ENUM('weekly','fortnightly','monthly','custom') NULL,
    installment_count INT NULL,
    first_due_date DATE NULL,
    next_due_date DATE NULL,
    final_due_date DATE NULL,
    grace_days INT NOT NULL DEFAULT 0,
    late_charge_type ENUM('none','fixed','percentage') NOT NULL DEFAULT 'none',
    late_charge_value DECIMAL(14,2) NOT NULL DEFAULT 0.00,

    delivery_policy ENUM(
        'immediate','after_deposit','after_percentage','after_full_payment'
    ) NOT NULL DEFAULT 'after_deposit',
    delivery_threshold_percent DECIMAL(7,4) NOT NULL DEFAULT 0.0000,
    delivery_status ENUM('reserved','approved','delivered','cancelled') NOT NULL DEFAULT 'reserved',
    ownership_status ENUM('retained','conditional','transferred','repossessed') NOT NULL DEFAULT 'retained',
    delivered_at DATETIME NULL,
    completed_at DATETIME NULL,

    guarantor_name VARCHAR(150) NULL,
    guarantor_phone VARCHAR(30) NULL,
    guarantor_location VARCHAR(180) NULL,
    guarantor_id_type VARCHAR(60) NULL,
    guarantor_id_number VARCHAR(120) NULL,
    guarantor_document_url TEXT NULL,
    terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    agreement_notes TEXT NULL,

    legacy_installment_agreement_id BIGINT NULL,
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    cancelled_by INT NULL,
    cancelled_at DATETIME NULL,
    cancellation_reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_equipment_sale_agreement_location (hire_location_id, agreement_status, next_due_date),
    INDEX idx_equipment_sale_agreement_customer (customer_id, created_at),
    INDEX idx_equipment_sale_agreement_asset (asset_id, agreement_status, created_at),
    INDEX idx_equipment_sale_agreement_approval (hire_location_id, approval_status, created_at),
    INDEX idx_equipment_sale_agreement_legacy (legacy_installment_agreement_id),

    CONSTRAINT fk_equipment_sale_agreement_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sale_agreement_quote
        FOREIGN KEY (quotation_id) REFERENCES equipment_sales_quotations(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_agreement_quote_item
        FOREIGN KEY (quotation_item_id) REFERENCES equipment_sales_quotation_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_agreement_enquiry
        FOREIGN KEY (enquiry_id) REFERENCES equipment_sales_enquiries(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_agreement_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sale_agreement_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sale_agreement_legacy
        FOREIGN KEY (legacy_installment_agreement_id) REFERENCES installment_agreements(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_agreement_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_agreement_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_agreement_cancelled_by
        FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_asset_sale_locks (
    asset_id INT PRIMARY KEY,
    agreement_id BIGINT NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    lock_status ENUM('reserved','installment_active','sold') NOT NULL,
    lock_reason VARCHAR(500) NULL,
    locked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    released_at DATETIME NULL,
    released_by INT NULL,
    release_reason VARCHAR(500) NULL,
    created_by INT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_equipment_sale_lock_location (hire_location_id, lock_status, expires_at),
    INDEX idx_equipment_sale_lock_agreement (agreement_id, lock_status),

    CONSTRAINT fk_equipment_sale_lock_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sale_lock_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_sale_lock_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sale_lock_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_lock_released_by
        FOREIGN KEY (released_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_installment_schedule (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    agreement_id BIGINT NOT NULL,
    sequence_number INT NOT NULL,
    due_date DATE NOT NULL,
    scheduled_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    late_charge_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    waived_charge_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    schedule_status ENUM(
        'upcoming','due','partial','paid','overdue','rescheduled','waived','cancelled'
    ) NOT NULL DEFAULT 'upcoming',
    fully_paid_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_equipment_installment_schedule (agreement_id, sequence_number),
    INDEX idx_equipment_installment_due (due_date, schedule_status),
    INDEX idx_equipment_installment_agreement_status (agreement_id, schedule_status),

    CONSTRAINT fk_equipment_installment_schedule_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS equipment_sale_payments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    payment_number VARCHAR(80) NOT NULL UNIQUE,
    receipt_number VARCHAR(100) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    agreement_id BIGINT NOT NULL,
    customer_id INT NOT NULL,
    payment_date DATETIME NOT NULL,
    payment_category ENUM('deposit','installment','settlement','adjustment','refund') NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    payment_method ENUM('cash','momo','bank','cheque','other') NOT NULL,
    reference_number VARCHAR(150) NULL,
    notes VARCHAR(500) NULL,
    received_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    is_voided BOOLEAN NOT NULL DEFAULT FALSE,
    void_reason VARCHAR(500) NULL,
    voided_by INT NULL,
    voided_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_equipment_sale_payment_location (hire_location_id, payment_date),
    INDEX idx_equipment_sale_payment_agreement (agreement_id, payment_date),
    INDEX idx_equipment_sale_payment_customer (customer_id, payment_date),
    INDEX idx_equipment_sale_payment_method (payment_method, payment_date),

    CONSTRAINT fk_equipment_sale_payment_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sale_payment_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sale_payment_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sale_payment_received_by
        FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_payment_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sale_payment_voided_by
        FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_sale_payment_allocations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    payment_id BIGINT NOT NULL,
    schedule_id BIGINT NOT NULL,
    allocated_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_equipment_sale_payment_schedule (payment_id, schedule_id),
    INDEX idx_equipment_sale_allocation_schedule (schedule_id),

    CONSTRAINT fk_equipment_sale_allocation_payment
        FOREIGN KEY (payment_id) REFERENCES equipment_sale_payments(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_sale_allocation_schedule
        FOREIGN KEY (schedule_id) REFERENCES equipment_installment_schedule(id) ON DELETE RESTRICT
);

-- ============================================================
-- DELIVERY, OWNERSHIP AND SMS EVIDENCE
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_deliveries (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    delivery_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    agreement_id BIGINT NOT NULL,
    customer_id INT NOT NULL,
    asset_id INT NOT NULL,
    delivery_datetime DATETIME NOT NULL,
    destination VARCHAR(255) NULL,
    meter_reading DECIMAL(14,2) NULL,
    fuel_level_percent DECIMAL(7,4) NULL,
    condition_status ENUM('new','excellent','good','fair','poor','damaged') NOT NULL,
    attachments_tools TEXT NULL,
    receiving_person VARCHAR(150) NOT NULL,
    receiving_phone VARCHAR(30) NULL,
    customer_signature_url TEXT NULL,
    delivery_note_url TEXT NULL,
    notes TEXT NULL,
    status ENUM('draft','approved','delivered','cancelled') NOT NULL DEFAULT 'draft',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_equipment_delivery_agreement (agreement_id),
    INDEX idx_equipment_delivery_location (hire_location_id, delivery_datetime, status),
    INDEX idx_equipment_delivery_asset (asset_id, delivery_datetime),

    CONSTRAINT fk_equipment_delivery_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_delivery_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_delivery_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_delivery_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_delivery_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_delivery_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_ownership_transfers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transfer_number VARCHAR(80) NOT NULL UNIQUE,
    hire_location_id INT NOT NULL,
    agreement_id BIGINT NOT NULL,
    customer_id INT NOT NULL,
    asset_id INT NOT NULL,
    transfer_date DATE NOT NULL,
    ownership_document_url TEXT NULL,
    registration_transfer_reference VARCHAR(150) NULL,
    notes TEXT NULL,
    status ENUM('draft','issued','revoked') NOT NULL DEFAULT 'draft',
    issued_by INT NULL,
    issued_at DATETIME NULL,
    revoked_by INT NULL,
    revoked_at DATETIME NULL,
    revocation_reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_equipment_ownership_agreement (agreement_id),
    UNIQUE KEY uq_equipment_ownership_asset (asset_id),
    INDEX idx_equipment_ownership_location (hire_location_id, transfer_date, status),
    INDEX idx_equipment_ownership_customer (customer_id, transfer_date),

    CONSTRAINT fk_equipment_ownership_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_ownership_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_ownership_customer
        FOREIGN KEY (customer_id) REFERENCES hire_customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_ownership_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_ownership_issued_by
        FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_ownership_revoked_by
        FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_sales_reminder_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    hire_location_id INT NOT NULL,
    agreement_id BIGINT NOT NULL,
    schedule_id BIGINT NULL,
    reminder_key VARCHAR(191) NOT NULL UNIQUE,
    reminder_type ENUM(
        'quotation_ready','quotation_expiring','agreement_created','deposit_received',
        'due_soon','due_today','overdue','payment_receipt','delivery_scheduled',
        'delivered','completed','ownership_ready','manual'
    ) NOT NULL DEFAULT 'manual',
    recipient_phone VARCHAR(30) NOT NULL,
    sms_log_id INT NULL,
    delivery_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    message_preview VARCHAR(500) NULL,
    sent_by INT NULL,
    sent_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_equipment_sales_reminder_agreement (agreement_id, created_at),
    INDEX idx_equipment_sales_reminder_schedule (schedule_id, created_at),
    INDEX idx_equipment_sales_reminder_location (hire_location_id, created_at),

    CONSTRAINT fk_equipment_sales_reminder_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_sales_reminder_agreement
        FOREIGN KEY (agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE CASCADE,
    CONSTRAINT fk_equipment_sales_reminder_schedule
        FOREIGN KEY (schedule_id) REFERENCES equipment_installment_schedule(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sales_reminder_sms
        FOREIGN KEY (sms_log_id) REFERENCES sms_log(id) ON DELETE SET NULL,
    CONSTRAINT fk_equipment_sales_reminder_sent_by
        FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS equipment_legacy_installment_migrations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    legacy_agreement_id BIGINT NOT NULL UNIQUE,
    equipment_agreement_id BIGINT NOT NULL UNIQUE,
    asset_id INT NOT NULL,
    original_sale_id INT NOT NULL,
    original_branch_id INT NOT NULL,
    original_amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    original_outstanding_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    migrated_amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    migrated_outstanding_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    reconciliation_status ENUM('pending','matched','variance','reversed') NOT NULL DEFAULT 'pending',
    reconciliation_notes TEXT NULL,
    source_snapshot_json LONGTEXT NOT NULL,
    migrated_by INT NOT NULL,
    migrated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,

    INDEX idx_equipment_legacy_migration_asset (asset_id, migrated_at),
    INDEX idx_equipment_legacy_migration_status (reconciliation_status, migrated_at),

    CONSTRAINT fk_equipment_legacy_migration_legacy
        FOREIGN KEY (legacy_agreement_id) REFERENCES installment_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_legacy_migration_equipment
        FOREIGN KEY (equipment_agreement_id) REFERENCES equipment_sale_agreements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_legacy_migration_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_legacy_migration_sale
        FOREIGN KEY (original_sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_legacy_migration_branch
        FOREIGN KEY (original_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_legacy_migration_user
        FOREIGN KEY (migrated_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_equipment_legacy_migration_reviewer
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- CENTRAL SMS CONTEXT FOR ALL THREE WORKSPACES
-- ============================================================

CALL equipment_sales_add_column_if_missing(
    'sms_log', 'workspace_code',
    "VARCHAR(50) NOT NULL DEFAULT 'spare_parts' AFTER branch_id"
);
CALL equipment_sales_add_column_if_missing(
    'sms_log', 'business_unit_id',
    'INT NULL AFTER workspace_code'
);
CALL equipment_sales_add_column_if_missing(
    'sms_log', 'hire_location_id',
    'INT NULL AFTER business_unit_id'
);
CALL equipment_sales_add_column_if_missing(
    'sms_log', 'entity_type',
    'VARCHAR(80) NULL AFTER source_reference'
);
CALL equipment_sales_add_column_if_missing(
    'sms_log', 'entity_id',
    'VARCHAR(80) NULL AFTER entity_type'
);
CALL equipment_sales_add_column_if_missing(
    'sms_log', 'template_code',
    'VARCHAR(100) NULL AFTER entity_id'
);
CALL equipment_sales_add_column_if_missing(
    'sms_log', 'deduplication_key',
    'VARCHAR(191) NULL AFTER template_code'
);
CALL equipment_sales_add_column_if_missing(
    'sms_log', 'scheduled_for',
    'DATETIME NULL AFTER deduplication_key'
);
CALL equipment_sales_add_column_if_missing(
    'sms_log', 'consent_basis',
    'VARCHAR(100) NULL AFTER scheduled_for'
);

CALL equipment_sales_add_index_if_missing(
    'sms_log', 'idx_sms_workspace_context',
    'INDEX `idx_sms_workspace_context` (`workspace_code`, `hire_location_id`, `created_at`)'
);
CALL equipment_sales_add_index_if_missing(
    'sms_log', 'idx_sms_entity',
    'INDEX `idx_sms_entity` (`entity_type`, `entity_id`, `created_at`)'
);
CALL equipment_sales_add_index_if_missing(
    'sms_log', 'uq_sms_deduplication_key',
    'UNIQUE KEY `uq_sms_deduplication_key` (`deduplication_key`)'
);
CALL equipment_sales_add_fk_if_missing(
    'sms_log', 'fk_sms_business_unit',
    'FOREIGN KEY (`business_unit_id`) REFERENCES `business_units` (`id`) ON DELETE SET NULL'
);
CALL equipment_sales_add_fk_if_missing(
    'sms_log', 'fk_sms_hire_location',
    'FOREIGN KEY (`hire_location_id`) REFERENCES `business_locations` (`id`) ON DELETE SET NULL'
);

-- ============================================================
-- DATABASE-LEVEL DOUBLE-BOOKING / DOUBLE-SALE GUARDS
-- ============================================================

DELIMITER $$

DROP TRIGGER IF EXISTS trg_hire_contract_asset_sale_guard_before_insert $$
CREATE TRIGGER trg_hire_contract_asset_sale_guard_before_insert
BEFORE INSERT ON hire_contract_assets
FOR EACH ROW
BEGIN
    DECLARE blocked_count INT DEFAULT 0;

    SELECT COUNT(*)
    INTO blocked_count
    FROM fleet_assets fa
    LEFT JOIN equipment_asset_sale_locks easl
      ON easl.asset_id = fa.id
     AND easl.released_at IS NULL
    WHERE fa.id = NEW.asset_id
      AND (
        fa.operational_purpose = 'sale_only'
        OR fa.sale_status IN ('reserved','installment_active','sold')
        OR easl.asset_id IS NOT NULL
      );

    IF blocked_count > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'This equipment is reserved, under installment sale, sold, or marked sale-only and cannot be assigned for hire.';
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_hire_contract_asset_sale_guard_before_update $$
CREATE TRIGGER trg_hire_contract_asset_sale_guard_before_update
BEFORE UPDATE ON hire_contract_assets
FOR EACH ROW
BEGIN
    DECLARE blocked_count INT DEFAULT 0;

    IF NEW.asset_id <> OLD.asset_id
       OR NEW.status IN ('assigned','dispatched','active') THEN
        SELECT COUNT(*)
        INTO blocked_count
        FROM fleet_assets fa
        LEFT JOIN equipment_asset_sale_locks easl
          ON easl.asset_id = fa.id
         AND easl.released_at IS NULL
        WHERE fa.id = NEW.asset_id
          AND (
            fa.operational_purpose = 'sale_only'
            OR fa.sale_status IN ('reserved','installment_active','sold')
            OR easl.asset_id IS NOT NULL
          );

        IF blocked_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'This equipment is reserved, under installment sale, sold, or marked sale-only and cannot be activated for hire.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_sale_agreement_hire_guard_before_insert $$
CREATE TRIGGER trg_equipment_sale_agreement_hire_guard_before_insert
BEFORE INSERT ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE active_hire_count INT DEFAULT 0;
    DECLARE sale_allowed_count INT DEFAULT 0;

    IF NEW.agreement_status IN ('approved','active','due_soon','payment_due','overdue','completed') THEN
        SELECT COUNT(*)
        INTO active_hire_count
        FROM hire_contract_assets hca
        WHERE hca.asset_id = NEW.asset_id
          AND hca.status IN ('assigned','dispatched','active');

        SELECT COUNT(*)
        INTO sale_allowed_count
        FROM fleet_assets fa
        WHERE fa.id = NEW.asset_id
          AND fa.is_active = TRUE
          AND fa.operational_purpose IN ('sale_only','sale_or_hire')
          AND fa.sale_status NOT IN ('sold','cancelled')
          AND (fa.hire_location_id IS NULL OR fa.hire_location_id = NEW.hire_location_id);

        IF active_hire_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Equipment currently assigned or dispatched for hire cannot enter an approved sale agreement.';
        END IF;

        IF sale_allowed_count = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The selected equipment is not available for sale at this Equipment Hire location.';
        END IF;
    END IF;
END $$

DROP TRIGGER IF EXISTS trg_equipment_sale_agreement_hire_guard_before_update $$
CREATE TRIGGER trg_equipment_sale_agreement_hire_guard_before_update
BEFORE UPDATE ON equipment_sale_agreements
FOR EACH ROW
BEGIN
    DECLARE active_hire_count INT DEFAULT 0;
    DECLARE sale_allowed_count INT DEFAULT 0;

    IF NEW.agreement_status IN ('approved','active','due_soon','payment_due','overdue','completed')
       AND (
         OLD.agreement_status <> NEW.agreement_status
         OR OLD.asset_id <> NEW.asset_id
         OR OLD.hire_location_id <> NEW.hire_location_id
       ) THEN
        SELECT COUNT(*)
        INTO active_hire_count
        FROM hire_contract_assets hca
        WHERE hca.asset_id = NEW.asset_id
          AND hca.status IN ('assigned','dispatched','active');

        SELECT COUNT(*)
        INTO sale_allowed_count
        FROM fleet_assets fa
        WHERE fa.id = NEW.asset_id
          AND fa.is_active = TRUE
          AND fa.operational_purpose IN ('sale_only','sale_or_hire')
          AND fa.sale_status NOT IN ('sold','cancelled')
          AND (fa.hire_location_id IS NULL OR fa.hire_location_id = NEW.hire_location_id);

        IF active_hire_count > 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Equipment currently assigned or dispatched for hire cannot enter an approved sale agreement.';
        END IF;

        IF sale_allowed_count = 0 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'The selected equipment is not available for sale at this Equipment Hire location.';
        END IF;
    END IF;
END $$

DELIMITER ;

DROP PROCEDURE IF EXISTS equipment_sales_add_column_if_missing;
DROP PROCEDURE IF EXISTS equipment_sales_add_index_if_missing;
DROP PROCEDURE IF EXISTS equipment_sales_add_fk_if_missing;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260722_equipment_sales_installments_foundation',
    'Adds the shared equipment catalogue, media gallery, equipment sales, installment schedules, payments, delivery, ownership transfer, SMS context and double-booking guards.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT
    'Equipment Sales & Hire foundation migration completed.' AS result,
    DATABASE() AS selected_database;
