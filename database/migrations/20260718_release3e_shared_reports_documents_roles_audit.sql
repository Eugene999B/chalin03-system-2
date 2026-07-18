-- CHALIN 03 RELEASE 3E
-- Shared Reports, Documents, Roles and Audit Completion.
-- ADDITIVE / IDEMPOTENT MIGRATION ONLY.
-- No existing business table or record is deleted.
-- Do not run database/schema.sql against production.

CREATE TABLE IF NOT EXISTS shared_control_evidence (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    request_id VARCHAR(120) NULL,
    user_id INT NULL,
    workspace_code VARCHAR(50) NOT NULL DEFAULT 'spare_parts',
    branch_id INT NULL,
    mining_site_id INT NULL,
    hire_location_id INT NULL,
    context_type VARCHAR(40) NOT NULL DEFAULT 'group',
    context_id INT NULL,
    control_area VARCHAR(60) NOT NULL DEFAULT 'shared_control',
    action_type VARCHAR(40) NOT NULL DEFAULT 'view',
    document_type VARCHAR(80) NULL,
    document_id BIGINT NULL,
    document_number VARCHAR(180) NULL,
    export_format VARCHAR(20) NULL,
    description VARCHAR(1000) NULL,
    metadata_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_shared_control_created (created_at, id),
    INDEX idx_shared_control_workspace (workspace_code, created_at),
    INDEX idx_shared_control_branch (branch_id, created_at),
    INDEX idx_shared_control_mining (mining_site_id, created_at),
    INDEX idx_shared_control_hire (hire_location_id, created_at),
    INDEX idx_shared_control_user (user_id, created_at),
    INDEX idx_shared_control_area_action (control_area, action_type, created_at),
    INDEX idx_shared_control_document (document_type, document_id, created_at),
    INDEX idx_shared_control_request (request_id),

    CONSTRAINT fk_shared_control_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_shared_control_branch
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    CONSTRAINT fk_shared_control_mining_site
        FOREIGN KEY (mining_site_id) REFERENCES mining_sites(id) ON DELETE SET NULL,
    CONSTRAINT fk_shared_control_hire_location
        FOREIGN KEY (hire_location_id) REFERENCES business_locations(id) ON DELETE SET NULL
);

INSERT IGNORE INTO schema_migrations (migration_name, description)
VALUES (
    '20260718_release3e_shared_reports_documents_roles_audit',
    'Adds shared document, report and audit access evidence with workspace, branch, Mining-site and Hire-location context for Release 3E.'
);

SELECT 'RELEASE 3E SHARED CONTROL MIGRATION COMPLETE' AS result;
