# Equipment Finance Deposit and Reservation Production Runbook

## Release boundary

This runbook activates the controlled opening-deposit and equipment-reservation stage for Equipment Installment Finance.

It does **not** create or modify Equipment Hire enquiries, Hire quotations, Hire contracts, dispatches, job cards, Hire invoices, Hire payments, Hire returns or worker assignments. It also does not create delivery evidence, ownership transfer evidence or SMS messages.

A partial opening deposit records a Finance receipt only. The machine remains unreserved. The machine is reserved only when the full required deposit has been covered and the Finance officer explicitly confirms reservation.

## Required authority

Execution requires an authorised production database operator. Application use requires Finance Manager, Finance Accountant or the protected original System Administrator.

Do not place database passwords, Railway connection strings or private keys in GitHub, terminal history, screenshots, email or chat.

## Mandatory backups

Before production SQL execution, record and verify both:

1. A fresh Chalin 03 Professional Backup downloaded from the live system.
2. A separate full Railway MySQL SQL backup with a non-zero file size and an integrity check.

Record privately:

- backup filenames
- backup timestamps in Ghana time
- backup file sizes
- integrity-check result
- operator name

Stop if either backup is missing or unverified.

## Required migration order

Never execute `database/schema.sql` against production.

The following migrations are sequential. Check `schema_migrations` before running each one.

1. `20260729_equipment_credit_application_foundation`
2. `20260729_equipment_finance_agreement_activation`
3. `20260729_equipment_finance_deposit_reservation`

If either prerequisite is absent, run its exact timestamped migration and matching verifier before continuing.

## Preflight checks

Run read-only checks first:

```sql
SELECT DATABASE() AS selected_database;

SELECT migration_name, applied_at
FROM schema_migrations
WHERE migration_name IN (
  '20260729_equipment_credit_application_foundation',
  '20260729_equipment_finance_agreement_activation',
  '20260729_equipment_finance_deposit_reservation'
)
ORDER BY migration_name;

SELECT COUNT(*) AS missing_parent_tables
FROM (
  SELECT 'equipment_credit_applications' AS table_name
  UNION ALL SELECT 'equipment_sale_agreements'
  UNION ALL SELECT 'equipment_sale_payments'
  UNION ALL SELECT 'equipment_asset_sale_locks'
  UNION ALL SELECT 'fleet_assets'
  UNION ALL SELECT 'hire_contract_assets'
) required
LEFT JOIN information_schema.TABLES actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = required.table_name
WHERE actual.TABLE_NAME IS NULL;
```

Required result:

- the selected database is the intended Railway production database
- both prerequisite migration records exist
- `missing_parent_tables = 0`
- the deposit-reservation migration is not already recorded unless this is a verification-only run

## Execute the exact migration

Use an SSL-protected MySQL connection and a password prompt or secure client profile. Do not put credentials directly into the command.

Execute only:

`database/migrations/20260729_equipment_finance_deposit_reservation.sql`

Do not interrupt the migration after execution starts.

## Immediate read-only verification

Immediately execute:

`database/migrations/20260729_equipment_finance_deposit_reservation_verify.sql`

Every result below must be `0`:

- `missing_deposit_reservation_columns`
- `missing_deposit_reservation_indexes`
- `missing_deposit_reservation_foreign_keys`
- `missing_deposit_reservation_triggers`
- `bypassed_controlled_finance_payments`
- `invalid_opening_deposit_payments`
- `invalid_controlled_deposit_balances`
- `invalid_reserved_finance_agreements`
- `invalid_controlled_finance_sale_locks`
- `reserved_finance_assets_active_on_hire`
- `forbidden_deposit_hire_link_columns`
- `deposit_reservation_migration_record_missing`

Stop and investigate if any count is not zero. Do not delete records, drop columns, disable foreign keys or remove triggers to force a passing result. Correct forward with a separately reviewed timestamped migration.

## Application readiness check

After the backend deployment is confirmed, sign in to Equipment Installment Finance and choose one specific Finance location.

Open **Deposit & Machine Reservation**. The readiness request must return success from:

`GET /api/equipment-catalogue/sales/deposit-reservations/readiness`

The screen must no longer show the controlled migration warning.

## Controlled smoke test

Use a dedicated test agreement created from an approved credit application.

### Partial deposit

1. Record an amount lower than the required deposit.
2. Confirm a Finance payment and receipt are created.
3. Confirm `deposit_received`, `amount_paid` and `outstanding_balance` are updated.
4. Confirm the machine remains `available`.
5. Confirm no active `equipment_asset_sale_locks` row exists.
6. Confirm agreement status remains `approved` and commitment remains `not_reserved`.

### Deposit completion and reservation

1. Record the exact remaining required deposit.
2. Explicitly confirm machine reservation.
3. Confirm one active sale lock exists with `lock_status = 'installment_active'`.
4. Confirm the fleet machine has `sale_status = 'installment_active'`.
5. Confirm agreement status is `active` and commitment is `reserved`.
6. Confirm the same idempotency key cannot create another payment.

### Separation checks

Confirm the smoke test did not:

- create or update a Hire enquiry
- create or update a Hire quotation
- create a Hire contract or Hire job
- create a dispatch, job card, Hire invoice, Hire payment or Hire return
- assign a Hire worker
- create delivery evidence
- create ownership-transfer evidence
- allocate the opening deposit to installment schedule rows
- send SMS

## Failure handling

The release is forward-only. If verification or smoke testing fails:

1. Stop Finance deposit and reservation activity.
2. Preserve the two verified backups and all SQL outputs.
3. Capture the exact error and affected agreement, payment and asset IDs.
4. Keep the application in fail-closed mode.
5. Prepare a new reviewed timestamped correction migration.

Do not run `database/schema.sql`, destructive rollback SQL or manual record deletion against production.
