-- Read-only verification for 20260806_chalin_one_ai_foundation.sql

SELECT
    sm.migration_name,
    sm.applied_at,
    sm.description
FROM schema_migrations sm
WHERE sm.migration_name = '20260806_chalin_one_ai_foundation';

SELECT
    t.TABLE_NAME AS table_name,
    t.ENGINE AS engine,
    t.TABLE_COLLATION AS table_collation
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_NAME IN (
    'ai_provider_profiles',
    'ai_conversations',
    'ai_messages',
    'ai_tool_invocations',
    'ai_evidence_records',
    'ai_usage_ledger',
    'ai_audit_events',
    'ai_prompt_safety_events',
    'ai_knowledge_sources',
    'ai_knowledge_versions',
    'ai_knowledge_approvals',
    'ai_feedback'
  )
ORDER BY t.TABLE_NAME;

SELECT
    COUNT(*) AS forbidden_secret_column_count
FROM information_schema.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.TABLE_NAME LIKE 'ai\_%'
  AND LOWER(c.COLUMN_NAME) REGEXP '(^|_)(password|password_hash|secret|api_key|access_token|refresh_token|jwt|database_url|db_password)($|_)';

SELECT
    COUNT(*) AS ai_table_count
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_NAME IN (
    'ai_provider_profiles',
    'ai_conversations',
    'ai_messages',
    'ai_tool_invocations',
    'ai_evidence_records',
    'ai_usage_ledger',
    'ai_audit_events',
    'ai_prompt_safety_events',
    'ai_knowledge_sources',
    'ai_knowledge_versions',
    'ai_knowledge_approvals',
    'ai_feedback'
  );
