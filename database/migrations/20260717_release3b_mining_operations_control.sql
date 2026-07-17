-- CHALIN 03 RELEASE 3B
-- Mining stockpile, dispatch, fuel reconciliation, workforce and site-closing controls.
-- ADDITIVE MIGRATION ONLY.
-- No existing table or business record is deleted.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS mining_stockpiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    stockpile_code VARCHAR(60) NOT NULL,
    stockpile_name VARCHAR(160) NOT NULL,
    material_type VARCHAR(120) NULL,
    grade_quality VARCHAR(120) NULL,
    unit VARCHAR(40) NOT NULL DEFAULT 'tonnes',
    physical_location VARCHAR(255) NULL,
    capacity_quantity DECIMAL(16,3) NULL,
    minimum_quantity DECIMAL(16,3) NOT NULL DEFAULT 0.000,
    opening_quantity DECIMAL(16,3) NOT NULL DEFAULT 0.000,
    current_quantity DECIMAL(16,3) NOT NULL DEFAULT 0.000,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    notes TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_mining_stockpile_site_code (site_id, stockpile_code),
    INDEX idx_mining_stockpile_site_status (site_id, status),
    INDEX idx_mining_stockpile_low_level (site_id, current_quantity, minimum_quantity),

    CONSTRAINT fk_mining_stockpile_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_stockpile_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_stockpile_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mining_dispatches (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    dispatch_number VARCHAR(80) NOT NULL UNIQUE,
    site_id INT NOT NULL,
    stockpile_id INT NOT NULL,
    dispatch_datetime DATETIME NOT NULL,
    quantity DECIMAL(16,3) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    customer_name VARCHAR(180) NULL,
    destination VARCHAR(255) NOT NULL,
    receiver_name VARCHAR(180) NULL,
    receiver_phone VARCHAR(40) NULL,
    haulage_company VARCHAR(180) NULL,
    vehicle_registration VARCHAR(80) NULL,
    driver_name VARCHAR(180) NULL,
    driver_phone VARCHAR(40) NULL,
    weighbridge_ticket VARCHAR(120) NULL,
    gross_weight DECIMAL(16,3) NULL,
    tare_weight DECIMAL(16,3) NULL,
    net_weight DECIMAL(16,3) NULL,
    evidence_reference VARCHAR(500) NULL,
    notes TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted',
    movement_id BIGINT NULL,
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    cancelled_by INT NULL,
    cancelled_at DATETIME NULL,
    cancellation_reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_mining_dispatch_site_date (site_id, dispatch_datetime),
    INDEX idx_mining_dispatch_stockpile (stockpile_id, status),
    INDEX idx_mining_dispatch_status (status),
    INDEX idx_mining_dispatch_vehicle (vehicle_registration),

    CONSTRAINT fk_mining_dispatch_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_dispatch_stockpile
        FOREIGN KEY (stockpile_id) REFERENCES mining_stockpiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_dispatch_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_dispatch_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_dispatch_cancelled_by
        FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mining_stockpile_movements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    movement_number VARCHAR(80) NOT NULL UNIQUE,
    movement_group_number VARCHAR(80) NULL,
    site_id INT NOT NULL,
    stockpile_id INT NOT NULL,
    related_stockpile_id INT NULL,
    dispatch_id BIGINT NULL,
    production_record_id INT NULL,
    movement_type VARCHAR(40) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    quantity DECIMAL(16,3) NOT NULL,
    balance_before DECIMAL(16,3) NOT NULL,
    balance_after DECIMAL(16,3) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    movement_datetime DATETIME NOT NULL,
    external_reference VARCHAR(160) NULL,
    evidence_reference VARCHAR(500) NULL,
    explanation TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_mining_stockpile_movement_site_date (site_id, movement_datetime),
    INDEX idx_mining_stockpile_movement_stockpile (stockpile_id, movement_datetime),
    INDEX idx_mining_stockpile_movement_group (movement_group_number),
    INDEX idx_mining_stockpile_movement_type (movement_type),
    INDEX idx_mining_stockpile_movement_dispatch (dispatch_id),
    INDEX idx_mining_stockpile_movement_production (production_record_id),

    CONSTRAINT fk_mining_stockpile_movement_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_stockpile_movement_stockpile
        FOREIGN KEY (stockpile_id) REFERENCES mining_stockpiles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_stockpile_movement_related
        FOREIGN KEY (related_stockpile_id) REFERENCES mining_stockpiles(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_stockpile_movement_dispatch
        FOREIGN KEY (dispatch_id) REFERENCES mining_dispatches(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_stockpile_movement_production
        FOREIGN KEY (production_record_id) REFERENCES mining_production_records(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_stockpile_movement_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- movement_id is intentionally not constrained to avoid a circular foreign-key dependency.

CREATE TABLE IF NOT EXISTS mining_fuel_tanks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    tank_code VARCHAR(60) NOT NULL,
    tank_name VARCHAR(160) NOT NULL,
    fuel_type VARCHAR(60) NOT NULL DEFAULT 'diesel',
    physical_location VARCHAR(255) NULL,
    capacity_litres DECIMAL(16,2) NOT NULL,
    minimum_level_litres DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    opening_balance_litres DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    current_balance_litres DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    notes TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_mining_fuel_tank_site_code (site_id, tank_code),
    INDEX idx_mining_fuel_tank_site_status (site_id, status),
    INDEX idx_mining_fuel_tank_low_level (site_id, current_balance_litres, minimum_level_litres),

    CONSTRAINT fk_mining_fuel_tank_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_fuel_tank_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_fuel_tank_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mining_fuel_transactions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_number VARCHAR(80) NOT NULL UNIQUE,
    transfer_group_number VARCHAR(80) NULL,
    site_id INT NOT NULL,
    tank_id INT NOT NULL,
    related_tank_id INT NULL,
    asset_id INT NULL,
    transaction_type VARCHAR(40) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    transaction_datetime DATETIME NOT NULL,
    quantity_litres DECIMAL(16,2) NOT NULL,
    balance_before_litres DECIMAL(16,2) NOT NULL,
    balance_after_litres DECIMAL(16,2) NOT NULL,
    unit_cost DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    total_cost DECIMAL(16,2) NOT NULL DEFAULT 0.00,
    meter_reading DECIMAL(16,2) NULL,
    supplier_or_source VARCHAR(180) NULL,
    recipient_name VARCHAR(180) NULL,
    reference_number VARCHAR(160) NULL,
    evidence_reference VARCHAR(500) NULL,
    notes TEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_mining_fuel_transaction_site_date (site_id, transaction_datetime),
    INDEX idx_mining_fuel_transaction_tank_date (tank_id, transaction_datetime),
    INDEX idx_mining_fuel_transaction_asset_date (asset_id, transaction_datetime),
    INDEX idx_mining_fuel_transaction_type (transaction_type),
    INDEX idx_mining_fuel_transaction_transfer (transfer_group_number),

    CONSTRAINT fk_mining_fuel_transaction_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_fuel_transaction_tank
        FOREIGN KEY (tank_id) REFERENCES mining_fuel_tanks(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_fuel_transaction_related_tank
        FOREIGN KEY (related_tank_id) REFERENCES mining_fuel_tanks(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_fuel_transaction_asset
        FOREIGN KEY (asset_id) REFERENCES fleet_assets(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_fuel_transaction_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mining_fuel_reconciliations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    reconciliation_number VARCHAR(80) NOT NULL UNIQUE,
    site_id INT NOT NULL,
    tank_id INT NOT NULL,
    reconciliation_datetime DATETIME NOT NULL,
    expected_balance_litres DECIMAL(16,2) NOT NULL,
    physical_balance_litres DECIMAL(16,2) NOT NULL,
    variance_litres DECIMAL(16,2) NOT NULL,
    variance_percent DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    dip_reference VARCHAR(160) NULL,
    evidence_reference VARCHAR(500) NULL,
    explanation TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted',
    adjustment_transaction_id BIGINT NULL,
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_mining_fuel_reconciliation_site_date (site_id, reconciliation_datetime),
    INDEX idx_mining_fuel_reconciliation_tank (tank_id, status),
    INDEX idx_mining_fuel_reconciliation_status (status),

    CONSTRAINT fk_mining_fuel_reconciliation_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_fuel_reconciliation_tank
        FOREIGN KEY (tank_id) REFERENCES mining_fuel_tanks(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_fuel_reconciliation_adjustment
        FOREIGN KEY (adjustment_transaction_id) REFERENCES mining_fuel_transactions(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_fuel_reconciliation_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_fuel_reconciliation_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mining_contractors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    site_id INT NOT NULL,
    contractor_code VARCHAR(60) NOT NULL,
    contractor_name VARCHAR(180) NOT NULL,
    registration_number VARCHAR(120) NULL,
    service_type VARCHAR(120) NULL,
    contact_person VARCHAR(180) NULL,
    phone VARCHAR(40) NULL,
    email VARCHAR(180) NULL,
    address VARCHAR(255) NULL,
    agreement_reference VARCHAR(500) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    notes TEXT NULL,
    created_by INT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_mining_contractor_site_code (site_id, contractor_code),
    INDEX idx_mining_contractor_site_status (site_id, status),
    INDEX idx_mining_contractor_name (contractor_name),

    CONSTRAINT fk_mining_contractor_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_contractor_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_contractor_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mining_shift_crews (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    crew_number VARCHAR(80) NOT NULL UNIQUE,
    site_id INT NOT NULL,
    shift_date DATE NOT NULL,
    shift_code VARCHAR(30) NOT NULL,
    supervisor_worker_id BIGINT NULL,
    contractor_id INT NULL,
    work_area VARCHAR(180) NULL,
    planned_headcount INT NOT NULL DEFAULT 0,
    actual_headcount INT NOT NULL DEFAULT 0,
    ppe_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    licence_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    toolbox_talk_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    attendance_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_mining_shift_crew_site_date (site_id, shift_date, shift_code),
    INDEX idx_mining_shift_crew_status (status),
    INDEX idx_mining_shift_crew_supervisor (supervisor_worker_id),
    INDEX idx_mining_shift_crew_contractor (contractor_id),

    CONSTRAINT fk_mining_shift_crew_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_shift_crew_supervisor
        FOREIGN KEY (supervisor_worker_id) REFERENCES worker_profiles(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_shift_crew_contractor
        FOREIGN KEY (contractor_id) REFERENCES mining_contractors(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_shift_crew_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_shift_crew_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mining_shift_crew_members (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    crew_id BIGINT NOT NULL,
    worker_id BIGINT NULL,
    external_worker_name VARCHAR(180) NULL,
    role_or_task VARCHAR(160) NULL,
    attendance_status VARCHAR(30) NOT NULL DEFAULT 'present',
    ppe_status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
    licence_status VARCHAR(30) NOT NULL DEFAULT 'not_required',
    hours_worked DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    notes VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_mining_shift_crew_member_crew (crew_id),
    INDEX idx_mining_shift_crew_member_worker (worker_id),
    UNIQUE KEY uq_mining_shift_crew_worker (crew_id, worker_id),

    CONSTRAINT fk_mining_shift_crew_member_crew
        FOREIGN KEY (crew_id) REFERENCES mining_shift_crews(id) ON DELETE CASCADE,
    CONSTRAINT fk_mining_shift_crew_member_worker
        FOREIGN KEY (worker_id) REFERENCES worker_profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mining_site_closings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    closing_number VARCHAR(80) NOT NULL UNIQUE,
    site_id INT NOT NULL,
    closing_type VARCHAR(30) NOT NULL DEFAULT 'daily',
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    production_complete BOOLEAN NOT NULL DEFAULT FALSE,
    stockpile_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
    fuel_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
    equipment_logs_complete BOOLEAN NOT NULL DEFAULT FALSE,
    workforce_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    expenses_recorded BOOLEAN NOT NULL DEFAULT FALSE,
    incidents_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    corrective_actions_reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    management_notes TEXT NULL,
    exceptions_notes TEXT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted',
    created_by INT NULL,
    approved_by INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_mining_site_closing_site_period (site_id, period_start, period_end),
    INDEX idx_mining_site_closing_status (status),
    UNIQUE KEY uq_mining_site_closing_period (site_id, closing_type, period_start, period_end),

    CONSTRAINT fk_mining_site_closing_site
        FOREIGN KEY (site_id) REFERENCES mining_sites(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mining_site_closing_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mining_site_closing_approved_by
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
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
    ('MCRW', 'mining', 'Mining Shift Crew', 'MCRW', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('MFRC', 'mining', 'Mining Fuel Reconciliation', 'MFRC', 1, 6, 'year', TRUE, FALSE, '-', TRUE)
ON DUPLICATE KEY UPDATE
    workspace_code = VALUES(workspace_code),
    document_name = VALUES(document_name),
    is_active = TRUE;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    'release3b_mining_operations_control',
    'Adds Mining stockpiles, dispatch control, fuel tanks and reconciliation, contractors, shift crews and site-period closing.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
