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

## Release 3D — Notifications and Group Operations Alerts

Apply only after Release 3C is live and a fresh full-system website backup has
been downloaded and validated:

1. `20260718_release3d_notifications_group_alerts.sql`
2. `20260718_release3d_notifications_group_alerts_verify.sql` (read-only verification)

Release 3D adds notification rules, active/resolved alert history, per-user
read/archive state, synchronization evidence and controlled escalation logs.
No automatic SMS is sent. SMS escalation remains disabled unless
`NOTIFICATION_SMS_ENABLED=true` is deliberately set for an approved window,
and every eligible escalation requires an explicit confirmation phrase.
