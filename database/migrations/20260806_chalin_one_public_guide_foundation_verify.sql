-- Read-only CHALIN ONE public Guide foundation verifier.

SELECT COUNT(*) AS migration_record_count
FROM schema_migrations
WHERE migration_name = '20260806_chalin_one_public_guide_foundation';

SELECT COUNT(*) AS public_guide_table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'ai_public_guide_sessions',
    'ai_public_guide_messages'
  );

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'ai_public_guide_sessions',
    'ai_public_guide_messages'
  )
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS forbidden_secret_column_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'ai_public_guide_sessions',
    'ai_public_guide_messages'
  )
  AND COLUMN_NAME REGEXP '(^|_)(password|password_hash|secret|api_key|access_token|refresh_token|jwt|database_url|db_password)($|_)';
