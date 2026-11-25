-- READ-ONLY VERIFICATION.
SELECT migration_name,applied_at FROM schema_migrations WHERE migration_name='20261125_management_planning_settings';
SELECT id,assumed_partner_percent,version FROM management_planning_settings WHERE id=1;
SELECT COUNT(*) AS invalid_settings FROM management_planning_settings WHERE id<>1 OR assumed_partner_percent>100;
