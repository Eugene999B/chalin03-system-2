-- CHALIN 03 RELEASE 3F-A VERIFICATION
-- Every returned status must be PASS and every problem_count must be 0.

SELECT
    'release3fa_migration_marker' AS check_name,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
    ABS(COUNT(*) - 1) AS problem_count
FROM schema_migrations
WHERE migration_name = 'release3fa_authentication_sessions_ux';

SELECT
    'users_login_phone_column' AS check_name,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
    ABS(COUNT(*) - 1) AS problem_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME = 'login_phone_normalized';

SELECT
    'users_login_phone_unique_index' AS check_name,
    CASE WHEN COUNT(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
    ABS(COUNT(*) - 1) AS problem_count
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND INDEX_NAME = 'uq_users_login_phone_normalized'
  AND NON_UNIQUE = 0;

SELECT
    'duplicate_login_phone_values' AS check_name,
    CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
    COUNT(*) AS problem_count
FROM (
    SELECT login_phone_normalized
    FROM users
    WHERE login_phone_normalized IS NOT NULL
    GROUP BY login_phone_normalized
    HAVING COUNT(*) > 1
) duplicates;

SELECT
    'session_evidence_columns' AS check_name,
    CASE WHEN COUNT(*) = 24 THEN 'PASS' ELSE 'FAIL' END AS status,
    ABS(COUNT(*) - 24) AS problem_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'auth_sessions'
  AND COLUMN_NAME IN (
      'login_method',
      'device_type',
      'device_label',
      'device_model',
      'device_platform',
      'architecture',
      'os_name',
      'os_version',
      'browser_name',
      'browser_version',
      'client_timezone',
      'client_language',
      'screen_width',
      'screen_height',
      'pixel_ratio',
      'touch_points',
      'pwa_mode',
      'location_permission',
      'location_source',
      'latitude',
      'longitude',
      'location_accuracy_m',
      'location_recorded_at',
      'network_country'
  );

SELECT
    'phone_normalization_triggers' AS check_name,
    CASE WHEN COUNT(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS status,
    ABS(COUNT(*) - 2) AS problem_count
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE()
  AND TRIGGER_NAME IN (
      'trg_users_release3fa_phone_insert',
      'trg_users_release3fa_phone_update'
  );
