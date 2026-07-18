-- CHALIN 03 RELEASE 3D
-- Central in-app notifications, workspace/context targeting, reminders and controlled escalation evidence.
-- ADDITIVE / IDEMPOTENT MIGRATION ONLY.
-- No existing business table or record is deleted.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS notification_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rule_code VARCHAR(120) NOT NULL,
    rule_name VARCHAR(180) NOT NULL,
    workspace_code VARCHAR(50) NOT NULL DEFAULT 'group',
    category VARCHAR(60) NOT NULL DEFAULT 'operations',
    default_severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    target_role VARCHAR(60) NULL,
    target_permission VARCHAR(120) NULL,
    escalation_minutes INT NOT NULL DEFAULT 0,
    sms_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    description VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_notification_rule_code (rule_code),
    INDEX idx_notification_rule_workspace (workspace_code, is_enabled),
    INDEX idx_notification_rule_category (category, is_enabled)
);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    notification_key VARCHAR(191) NOT NULL,
    rule_id INT NULL,
    rule_code VARCHAR(120) NULL,
    workspace_code VARCHAR(50) NOT NULL DEFAULT 'group',
    branch_id INT NULL,
    mining_site_id INT NULL,
    hire_location_id INT NULL,
    target_user_id INT NULL,
    target_role VARCHAR(60) NULL,
    target_permission VARCHAR(120) NULL,
    category VARCHAR(60) NOT NULL DEFAULT 'operations',
    notification_type VARCHAR(60) NOT NULL DEFAULT 'alert',
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    title VARCHAR(220) NOT NULL,
    message VARCHAR(1200) NOT NULL,
    action_path VARCHAR(500) NULL,
    source_type VARCHAR(80) NULL,
    source_id BIGINT NULL,
    source_reference VARCHAR(180) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    auto_generated BOOLEAN NOT NULL DEFAULT TRUE,
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_at DATETIME NULL,
    first_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    resolved_by INT NULL,
    resolution_note VARCHAR(500) NULL,
    metadata_json LONGTEXT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_notification_key (notification_key),
    INDEX idx_notification_workspace_status (workspace_code, status, severity),
    INDEX idx_notification_branch_status (branch_id, status),
    INDEX idx_notification_mining_status (mining_site_id, status),
    INDEX idx_notification_hire_status (hire_location_id, status),
    INDEX idx_notification_target_user (target_user_id, status),
    INDEX idx_notification_rule_status (rule_code, status),
    INDEX idx_notification_due (status, due_at),
    INDEX idx_notification_detected (last_detected_at),

    CONSTRAINT fk_notification_rule
        FOREIGN KEY (rule_id) REFERENCES notification_rules(id) ON DELETE SET NULL,
    CONSTRAINT fk_notification_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_mining_site
        FOREIGN KEY (mining_site_id) REFERENCES mining_sites(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_hire_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_target_user
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_resolved_by
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_notification_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notification_user_states (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    notification_id BIGINT NOT NULL,
    user_id INT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at DATETIME NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at DATETIME NULL,
    muted_until DATETIME NULL,
    last_seen_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_notification_user_state (notification_id, user_id),
    INDEX idx_notification_user_unread (user_id, is_archived, is_read),
    INDEX idx_notification_user_archive (user_id, is_archived, updated_at),

    CONSTRAINT fk_notification_state_notification
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_state_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_escalations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    notification_id BIGINT NOT NULL,
    escalation_channel VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted',
    destination_masked VARCHAR(80) NULL,
    provider_reference VARCHAR(180) NULL,
    response_message VARCHAR(500) NULL,
    attempted_by INT NULL,
    attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_notification_escalation_notification (notification_id, attempted_at),
    INDEX idx_notification_escalation_status (status, attempted_at),

    CONSTRAINT fk_notification_escalation_notification
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_escalation_user
        FOREIGN KEY (attempted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notification_sync_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    workspace_code VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'running',
    generated_count INT NOT NULL DEFAULT 0,
    resolved_count INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    details_json LONGTEXT NULL,
    started_by INT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,

    INDEX idx_notification_sync_workspace (workspace_code, started_at),
    INDEX idx_notification_sync_status (status, started_at),

    CONSTRAINT fk_notification_sync_user
        FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO notification_rules (
    rule_code, rule_name, workspace_code, category, default_severity,
    target_role, target_permission, escalation_minutes, sms_allowed, is_enabled, description
) VALUES
('spare_parts.low_stock', 'Spare Parts low stock', 'spare_parts', 'inventory', 'medium', 'manager', 'spare_parts.manage', 1440, FALSE, TRUE, 'Products at or below their configured restock level.'),
('spare_parts.overdue_debt', 'Spare Parts overdue debt', 'spare_parts', 'finance', 'high', 'manager', 'spare_parts.audit', 1440, FALSE, TRUE, 'Customer debt balances past their due date.'),
('mining.stockpile_low', 'Mining stockpile low level', 'mining', 'stockpile', 'high', 'site_supervisor', 'mining.stockpiles.view', 240, FALSE, TRUE, 'Active stockpiles at or below their minimum quantity.'),
('mining.fuel_tank_low', 'Mining fuel tank low level', 'mining', 'fuel', 'high', 'site_supervisor', 'mining.fuel_control.view', 120, FALSE, TRUE, 'Active fuel tanks at or below their minimum level.'),
('mining.dispatch_pending', 'Mining dispatch approval pending', 'mining', 'approval', 'medium', 'site_supervisor', 'mining.dispatch.approve', 120, FALSE, TRUE, 'Submitted dispatches awaiting independent approval.'),
('mining.fuel_variance', 'Mining fuel variance', 'mining', 'fuel', 'high', 'manager', 'mining.fuel_control.approve', 60, TRUE, TRUE, 'Fuel reconciliation variance requiring review and independent approval.'),
('mining.closing_pending', 'Mining site closing pending', 'mining', 'approval', 'medium', 'manager', 'mining.closing.approve', 180, FALSE, TRUE, 'Submitted site closing awaiting approval.'),
('mining.incident_open', 'Mining serious incident open', 'mining', 'safety', 'critical', 'manager', 'mining.incidents.view', 30, TRUE, TRUE, 'Open high or critical Mining safety incident.'),
('hire.invoice_overdue', 'Equipment Hire invoice overdue', 'equipment_hire', 'finance', 'high', 'accountant', 'hire.invoices.view', 1440, FALSE, TRUE, 'Issued or part-paid invoice with an overdue balance.'),
('hire.contract_overdue', 'Equipment Hire contract overdue', 'equipment_hire', 'contracts', 'high', 'manager', 'hire.contracts.view', 720, FALSE, TRUE, 'Active contract beyond its expected end date.'),
('hire.approval_pending', 'Equipment Hire commercial approval pending', 'equipment_hire', 'approval', 'medium', 'manager', 'hire.commercial.approve', 120, FALSE, TRUE, 'Commercial approval awaiting an independent decision.'),
('hire.deposit_pending', 'Equipment Hire deposit action pending', 'equipment_hire', 'finance', 'high', 'accountant', 'hire.commercial.approve', 120, FALSE, TRUE, 'Deposit refund or forfeiture awaiting approval.'),
('hire.damage_open', 'Equipment Hire damage settlement open', 'equipment_hire', 'damage', 'high', 'manager', 'hire.commercial.damage', 240, FALSE, TRUE, 'Damage assessment not yet fully settled.'),
('hire.work_log_pending', 'Equipment Hire work log pending', 'equipment_hire', 'approval', 'medium', 'manager', 'hire.work_logs.approve', 1440, FALSE, TRUE, 'Draft work log awaiting review and approval.')
ON DUPLICATE KEY UPDATE
    rule_name = VALUES(rule_name),
    workspace_code = VALUES(workspace_code),
    category = VALUES(category),
    description = VALUES(description);

INSERT IGNORE INTO schema_migrations (migration_name, description)
VALUES (
    '20260718_release3d_notifications_group_alerts',
    'Adds central in-app notifications, workspace/site/location targeting, user read/archive state, operational alert rules, sync evidence and controlled escalation history.'
);

SELECT 'RELEASE 3D NOTIFICATIONS MIGRATION COMPLETE' AS result;
