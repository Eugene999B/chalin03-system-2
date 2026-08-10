-- Read-only verifier for 20260810_chalin_one_public_analytics.

SELECT COUNT(*) AS analytics_table_present
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'public_analytics_daily';

SELECT COUNT(*) AS migration_record_present
FROM schema_migrations
WHERE migration_name = '20260810_chalin_one_public_analytics';

SELECT COUNT(*) AS invalid_analytics_rows
FROM public_analytics_daily
WHERE route_path NOT LIKE '/%'
   OR CHAR_LENGTH(route_path) > 220;
