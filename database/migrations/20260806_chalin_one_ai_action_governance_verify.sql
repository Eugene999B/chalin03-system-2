-- Read-only CHALIN ONE AI action-governance verifier.

SELECT COUNT(*) AS migration_record_count
FROM schema_migrations
WHERE migration_name = '20260806_chalin_one_ai_action_governance';

SELECT COUNT(*) AS action_governance_table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('ai_action_proposals', 'ai_action_reviews');

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('ai_action_proposals', 'ai_action_reviews')
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS forbidden_secret_column_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('ai_action_proposals', 'ai_action_reviews')
  AND COLUMN_NAME REGEXP '(^|_)(password|password_hash|secret|api_key|access_token|refresh_token|jwt|database_url|db_password)($|_)';

SELECT COUNT(*) AS executed_proposal_count
FROM ai_action_proposals
WHERE proposal_status = 'executed';
