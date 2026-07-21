# Enforced Production Migration Safety

This policy is checked automatically by `.github/workflows/migration-safety.yml` and `backend/scripts/verifyMigrationSafety.js`.

## Non-negotiable production rules

1. Never execute `database/schema.sql` against Railway production.
2. Create and verify both a Professional Backup and a separate SQL backup before applying a production migration.
3. Apply only a new, timestamped, forward migration from `database/migrations`.
4. Never modify, rename or delete a migration that has already been committed.
5. Every migration must record itself in `schema_migrations`.
6. Every migration must include a matching read-only `*_verify.sql` file.
7. Correct problems forward with another reviewed migration. Do not use an automatic destructive rollback.

## Required filename format

```text
YYYYMMDD_lowercase_description.sql
YYYYMMDD_lowercase_description_verify.sql
```

Example:

```text
20260721_add_supplier_reference.sql
20260721_add_supplier_reference_verify.sql
```

## Required migration header

```sql
-- CHALIN 03 PRODUCTION MIGRATION
-- ADDITIVE MIGRATION ONLY.
-- BACKUP REQUIRED: Professional Backup and SQL backup verified.
-- Do not run database/schema.sql against production.
```

## Required migration record

Every migration must finish by recording an idempotent migration name:

```sql
INSERT INTO schema_migrations (
    migration_name,
    description
)
VALUES (
    'add_supplier_reference',
    'Adds an optional supplier reference without deleting existing records.'
)
ON DUPLICATE KEY UPDATE
    description = VALUES(description);
```

## Statements blocked automatically

The production migration gate rejects:

- `DROP DATABASE`, `DROP SCHEMA` and non-temporary `DROP TABLE`
- `TRUNCATE`
- `DELETE FROM`
- `REPLACE INTO`
- `ALTER TABLE ... DROP COLUMN`
- dropping keys, constraints or indexes
- `RENAME TABLE`
- `CREATE OR REPLACE TABLE`
- disabling foreign-key checks
- hard-coded `USE railway`, `USE production` or `USE prod`

Dropping and recreating an idempotent helper **procedure** remains allowed. Dropping business tables or columns does not.

## Verification files are read-only

A `*_verify.sql` file may use read queries such as:

- `SELECT`
- `SHOW`
- `DESCRIBE`
- `EXPLAIN`
- read-only `WITH` queries

It may not create, alter, drop or mutate database state.

## Exceptional changes

A genuinely necessary destructive change must not bypass this gate. It requires a separately designed migration process, documented business approval, validated backups, restoration testing and a new reviewed safety rule before any production execution.
