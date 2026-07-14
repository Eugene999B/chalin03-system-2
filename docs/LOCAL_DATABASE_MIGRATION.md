# Local Database Migration

Run migrations only against a local database after taking a private backup.

Order:

1. `database/stage6a_group_users_staff_migration.sql`
2. `database/spare_parts_sales_hotfix_migration.sql`
3. `database/stage6b_permissions_audit_migration.sql`
4. `database/stage6c_reliability_migration.sql`
5. `database/stage6d_security_migration.sql`

Then run the matching verification SQL files and `database/schema_verify.sql`.

