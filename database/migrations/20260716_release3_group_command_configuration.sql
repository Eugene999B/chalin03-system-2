-- CHALIN 03 RELEASE 3
-- Group Command Centre, protected group configuration and document sequences.
-- Additive migration only.
-- No existing business record is deleted.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    migration_name VARCHAR(150) NOT NULL UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT NULL,
    INDEX idx_schema_migration_name (migration_name),
    INDEX idx_schema_migration_applied_at (applied_at)
);

CREATE TABLE IF NOT EXISTS group_configuration (
    setting_key VARCHAR(120) PRIMARY KEY,
    setting_group VARCHAR(80) NOT NULL,
    setting_label VARCHAR(180) NOT NULL,
    setting_description TEXT NULL,
    value_type VARCHAR(30) NOT NULL DEFAULT 'text',
    value_text LONGTEXT NULL,
    is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    is_editable BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_group_configuration_updated_by
        FOREIGN KEY (updated_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_group_configuration_group (
        setting_group,
        sort_order
    ),

    INDEX idx_group_configuration_editable (
        is_editable
    )
);

CREATE TABLE IF NOT EXISTS group_configuration_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(120) NOT NULL,
    old_value_text LONGTEXT NULL,
    new_value_text LONGTEXT NULL,
    change_reason VARCHAR(500) NOT NULL,
    changed_by INT NULL,
    request_id VARCHAR(100) NULL,
    ip_address VARCHAR(50) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_group_configuration_history_setting
        FOREIGN KEY (setting_key)
        REFERENCES group_configuration(setting_key)
        ON DELETE RESTRICT,

    CONSTRAINT fk_group_configuration_history_user
        FOREIGN KEY (changed_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_group_configuration_history_setting (
        setting_key,
        created_at
    ),

    INDEX idx_group_configuration_history_user (
        changed_by,
        created_at
    )
);

CREATE TABLE IF NOT EXISTS document_sequences (
    sequence_code VARCHAR(40) PRIMARY KEY,
    workspace_code VARCHAR(50) NOT NULL,
    document_name VARCHAR(150) NOT NULL,
    prefix VARCHAR(30) NOT NULL,
    next_number BIGINT NOT NULL DEFAULT 1,
    padding INT NOT NULL DEFAULT 6,
    reset_policy VARCHAR(20) NOT NULL DEFAULT 'none',
    last_reset_key VARCHAR(20) NULL,
    include_year BOOLEAN NOT NULL DEFAULT TRUE,
    include_month BOOLEAN NOT NULL DEFAULT FALSE,
    separator VARCHAR(5) NOT NULL DEFAULT '-',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_document_sequence_updated_by
        FOREIGN KEY (updated_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_document_sequence_workspace (
        workspace_code,
        is_active
    )
);

CREATE TABLE IF NOT EXISTS document_sequence_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sequence_code VARCHAR(40) NOT NULL,
    old_definition_json LONGTEXT NULL,
    new_definition_json LONGTEXT NULL,
    change_reason VARCHAR(500) NOT NULL,
    changed_by INT NULL,
    request_id VARCHAR(100) NULL,
    ip_address VARCHAR(50) NULL,
    user_agent VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_document_sequence_history_sequence
        FOREIGN KEY (sequence_code)
        REFERENCES document_sequences(sequence_code)
        ON DELETE RESTRICT,

    CONSTRAINT fk_document_sequence_history_user
        FOREIGN KEY (changed_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_document_sequence_history_code (
        sequence_code,
        created_at
    )
);

INSERT INTO group_configuration (
    setting_key,
    setting_group,
    setting_label,
    setting_description,
    value_type,
    value_text,
    is_sensitive,
    is_editable,
    sort_order
)
VALUES
    (
        'company.name',
        'company',
        'Company name',
        'Official company name used on group-level documents and reports.',
        'text',
        'Chalin 03 Company Limited',
        FALSE,
        TRUE,
        10
    ),
    (
        'company.short_name',
        'company',
        'Company short name',
        'Short name used where document space is limited.',
        'text',
        'Chalin 03',
        FALSE,
        TRUE,
        20
    ),
    (
        'company.currency',
        'company',
        'Currency',
        'Three-letter reporting currency.',
        'currency',
        'GHS',
        FALSE,
        TRUE,
        30
    ),
    (
        'company.timezone',
        'company',
        'Business timezone',
        'Timezone used by group reports and operational controls.',
        'timezone',
        'Africa/Accra',
        FALSE,
        TRUE,
        40
    ),
    (
        'company.tax_rate_percent',
        'company',
        'Default tax rate',
        'Default group tax percentage. Individual business documents may override it.',
        'decimal',
        '0',
        FALSE,
        TRUE,
        50
    ),
    (
        'workspace.spare_parts_name',
        'workspaces',
        'Spare Parts workspace name',
        'Display name for the Spare Parts business.',
        'text',
        'Spare Parts',
        FALSE,
        TRUE,
        10
    ),
    (
        'workspace.mining_name',
        'workspaces',
        'Mining workspace name',
        'Display name for Mining Operations.',
        'text',
        'Mining Operations',
        FALSE,
        TRUE,
        20
    ),
    (
        'workspace.hire_name',
        'workspaces',
        'Equipment Hire workspace name',
        'Display name for Equipment Hire.',
        'text',
        'Equipment Hire',
        FALSE,
        TRUE,
        30
    ),
    (
        'units.production',
        'units',
        'Default production unit',
        'Default Mining production measurement.',
        'text',
        'tonnes',
        FALSE,
        TRUE,
        10
    ),
    (
        'units.fuel',
        'units',
        'Fuel unit',
        'Measurement used for fuel receipts and issues.',
        'text',
        'litres',
        FALSE,
        TRUE,
        20
    ),
    (
        'units.distance',
        'units',
        'Distance unit',
        'Measurement used for haulage and mobilisation distance.',
        'text',
        'kilometres',
        FALSE,
        TRUE,
        30
    ),
    (
        'threshold.backup_max_age_hours',
        'thresholds',
        'Maximum backup age',
        'Alert when the latest professional backup is older than this number of hours.',
        'integer',
        '24',
        FALSE,
        TRUE,
        10
    ),
    (
        'threshold.document_expiry_days',
        'thresholds',
        'Document expiry warning',
        'Number of days before worker and asset document expiry alerts begin.',
        'integer',
        '30',
        FALSE,
        TRUE,
        20
    ),
    (
        'threshold.license_expiry_days',
        'thresholds',
        'Licence expiry warning',
        'Number of days before worker licence expiry alerts begin.',
        'integer',
        '30',
        FALSE,
        TRUE,
        30
    ),
    (
        'threshold.property_return_grace_days',
        'thresholds',
        'Property return grace period',
        'Days allowed after an expected company-property return date.',
        'integer',
        '0',
        FALSE,
        TRUE,
        40
    ),
    (
        'threshold.owner_failed_login_alert_count',
        'thresholds',
        'Owner failed-login threshold',
        'Failed Owner Break-Glass logins within 24 hours before an alert is raised.',
        'integer',
        '1',
        FALSE,
        TRUE,
        50
    ),
    (
        'threshold.application_error_alert_count',
        'thresholds',
        'Application error threshold',
        'Server errors within 24 hours before an Executive alert is raised.',
        'integer',
        '1',
        FALSE,
        TRUE,
        60
    ),
    (
        'feature.group_notifications_enabled',
        'features',
        'Group notifications',
        'Allows Release 3 operational alerts to be generated. Live delivery remains separately controlled.',
        'boolean',
        '1',
        FALSE,
        TRUE,
        10
    ),
    (
        'feature.mining_stockpile_enabled',
        'features',
        'Mining stockpile controls',
        'Release 3 feature readiness flag for Mining stockpile controls.',
        'boolean',
        '1',
        FALSE,
        TRUE,
        20
    ),
    (
        'feature.hire_settlement_enabled',
        'features',
        'Hire settlement controls',
        'Release 3 feature readiness flag for deposits, damage and final settlement.',
        'boolean',
        '1',
        FALSE,
        TRUE,
        30
    )
ON DUPLICATE KEY UPDATE
    setting_group = VALUES(setting_group),
    setting_label = VALUES(setting_label),
    setting_description = VALUES(setting_description),
    value_type = VALUES(value_type),
    is_sensitive = VALUES(is_sensitive),
    is_editable = VALUES(is_editable),
    sort_order = VALUES(sort_order);

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
    separator,
    is_active
)
VALUES
    ('HENQ', 'equipment_hire', 'Hire Enquiry', 'HENQ', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HQUO', 'equipment_hire', 'Hire Quotation', 'HQUO', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HCON', 'equipment_hire', 'Hire Contract', 'HCON', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HINV', 'equipment_hire', 'Hire Invoice', 'HINV', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HPAY', 'equipment_hire', 'Hire Payment', 'HPAY', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HDSP', 'equipment_hire', 'Hire Dispatch', 'HDSP', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('HRET', 'equipment_hire', 'Hire Return', 'HRET', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('MSTK', 'mining', 'Mining Stockpile Movement', 'MSTK', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('MDSP', 'mining', 'Mining Dispatch', 'MDSP', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('MFUE', 'mining', 'Mining Fuel Transaction', 'MFUE', 1, 6, 'year', TRUE, FALSE, '-', TRUE),
    ('MSCL', 'mining', 'Mining Site Close', 'MSCL', 1, 6, 'year', TRUE, FALSE, '-', TRUE)
ON DUPLICATE KEY UPDATE
    workspace_code = VALUES(workspace_code),
    document_name = VALUES(document_name);

INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'release3_group_command_configuration',
    'Adds protected group configuration, configuration history, database-backed document sequences and Group Command Centre foundations.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);