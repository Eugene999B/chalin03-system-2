# Chalin 03 Additive Database Migrations

This folder contains controlled, additive migrations for the live Chalin 03
platform.

## Production safety

- Never run `database/schema.sql` against the production Railway database.
- Create and verify a Professional Backup before every production migration.
- Apply only migrations that are missing from `schema_migrations`.
- Run the matching `*_verify.sql` file immediately after the migration.
- Do not run automatic destructive rollback SQL. Correct forward with another
  reviewed additive migration when necessary.

## Release 3 order

1. `20260716_release3_group_command_configuration.sql`
2. `20260716_release3_owner_mfa_security.sql`
3. `20260717_release3b_mining_operations_control.sql`
4. `20260717_release3b_mining_operations_control_verify.sql` — read-only check

Release 3B requires the Group Configuration migration because Mining document
numbers use the database-backed `document_sequences` table.

## Release 3C — Equipment Hire Commercial Completion

Apply in production only after a full application backup and a second SQL backup:

1. `20260717_release3c_hire_commercial_completion.sql`
2. `20260717_release3c_hire_commercial_completion_verify.sql` (read-only verification)

This migration is additive. It normalizes legacy single-line quotations/contracts into one initial line, adds controlled dispatch/return numbering, and never runs `database/schema.sql` against production.
