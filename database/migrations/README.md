# Chalin 03 Additive Database Migrations

This folder contains controlled, additive migrations for the live Chalin 03
platform.

## Production safety

- Never run `database/schema.sql` against the production Railway database.
- Create and verify a Professional Backup before every production migration.
- Create and verify a separate SQL backup before every production migration.
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

## Release 3E — Shared Reports, Documents, Roles and Audit Completion

Production migration order for Release 3E:

1. `20260718_release3e_shared_reports_documents_roles_audit.sql`
2. `20260718_release3e_shared_reports_documents_roles_audit_verify.sql`

Release 3E is additive and introduces only `shared_control_evidence`. It never runs `database/schema.sql`, never resets production data and never changes SMS configuration.

## Release 3F-A — Authentication, Sessions and System Operations UX

Production migration order for Release 3F-A:

1. `20260718_release3fa_authentication_sessions_ux.sql`
2. `20260718_release3fa_authentication_sessions_ux_verify.sql`

Release 3F-A is additive. It adds a unique normalized Ghana phone login identity,
professional browser/device/location evidence to `auth_sessions`, and phone
normalization triggers. Existing usernames remain valid. Duplicate existing
phone numbers are not deleted; phone login remains disabled for duplicates until
an administrator assigns unique numbers. The migration never runs
`database/schema.sql` and never sends SMS.

## Release 3F-B — Professional Installment Sales

Production-safe migration order:

1. `20260718_release3fb_professional_installment_sales.sql`
2. `20260718_release3fb_professional_installment_sales_verify.sql`

This migration is additive and idempotent. It extends the existing `sales.payment_type`
enum with `installment` and adds branch-isolated agreement, schedule, collection,
rescheduling, delivery, reminder and settings tables. It does not delete existing
sales, debts, products, stock, customers or accounting evidence.

Every verification row must return `PASS` with `problem_count = 0`.
Never run `database/schema.sql` against Railway production for this release.

## Release 3F-C — User Permission Manager and Security Centre Messages

Production migration:

`20260718_release3fc_user_permissions_security_messages.sql`

Read-only verification:

`20260718_release3fc_user_permissions_security_messages_verify.sql`

This additive migration creates auditable per-user allow/deny permission overrides and Security Centre message dismissal records. Dismissing a Security Centre message never deletes its underlying `activity_log` or privileged-ledger evidence. Never run `database/schema.sql` against production.

## Release 3F-C2 — Independent Categories, Guides, Receipts and Workers

Production migration order:

1. `20260718_release3fc2_category_isolation_guides_receipts_workers.sql`
2. `20260718_release3fc2_category_isolation_guides_receipts_workers_verify.sql`

This additive migration assigns every non-owner account and worker profile to one
independent category: Spare Parts, Mining Operations or Equipment Hire. The
original System Administrator remains the only protected cross-category account.
Existing accounts or worker profiles with more than one detected category are
not guessed, deleted or silently changed: their records are preserved, login or
profile access is blocked, and they appear in Safe Conflict Review for an
explicit protected decision. Never run `database/schema.sql` against Railway.

## Release 3F-C3 — Mobile UX, Worker ID Card and Expense Funding Controls

Production migration order:

1. `20260718_release3fc3_mobile_id_expense_funding.sql`
2. `20260718_release3fc3_mobile_id_expense_funding_verify.sql`

This additive migration records whether an expense used money collected during
that business day. Existing expenses remain marked as affecting Daily Closing so
previously approved historical closings do not silently change. New expense
records require an explicit funding-source decision in the application. Expenses
funded by petty cash, earlier business funds, owner/manager funds, a separate bank
or MoMo balance, credit or another external source remain in accounting reports
but do not reduce that day's expected settlement. Never run `database/schema.sql`
against Railway production.

## Equipment Installment Finance — Complete approved-credit lifecycle

Before applying any Finance migration, verify both a current Professional Backup
and a separate current SQL/database backup.

The complete production order is:

1. `20260729_equipment_credit_application_foundation.sql`
2. `20260729_equipment_credit_application_foundation_verify.sql`
3. `20260729_equipment_finance_agreement_activation.sql`
4. `20260729_equipment_finance_agreement_activation_verify.sql`
5. `20260729_equipment_finance_deposit_reservation.sql`
6. `20260729_equipment_finance_deposit_reservation_verify.sql`
7. `20260729_equipment_finance_final_lifecycle.sql`
8. `20260729_equipment_finance_final_lifecycle_verify.sql`
9. `20260825_equipment_finance_policy_hardening.sql`
10. `20260825_equipment_finance_policy_hardening_verify.sql`

The credit-foundation verifier must explicitly report:

- `missing_credit_tables = 0`;
- `missing_credit_columns = 0`;
- `invalid_credit_application_rows = 0`;
- `orphan_credit_evidence_rows = 0`.

Every subsequent Finance verifier problem count must also be exactly `0`. The
one-command runner rejects missing result sets, non-numeric values and non-zero
problem counts before it can continue to the next stage.

These additive migrations create the controlled Finance progression from credit
application and KYC through agreement activation, deposit and machine
reservation, installment collections, delivery handover and final ownership
transfer. The 20260825 policy-hardening stage additionally snapshots agreement-
level commercial policy, strengthens reconciliation state and separates customer
and boss event notification controls. They preserve existing Equipment Hire
contracts, jobs, dispatches, invoices, payments, returns, workers and historical
legacy Equipment Sales agreements.

The approved one-command runner is:

```text
npm run migrate:equipment-finance:production
```

The runner is not automatic. It requires the exact release token, both backup
confirmations, the expected production database name and a MySQL advisory lock.
It applies each migration and immediately rejects any verifier result that is not
numeric zero.

Follow the complete runner procedure in:

`docs/EQUIPMENT_FINANCE_PRODUCTION_MIGRATION_RUNNER.md`

Individual stage runbooks remain available for investigation and controlled
manual execution:

- `docs/EQUIPMENT_CREDIT_APPLICATION_PRODUCTION_RUNBOOK.md`
- `docs/EQUIPMENT_FINANCE_AGREEMENT_ACTIVATION_RUNBOOK.md`
- `docs/EQUIPMENT_FINANCE_DEPOSIT_RESERVATION_PRODUCTION_RUNBOOK.md`
- `docs/EQUIPMENT_FINANCE_FINAL_LIFECYCLE_PRODUCTION_RUNBOOK.md`

Automatic installment SMS remains disabled unless enabled through a separate
reviewed release. Never run `database/schema.sql` against Railway production.
