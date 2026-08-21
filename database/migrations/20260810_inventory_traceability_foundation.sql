-- CHALIN 03 INVENTORY LOSS PREVENTION & TRACEABILITY — FOUNDATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Before any production use, create and verify both a current Professional Backup and a separate SQL/database backup.
-- Existing products remain quantity-tracked by default.
-- Never run database/schema.sql against production for this feature.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

SET @inventory_traceability_foundation_applied = (
    SELECT COUNT(*)
    FROM schema_migrations
    WHERE migration_name = '20260810_inventory_traceability_foundation'
);

DROP PROCEDURE IF EXISTS chalin03_traceability_add_column;
DROP PROCEDURE IF EXISTS chalin03_traceability_add_index;

DELIMITER $$

CREATE PROCEDURE chalin03_traceability_add_column(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @traceability_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition
        );
        PREPARE traceability_statement FROM @traceability_sql;
        EXECUTE traceability_statement;
        DEALLOCATE PREPARE traceability_statement;
    END IF;
END$$

CREATE PROCEDURE chalin03_traceability_add_index(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @traceability_sql = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD ', p_index_definition
        );
        PREPARE traceability_statement FROM @traceability_sql;
        EXECUTE traceability_statement;
        DEALLOCATE PREPARE traceability_statement;
    END IF;
END$$

DELIMITER ;

CALL chalin03_traceability_add_column(
    'products',
    'inventory_tracking_mode',
    '`inventory_tracking_mode` VARCHAR(20) NOT NULL DEFAULT ''quantity'' AFTER `barcode`'
);
CALL chalin03_traceability_add_column(
    'products',
    'inventory_product_code',
    '`inventory_product_code` VARCHAR(16) NULL AFTER `inventory_tracking_mode`'
);
CALL chalin03_traceability_add_column(
    'products',
    'inventory_risk_tier',
    '`inventory_risk_tier` VARCHAR(20) NOT NULL DEFAULT ''standard'' AFTER `inventory_product_code`'
);
CALL chalin03_traceability_add_column(
    'products',
    'inventory_traceability_state',
    '`inventory_traceability_state` VARCHAR(20) NOT NULL DEFAULT ''off'' AFTER `inventory_risk_tier`'
);
CALL chalin03_traceability_add_column(
    'products',
    'inventory_traceability_configured_by',
    '`inventory_traceability_configured_by` INT NULL AFTER `inventory_traceability_state`'
);
CALL chalin03_traceability_add_column(
    'products',
    'inventory_traceability_configured_at',
    '`inventory_traceability_configured_at` DATETIME NULL AFTER `inventory_traceability_configured_by`'
);

CALL chalin03_traceability_add_index(
    'products',
    'uq_product_branch_inventory_code',
    'UNIQUE INDEX `uq_product_branch_inventory_code` (`branch_id`, `inventory_product_code`)'
);
CALL chalin03_traceability_add_index(
    'products',
    'idx_product_inventory_tracking',
    'INDEX `idx_product_inventory_tracking` (`branch_id`, `inventory_tracking_mode`, `inventory_traceability_state`, `inventory_risk_tier`)'
);

CREATE TABLE IF NOT EXISTS inventory_label_batches (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    batch_code VARCHAR(40) NOT NULL,
    branch_id INT NOT NULL,
    product_id INT NOT NULL,
    source_type VARCHAR(40) NOT NULL DEFAULT 'opening_reconciliation',
    source_id BIGINT NULL,
    source_item_id BIGINT NULL,
    expected_quantity INT NOT NULL,
    generated_quantity INT NOT NULL DEFAULT 0,
    activated_quantity INT NOT NULL DEFAULT 0,
    voided_quantity INT NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    label_format VARCHAR(24) NULL,
    created_by INT NULL,
    printed_by INT NULL,
    verified_by INT NULL,
    activated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    printed_at DATETIME NULL,
    verified_at DATETIME NULL,
    activated_at DATETIME NULL,
    notes TEXT NULL,
    metadata_json JSON NULL,

    UNIQUE KEY uq_inventory_label_batch_code (batch_code),
    UNIQUE KEY uq_inventory_label_batch_source_item (branch_id, source_type, source_id, source_item_id),
    INDEX idx_inventory_label_batch_branch_product (branch_id, product_id, status),
    INDEX idx_inventory_label_batch_source (source_type, source_id, source_item_id),
    INDEX idx_inventory_label_batch_created_at (created_at),

    CONSTRAINT fk_inventory_label_batch_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_label_batch_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_label_batch_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_label_batch_printed_by
        FOREIGN KEY (printed_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_label_batch_verified_by
        FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_label_batch_activated_by
        FOREIGN KEY (activated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_units (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    unit_code VARCHAR(40) NOT NULL,
    product_id INT NOT NULL,
    origin_branch_id INT NOT NULL,
    current_branch_id INT NOT NULL,
    label_batch_id BIGINT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'label_pending',
    current_location VARCHAR(120) NULL,
    custody_user_id INT NULL,
    sale_id INT NULL,
    sale_item_id INT NULL,
    transfer_id INT NULL,
    return_id INT NULL,
    activated_by INT NULL,
    activated_at DATETIME NULL,
    last_verified_by INT NULL,
    last_verified_at DATETIME NULL,
    status_changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_inventory_unit_code (unit_code),
    INDEX idx_inventory_unit_product_status (product_id, current_branch_id, status),
    INDEX idx_inventory_unit_batch (label_batch_id, status),
    INDEX idx_inventory_unit_custody (current_branch_id, custody_user_id, status),
    INDEX idx_inventory_unit_sale (sale_id, sale_item_id),
    INDEX idx_inventory_unit_transfer (transfer_id),
    INDEX idx_inventory_unit_return (return_id),
    INDEX idx_inventory_unit_verified (last_verified_at),

    CONSTRAINT fk_inventory_unit_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_unit_origin_branch
        FOREIGN KEY (origin_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_unit_current_branch
        FOREIGN KEY (current_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_unit_batch
        FOREIGN KEY (label_batch_id) REFERENCES inventory_label_batches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_unit_custody_user
        FOREIGN KEY (custody_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_unit_activated_by
        FOREIGN KEY (activated_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_unit_verified_by
        FOREIGN KEY (last_verified_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_unit_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    unit_id BIGINT NOT NULL,
    event_sequence INT NOT NULL,
    branch_id INT NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    from_status VARCHAR(30) NULL,
    to_status VARCHAR(30) NULL,
    source_type VARCHAR(40) NULL,
    source_id BIGINT NULL,
    actor_user_id INT NULL,
    reason VARCHAR(500) NULL,
    request_id VARCHAR(100) NULL,
    metadata_json JSON NULL,
    previous_event_hash CHAR(64) NULL,
    event_hash CHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_inventory_unit_event_sequence (unit_id, event_sequence),
    UNIQUE KEY uq_inventory_unit_event_hash (event_hash),
    INDEX idx_inventory_unit_event_branch_date (branch_id, created_at),
    INDEX idx_inventory_unit_event_type (event_type, created_at),
    INDEX idx_inventory_unit_event_source (source_type, source_id),
    INDEX idx_inventory_unit_event_actor (actor_user_id, created_at),
    INDEX idx_inventory_unit_event_request (request_id),

    CONSTRAINT fk_inventory_unit_event_unit
        FOREIGN KEY (unit_id) REFERENCES inventory_units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_unit_event_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_unit_event_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_label_print_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    branch_id INT NOT NULL,
    label_batch_id BIGINT NOT NULL,
    unit_id BIGINT NULL,
    print_format VARCHAR(24) NOT NULL,
    copies INT NOT NULL DEFAULT 1,
    print_reason VARCHAR(500) NULL,
    printed_by INT NULL,
    approved_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_inventory_label_print_batch (label_batch_id, created_at),
    INDEX idx_inventory_label_print_unit (unit_id, created_at),
    INDEX idx_inventory_label_print_branch (branch_id, created_at),

    CONSTRAINT fk_inventory_label_print_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_label_print_batch
        FOREIGN KEY (label_batch_id) REFERENCES inventory_label_batches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_label_print_unit
        FOREIGN KEY (unit_id) REFERENCES inventory_units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_label_print_user
        FOREIGN KEY (printed_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_label_print_approver
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260810_inventory_traceability_foundation',
    'Adds product tracking/risk configuration plus label-batch, physical-unit, tamper-evident unit-event and label-print evidence tables for Inventory Loss Prevention & Traceability.'
WHERE @inventory_traceability_foundation_applied = 0;

DROP PROCEDURE IF EXISTS chalin03_traceability_add_index;
DROP PROCEDURE IF EXISTS chalin03_traceability_add_column;
