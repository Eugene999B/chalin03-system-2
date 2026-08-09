-- Read-only verifier for 20260809_chalin_one_public_redirects.

SELECT COUNT(*) AS redirect_table_present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'public_redirect_rules';

SELECT COUNT(*) AS migration_record_present
FROM schema_migrations
WHERE migration_name = '20260809_chalin_one_public_redirects';

SELECT COUNT(*) AS invalid_status_rows
FROM public_redirect_rules
WHERE redirect_status NOT IN (301,302,307,308)
   OR rule_status NOT IN ('draft','active','inactive','archived');
