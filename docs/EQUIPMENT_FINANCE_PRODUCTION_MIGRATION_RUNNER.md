# Equipment Finance Production Migration Runner

## Purpose

This runner applies and verifies the complete approved-credit Equipment Installment Finance database plan as one fail-closed operation.

It exists so an authorised Railway operator does not need to copy and paste the Finance SQL migrations manually.

The runner is **not automatic**. Adding this file or deploying the application does not execute any database migration.

## Exact command

Run from the backend service working directory in the approved Railway production environment:

```text
npm run migrate:equipment-finance:production
```

Do not replace this command with `npm run migrate:production`. The older command is locked to a separate legacy migration release.

## Exact migration order

The runner applies each migration and immediately executes its matching read-only verifier before continuing:

1. `20260729_equipment_credit_application_foundation.sql`
2. `20260729_equipment_credit_application_foundation_verify.sql`
3. `20260729_equipment_finance_agreement_activation.sql`
4. `20260729_equipment_finance_agreement_activation_verify.sql`
5. `20260729_equipment_finance_deposit_reservation.sql`
6. `20260729_equipment_finance_deposit_reservation_verify.sql`
7. `20260805_equipment_finance_opening_deposit_foundation_repair.sql`
8. `20260805_equipment_finance_opening_deposit_foundation_repair_verify.sql`
9. `20260803_equipment_finance_phase4_deposit_reservation_integrity.sql`
10. `20260803_equipment_finance_phase4_deposit_reservation_integrity_verify.sql`
11. `20260729_equipment_finance_final_lifecycle.sql`
12. `20260729_equipment_finance_final_lifecycle_verify.sql`
13. `20260825_equipment_finance_policy_hardening.sql`
14. `20260825_equipment_finance_policy_hardening_verify.sql`

The operation stops immediately when a migration fails, a verifier result is missing, a verifier value is not numeric, or any problem count is not exactly zero.

## Required release gates

The following values must be configured privately in the approved Railway environment for the migration operation:

```text
NODE_ENV=production
CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED=true
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_SQL_BACKUP_CONFIRMED=true
CHALIN03_MIGRATION_RELEASE=20260825_EQUIPMENT_FINANCE_POLICY_HARDENING
CHALIN03_EXPECTED_DATABASE=<exact Railway production database name>
```

The runner uses the existing Railway `DB_*` or `MYSQL*` connection variables. Do not copy database passwords, connection URLs or certificates into chat, GitHub issues, pull requests or screenshots.

Set the two backup confirmations to `true` only after verifying:

1. a current Professional Backup; and
2. a separate current SQL/database backup.

## Database protections

Before changing schema, the runner:

- verifies `NODE_ENV=production`;
- requires the Finance-specific enable flag;
- requires both backup confirmations;
- requires the exact release confirmation value;
- requires the exact expected database name;
- connects through the existing Railway database variables;
- confirms the selected database matches `CHALIN03_EXPECTED_DATABASE`; and
- acquires the MySQL advisory lock `chalin03:production-migrations:20260825-equipment-finance-policy-hardening`.

The runner executes only the reviewed files listed in its immutable migration plan. It does not scan the migrations folder. **Never run `database/schema.sql` against production.**

## Successful completion

A successful run ends with:

```text
All approved Equipment Finance migrations and verifiers passed.
```

Before accepting the release, retain the complete Railway migration log and confirm each migration printed both an `Applying ...` and `Verified ...` message, including the 20260825 policy-hardening stage.

After success:

1. set `CHALIN03_EQUIPMENT_FINANCE_MIGRATIONS_ENABLED=false` or remove it;
2. remove or retire `CHALIN03_SIGNED_BACKUP_CONFIRMED`;
3. remove or retire `CHALIN03_SQL_BACKUP_CONFIRMED`;
4. remove or retire `CHALIN03_MIGRATION_RELEASE`;
5. remove or retain `CHALIN03_EXPECTED_DATABASE` according to the approved Railway configuration policy;
6. remove the Finance migration command from any temporary Railway pre-deploy configuration; and
7. preserve the successful logs with the production commit and backup recovery point.

The application should then be restarted or redeployed normally so the readiness endpoints can confirm the installed columns and triggers.

## Failure behaviour

The process exits non-zero on any failure. Railway must not start a backend release whose approved pre-deploy migration command failed.

When the run fails:

- do not rerun `database/schema.sql`;
- do not drop columns, constraints or triggers;
- do not delete Finance, Hire or fleet records;
- preserve the complete failure log;
- leave the application on its fail-closed readiness screens; and
- prepare a reviewed additive forward correction.

The MySQL advisory lock is released when the runner exits. The migrations are written to be additive and rerunnable, but a failed operation must still be investigated before another attempt.

## Runtime state before execution

Until this runner completes successfully, the controlled Finance screens remain unavailable for database mutations:

- Credit Applications & Approval
- Agreement Activation
- Deposit & Machine Reservation
- Installment Collections
- Delivery Handover
- Ownership Transfer

The deployed application checks its required tables, columns and triggers. Missing foundations return controlled readiness responses instead of creating partial financial records.

## Equipment Hire separation

The migration plan does not merge Equipment Hire and Installment Finance. It preserves the hard division boundary:

- Hire enquiries, quotations, contracts, jobs, dispatches, job cards, invoices, payments, returns and workers remain Hire-only;
- approved-credit applications, agreements, collections, delivery handover and ownership transfer remain Finance-only; and
- the shared machine identity is used only for availability and sale-state enforcement.

Automatic installment SMS remains disabled unless it is enabled through a separate reviewed release.
