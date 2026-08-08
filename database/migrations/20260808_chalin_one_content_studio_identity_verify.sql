-- CHALIN ONE CONTENT STUDIO IDENTITY READ-ONLY VERIFIER

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'content_studio_roles',
    'content_studio_role_permissions',
    'content_studio_role_scopes',
    'content_studio_user_access'
  )
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'content_studio_roles',
    'content_studio_role_permissions',
    'content_studio_role_scopes',
    'content_studio_user_access'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT role_code, name, is_system_role, is_active
FROM content_studio_roles
WHERE role_code IN (
  'content_administrator',
  'editor',
  'news_editor',
  'media_manager',
  'reviewer',
  'publisher'
)
ORDER BY sort_order, role_code;

SELECT r.role_code, COUNT(rp.permission_code) AS permission_count
FROM content_studio_roles r
LEFT JOIN content_studio_role_permissions rp ON rp.role_id = r.id
GROUP BY r.id, r.role_code
ORDER BY r.sort_order, r.role_code;

SELECT r.role_code, COUNT(rs.scope_code) AS scope_count
FROM content_studio_roles r
LEFT JOIN content_studio_role_scopes rs ON rs.role_id = r.id
GROUP BY r.id, r.role_code
ORDER BY r.sort_order, r.role_code;

SELECT COUNT(*) AS invalid_access_modes
FROM content_studio_user_access
WHERE access_mode NOT IN ('studio_only', 'hybrid');

SELECT COUNT(*) AS orphan_role_permissions
FROM content_studio_role_permissions rp
LEFT JOIN content_studio_roles r ON r.id = rp.role_id
WHERE r.id IS NULL;

SELECT COUNT(*) AS orphan_role_scopes
FROM content_studio_role_scopes rs
LEFT JOIN content_studio_roles r ON r.id = rs.role_id
WHERE r.id IS NULL;

SELECT COUNT(*) AS orphan_studio_users
FROM content_studio_user_access a
LEFT JOIN users u ON u.id = a.user_id
LEFT JOIN content_studio_roles r ON r.id = a.role_id
WHERE u.id IS NULL OR r.id IS NULL;

SELECT migration_name, applied_at, description
FROM schema_migrations
WHERE migration_name = '20260808_chalin_one_content_studio_identity';
