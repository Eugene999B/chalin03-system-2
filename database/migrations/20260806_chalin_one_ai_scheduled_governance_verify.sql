-- Read-only CHALIN ONE scheduled intelligence governance verifier.

SELECT COUNT(*) AS migration_record_count
FROM schema_migrations
WHERE migration_name = '20260806_chalin_one_ai_scheduled_governance';

SELECT COUNT(*) AS scheduled_governance_table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'ai_scheduled_job_definitions',
    'ai_scheduled_job_reviews',
    'ai_scheduled_job_run_evidence'
  );

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'ai_scheduled_job_definitions',
    'ai_scheduled_job_reviews',
    'ai_scheduled_job_run_evidence'
  )
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS forbidden_secret_column_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'ai_scheduled_job_definitions',
    'ai_scheduled_job_reviews',
    'ai_scheduled_job_run_evidence'
  )
  AND COLUMN_NAME REGEXP '(^|_)(password|password_hash|secret|api_key|access_token|refresh_token|jwt|database_url|db_password)($|_)';

SELECT COUNT(*) AS scheduled_run_count
FROM ai_scheduled_job_run_evidence;
