-- CHALIN ONE DOCUMENT INTELLIGENCE READ-ONLY VERIFIER

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('ai_knowledge_documents', 'ai_knowledge_chunks')
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('ai_knowledge_documents', 'ai_knowledge_chunks')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT COUNT(*) AS forbidden_secret_columns
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('ai_knowledge_documents', 'ai_knowledge_chunks')
  AND LOWER(COLUMN_NAME) REGEXP '(^|_)(password|password_hash|secret|api_key|access_token|refresh_token|jwt|database_url|db_password)($|_)';

SELECT COUNT(*) AS raw_binary_rows
FROM ai_knowledge_documents
WHERE raw_binary_stored <> 0;

SELECT COUNT(*) AS orphan_document_versions
FROM ai_knowledge_documents d
LEFT JOIN ai_knowledge_versions v ON v.id = d.version_id
WHERE v.id IS NULL;

SELECT COUNT(*) AS orphan_chunks
FROM ai_knowledge_chunks c
LEFT JOIN ai_knowledge_documents d ON d.id = c.document_id
LEFT JOIN ai_knowledge_versions v ON v.id = c.version_id
WHERE d.id IS NULL OR v.id IS NULL;

SELECT migration_name, applied_at, description
FROM schema_migrations
WHERE migration_name = '20260807_chalin_one_document_intelligence';
