-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and separate SQL backup must be verified before production execution.
-- This migration adds the CHALIN ONE Content Studio identity and role foundation only.
-- It does not assign existing operational users to Content Studio and does not remove business data.

CREATE TABLE IF NOT EXISTS content_studio_roles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    role_code VARCHAR(80) NOT NULL,
    name VARCHAR(140) NOT NULL,
    description VARCHAR(500) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_system_role TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_content_studio_role_code (role_code),
    KEY idx_content_studio_role_active (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_studio_role_permissions (
    role_id BIGINT UNSIGNED NOT NULL,
    permission_code VARCHAR(120) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_code),
    KEY idx_content_studio_role_permission_code (permission_code),
    CONSTRAINT fk_content_studio_role_permission_role
        FOREIGN KEY (role_id) REFERENCES content_studio_roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_studio_role_scopes (
    role_id BIGINT UNSIGNED NOT NULL,
    scope_code VARCHAR(80) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, scope_code),
    KEY idx_content_studio_role_scope_code (scope_code),
    CONSTRAINT fk_content_studio_role_scope_role
        FOREIGN KEY (role_id) REFERENCES content_studio_roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_studio_user_access (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    access_mode ENUM('studio_only', 'hybrid') NOT NULL DEFAULT 'studio_only',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT NULL,
    updated_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_content_studio_user_access_user (user_id),
    KEY idx_content_studio_user_access_role (role_id, is_active),
    KEY idx_content_studio_user_access_created_by (created_by),
    CONSTRAINT fk_content_studio_user_access_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_content_studio_user_access_role
        FOREIGN KEY (role_id) REFERENCES content_studio_roles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_content_studio_user_access_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_content_studio_user_access_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO content_studio_roles
    (role_code, name, description, sort_order, is_system_role, is_active)
VALUES
    ('content_administrator', 'Content Administrator', 'Full Content Studio administration except ownership of the protected System Administrator identity.', 10, 1, 1),
    ('editor', 'Editor', 'Creates and edits governed website pages, company content and forms, then submits work for review.', 20, 1, 1),
    ('news_editor', 'News Editor', 'Creates and edits governed newsroom content and selects approved media.', 30, 1, 1),
    ('media_manager', 'Media Manager', 'Organizes and manages approved public media without operational business access.', 40, 1, 1),
    ('reviewer', 'Reviewer', 'Reviews and approves submitted public content without publishing it.', 50, 1, 1),
    ('publisher', 'Publisher', 'Publishes approved public content and can restore or archive governed versions.', 60, 1, 1);

INSERT IGNORE INTO content_studio_role_permissions (role_id, permission_code)
SELECT r.id, p.permission_code
FROM content_studio_roles r
JOIN (
    SELECT 'public_content.view' AS permission_code UNION ALL
    SELECT 'public_content.create' UNION ALL
    SELECT 'public_content.edit' UNION ALL
    SELECT 'public_content.submit' UNION ALL
    SELECT 'public_content.review' UNION ALL
    SELECT 'public_content.approve' UNION ALL
    SELECT 'public_content.publish' UNION ALL
    SELECT 'public_content.archive' UNION ALL
    SELECT 'public_content.restore_version' UNION ALL
    SELECT 'public_media.view' UNION ALL
    SELECT 'public_media.manage' UNION ALL
    SELECT 'public_navigation.view' UNION ALL
    SELECT 'public_navigation.manage' UNION ALL
    SELECT 'public_settings.view' UNION ALL
    SELECT 'public_settings.manage' UNION ALL
    SELECT 'public_forms.view' UNION ALL
    SELECT 'public_forms.manage' UNION ALL
    SELECT 'public_submissions.view' UNION ALL
    SELECT 'public_submissions.respond' UNION ALL
    SELECT 'public_submissions.manage'
) p
WHERE r.role_code = 'content_administrator';

INSERT IGNORE INTO content_studio_role_permissions (role_id, permission_code)
SELECT r.id, p.permission_code
FROM content_studio_roles r
JOIN (
    SELECT 'public_content.view' AS permission_code UNION ALL
    SELECT 'public_content.create' UNION ALL
    SELECT 'public_content.edit' UNION ALL
    SELECT 'public_content.submit' UNION ALL
    SELECT 'public_media.view' UNION ALL
    SELECT 'public_forms.view' UNION ALL
    SELECT 'public_forms.manage' UNION ALL
    SELECT 'public_navigation.view' UNION ALL
    SELECT 'public_settings.view'
) p
WHERE r.role_code = 'editor';

INSERT IGNORE INTO content_studio_role_permissions (role_id, permission_code)
SELECT r.id, p.permission_code
FROM content_studio_roles r
JOIN (
    SELECT 'public_content.view' AS permission_code UNION ALL
    SELECT 'public_content.create' UNION ALL
    SELECT 'public_content.edit' UNION ALL
    SELECT 'public_content.submit' UNION ALL
    SELECT 'public_media.view'
) p
WHERE r.role_code = 'news_editor';

INSERT IGNORE INTO content_studio_role_permissions (role_id, permission_code)
SELECT r.id, p.permission_code
FROM content_studio_roles r
JOIN (
    SELECT 'public_content.view' AS permission_code UNION ALL
    SELECT 'public_media.view' UNION ALL
    SELECT 'public_media.manage'
) p
WHERE r.role_code = 'media_manager';

INSERT IGNORE INTO content_studio_role_permissions (role_id, permission_code)
SELECT r.id, p.permission_code
FROM content_studio_roles r
JOIN (
    SELECT 'public_content.view' AS permission_code UNION ALL
    SELECT 'public_content.review' UNION ALL
    SELECT 'public_content.approve' UNION ALL
    SELECT 'public_media.view' UNION ALL
    SELECT 'public_forms.view' UNION ALL
    SELECT 'public_navigation.view' UNION ALL
    SELECT 'public_settings.view'
) p
WHERE r.role_code = 'reviewer';

INSERT IGNORE INTO content_studio_role_permissions (role_id, permission_code)
SELECT r.id, p.permission_code
FROM content_studio_roles r
JOIN (
    SELECT 'public_content.view' AS permission_code UNION ALL
    SELECT 'public_content.review' UNION ALL
    SELECT 'public_content.approve' UNION ALL
    SELECT 'public_content.publish' UNION ALL
    SELECT 'public_content.archive' UNION ALL
    SELECT 'public_content.restore_version' UNION ALL
    SELECT 'public_media.view' UNION ALL
    SELECT 'public_forms.view' UNION ALL
    SELECT 'public_navigation.view' UNION ALL
    SELECT 'public_settings.view'
) p
WHERE r.role_code = 'publisher';

INSERT IGNORE INTO content_studio_role_scopes (role_id, scope_code)
SELECT r.id, s.scope_code
FROM content_studio_roles r
JOIN (
    SELECT 'dashboard' AS scope_code UNION ALL
    SELECT 'pages' UNION ALL
    SELECT 'newsroom' UNION ALL
    SELECT 'company' UNION ALL
    SELECT 'media' UNION ALL
    SELECT 'forms' UNION ALL
    SELECT 'submissions' UNION ALL
    SELECT 'navigation' UNION ALL
    SELECT 'settings'
) s
WHERE r.role_code = 'content_administrator';

INSERT IGNORE INTO content_studio_role_scopes (role_id, scope_code)
SELECT r.id, s.scope_code
FROM content_studio_roles r
JOIN (
    SELECT 'dashboard' AS scope_code UNION ALL
    SELECT 'pages' UNION ALL
    SELECT 'company' UNION ALL
    SELECT 'media' UNION ALL
    SELECT 'forms' UNION ALL
    SELECT 'navigation'
) s
WHERE r.role_code = 'editor';

INSERT IGNORE INTO content_studio_role_scopes (role_id, scope_code)
SELECT r.id, s.scope_code
FROM content_studio_roles r
JOIN (
    SELECT 'dashboard' AS scope_code UNION ALL
    SELECT 'newsroom' UNION ALL
    SELECT 'media'
) s
WHERE r.role_code = 'news_editor';

INSERT IGNORE INTO content_studio_role_scopes (role_id, scope_code)
SELECT r.id, s.scope_code
FROM content_studio_roles r
JOIN (
    SELECT 'dashboard' AS scope_code UNION ALL
    SELECT 'media'
) s
WHERE r.role_code = 'media_manager';

INSERT IGNORE INTO content_studio_role_scopes (role_id, scope_code)
SELECT r.id, s.scope_code
FROM content_studio_roles r
JOIN (
    SELECT 'dashboard' AS scope_code UNION ALL
    SELECT 'pages' UNION ALL
    SELECT 'newsroom' UNION ALL
    SELECT 'company' UNION ALL
    SELECT 'media' UNION ALL
    SELECT 'forms' UNION ALL
    SELECT 'navigation' UNION ALL
    SELECT 'settings'
) s
WHERE r.role_code = 'reviewer';

INSERT IGNORE INTO content_studio_role_scopes (role_id, scope_code)
SELECT r.id, s.scope_code
FROM content_studio_roles r
JOIN (
    SELECT 'dashboard' AS scope_code UNION ALL
    SELECT 'pages' UNION ALL
    SELECT 'newsroom' UNION ALL
    SELECT 'company' UNION ALL
    SELECT 'media' UNION ALL
    SELECT 'forms' UNION ALL
    SELECT 'navigation' UNION ALL
    SELECT 'settings'
) s
WHERE r.role_code = 'publisher';

INSERT INTO schema_migrations (migration_name, description)
VALUES (
    '20260808_chalin_one_content_studio_identity',
    'Add isolated CHALIN ONE Content Studio roles, permissions, scopes and user-access foundation'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
