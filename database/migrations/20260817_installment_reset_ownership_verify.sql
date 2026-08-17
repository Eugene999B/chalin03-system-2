SELECT migration_name
FROM schema_migrations
WHERE migration_name = '20260817_installment_reset_ownership';

SELECT COUNT(*) AS missing_ownership_columns
FROM (
  SELECT 'workspace_code' AS c UNION ALL
  SELECT 'entity_type' UNION ALL
  SELECT 'entity_id' UNION ALL
  SELECT 'ownership_source'
) required
LEFT JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA = DATABASE()
 AND c.TABLE_NAME = 'installment_reset_ownership'
 AND c.COLUMN_NAME = required.c
WHERE c.COLUMN_NAME IS NULL;

SELECT COUNT(*) AS missing_ownership_indexes
FROM (
  SELECT 'uq_installment_reset_ownership_entity' AS i UNION ALL
  SELECT 'idx_installment_reset_ownership_lookup' UNION ALL
  SELECT 'idx_installment_reset_ownership_workspace'
) required
LEFT JOIN information_schema.STATISTICS s
  ON s.TABLE_SCHEMA = DATABASE()
 AND s.TABLE_NAME = 'installment_reset_ownership'
 AND s.INDEX_NAME = required.i
WHERE s.INDEX_NAME IS NULL;
