-- CHALIN 03 SPARE PARTS USER SETTINGS ACCESS CONTROL
-- Additive production migration: adds the persisted switch used by
-- /api/settings/user-settings-access. Default OFF preserves existing
-- administrator access until the System Administrator enables the control.

ALTER TABLE settings
  ADD COLUMN user_settings_system_admin_only TINYINT(1) NOT NULL DEFAULT 0;

INSERT INTO schema_migrations (migration_name, description)
VALUES (
  '20260901_spare_parts_user_settings_access_control',
  'Adds the persisted Spare Parts User Settings System Administrator-only access control switch.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'settings'
  AND COLUMN_NAME = 'user_settings_system_admin_only';
