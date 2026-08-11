-- CHALIN 03 INVENTORY TRACEABILITY — SERIALIZED STOCK TRANSFERS
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Before any future production use, create and verify both a current Professional Backup and a separate SQL/database backup.
-- Depends on 20260810_inventory_traceability_foundation.sql and the existing stock transfer tables.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS inventory_transfer_units (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transfer_id BIGINT NOT NULL,
    transfer_item_id BIGINT NOT NULL,
    unit_id BIGINT NOT NULL,
    unit_code_snapshot VARCHAR(40) NOT NULL,
    source_product_id INT NOT NULL,
    destination_product_id INT NULL,
    from_branch_id INT NOT NULL,
    to_branch_id INT NOT NULL,
    dispatch_status VARCHAR(24) NOT NULL DEFAULT 'in_transit',
    receipt_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    dispatched_by INT NULL,
    dispatched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_by INT NULL,
    received_at DATETIME NULL,
    receipt_note VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_inventory_transfer_unit (transfer_id, unit_id),
    UNIQUE KEY uq_inventory_transfer_item_unit (transfer_item_id, unit_id),
    INDEX idx_inventory_transfer_unit_item (transfer_id, transfer_item_id, receipt_status),
    INDEX idx_inventory_transfer_unit_code (unit_code_snapshot, transfer_id),
    INDEX idx_inventory_transfer_unit_route (from_branch_id, to_branch_id, receipt_status),

    CONSTRAINT fk_inventory_transfer_unit_unit
        FOREIGN KEY (unit_id) REFERENCES inventory_units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_unit_source_product
        FOREIGN KEY (source_product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_unit_destination_product
        FOREIGN KEY (destination_product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_unit_from_branch
        FOREIGN KEY (from_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_unit_to_branch
        FOREIGN KEY (to_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_transfer_unit_dispatched_by
        FOREIGN KEY (dispatched_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_transfer_unit_received_by
        FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260811_inventory_transfer_traceability',
    'Adds exact serialized stock-transfer unit mappings so dispatch, receipt and transfer shortages retain physical identity evidence.'
WHERE NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE migration_name = '20260811_inventory_transfer_traceability'
);
