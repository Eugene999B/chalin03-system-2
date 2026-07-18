-- CHALIN 03 RELEASE 3F-C VERIFICATION
-- Read-only checks. No business data is changed.

SELECT DATABASE() AS selected_database, NOW() AS verified_at;

SELECT
    migration_name,
    applied_at,
    description
FROM schema_migrations
WHERE migration_name = 'release3fc_user_permissions_security_messages';

SELECT
    TABLE_NAME,
    TABLE_ROWS
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'user_permission_overrides',
      'security_event_dismissals'
  )
ORDER BY TABLE_NAME;

SELECT
    TABLE_NAME,
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'user_permission_overrides',
      'security_event_dismissals'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT
    TABLE_NAME,
    INDEX_NAME,
    NON_UNIQUE,
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'user_permission_overrides',
      'security_event_dismissals'
  )
GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
ORDER BY TABLE_NAME, INDEX_NAME;

SELECT
    CONSTRAINT_NAME,
    TABLE_NAME,
    REFERENCED_TABLE_NAME
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'user_permission_overrides',
      'security_event_dismissals'
  )
ORDER BY TABLE_NAME, CONSTRAINT_NAME;
