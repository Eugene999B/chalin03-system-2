-- CHALIN 03 INVENTORY COUNT SNAPSHOT HARDENING
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED before any future production use.
-- Depends on inventory traceability + inventory loss detection foundations.

CREATE TABLE IF NOT EXISTS inventory_count_expected_units (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT NOT NULL,
    scope_id BIGINT NOT NULL,
    branch_id INT NOT NULL,
    product_id INT NOT NULL,
    unit_id BIGINT NOT NULL,
    unit_code_snapshot VARCHAR(40) NOT NULL,
    status_snapshot VARCHAR(30) NOT NULL,
    current_location_snapshot VARCHAR(120) NULL,
    custody_user_id_snapshot INT NULL,
    last_event_id_snapshot BIGINT NULL,
    last_event_at_snapshot DATETIME NULL,
    snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_inventory_count_expected_scope_unit (scope_id, unit_id),
    INDEX idx_inventory_count_expected_session (session_id, product_id),
    INDEX idx_inventory_count_expected_code (unit_code_snapshot),
    INDEX idx_inventory_count_expected_status (branch_id, status_snapshot, snapshot_at),

    CONSTRAINT fk_inventory_count_expected_session
        FOREIGN KEY (session_id) REFERENCES inventory_count_sessions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_expected_scope
        FOREIGN KEY (scope_id) REFERENCES inventory_count_scope(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_expected_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_expected_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_expected_unit
        FOREIGN KEY (unit_id) REFERENCES inventory_units(id) ON DELETE RESTRICT,
    CONSTRAINT fk_inventory_count_expected_custody
        FOREIGN KEY (custody_user_id_snapshot) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inventory_count_expected_last_event
        FOREIGN KEY (last_event_id_snapshot) REFERENCES inventory_unit_events(id) ON DELETE SET NULL
);

INSERT INTO schema_migrations (migration_name, description)
SELECT
    '20260810_inventory_count_snapshot_hardening',
    'Freezes exact expected serialized unit identities and last-known evidence at blind-count session creation time.'
WHERE NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE migration_name = '20260810_inventory_count_snapshot_hardening'
);
