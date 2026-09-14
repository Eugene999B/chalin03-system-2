# Chalin 03 Professional Equipment Installment Finance — Production Runbook

## Release identity

This runbook applies only to:

- release confirmation: `20260731_EQUIPMENT_FINANCE_PROFESSIONAL`
- migration: `database/migrations/20260731_equipment_finance_professional_rebuild.sql`
- verifier: `database/migrations/20260731_equipment_finance_professional_rebuild_verify.sql`
- runner: `backend/scripts/runEquipmentFinanceProfessionalRebuildMigration.js`
- command: `npm run migrate:equipment-finance:professional:production`

Never run `database/schema.sql` against production. Never replace the live database with a development schema. This release is additive and forward-only.

## What the migration adds

The release preserves current Equipment Hire, Finance, Mining and Spare Parts records. It adds:

- exact machine identity and commercial fields on `fleet_assets`
- issued-agreement identity fields on `equipment_sale_agreements`
- company-wide Finance settings and immutable settings history
- controlled document signatures
- immutable issued document snapshots and SHA-256 checksums
- boss payment-alert evidence

No business table is truncated, reset or bulk-deleted.

## Backup policy for the Railway Hobby deployment

A fresh signed Chalin 03 Professional Backup downloaded from the application is mandatory.

For this deployment, the migration runner automatically creates a protected database-side safety snapshot before applying any professional Finance statement. This replaces the unavailable separate Railway database-download gate for the current plan.

The automatic snapshot contains complete copies of the three existing tables touched or relied on by this release:

- `fleet_assets`
- `equipment_sale_agreements`
- `schema_migrations`

The copies are stored as:

- `chalin03_snap_20260731_fin_fleet_assets`
- `chalin03_snap_20260731_fin_sale_agreements`
- `chalin03_snap_20260731_fin_schema_migrations`

Snapshot evidence is recorded in `chalin03_migration_safety_snapshots`. The runner refuses to continue unless every snapshot exists and its copied row count matches the recorded count. A completed snapshot is reused and reverified; it is never overwritten during later startup attempts.

This database-side snapshot supplements the signed application backup. It does not replace normal long-term backup practice.

## Required prerequisites

Do not begin until all of the following are true:

1. The four approved Equipment Finance foundation migrations from 29 July 2026 are recorded in `schema_migrations`:
   - `20260729_equipment_credit_application_foundation`
   - `20260729_equipment_finance_agreement_activation`
   - `20260729_equipment_finance_deposit_reservation`
   - `20260729_equipment_finance_final_lifecycle`
2. The current live service is healthy.
3. No Finance staff are entering applications, deposits, collections, delivery or ownership records during the short migration window.
4. A fresh signed Chalin 03 Professional Backup has been downloaded and safely retained.
5. The exact production database name is known through the Railway MySQL variable reference.

## Temporary migration environment controls

Set these only for the controlled migration operation:

```text
NODE_ENV=production
CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED=true
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_MIGRATION_RELEASE=20260731_EQUIPMENT_FINANCE_PROFESSIONAL
CHALIN03_EXPECTED_DATABASE=<exact Railway production database name>
```

The normal production database variables must already be present:

```text
DB_HOST or MYSQLHOST
DB_PORT or MYSQLPORT
DB_USER or MYSQLUSER
DB_PASSWORD or MYSQLPASSWORD
DB_NAME or MYSQLDATABASE
```

TLS remains governed by the existing production database settings.

`CHALIN03_SQL_BACKUP_CONFIRMED` is not required for this release because the runner creates and verifies the database-side safety snapshot automatically.

## GitHub-controlled Railway execution

The reviewed production release temporarily starts the backend with:

```text
node scripts/runEquipmentFinanceProfessionalRebuildMigration.js && node -r ./services/exportWorkbookSafetyBootstrap.js server.js
```

Railway therefore performs the migration before the API starts. Any failed gate exits non-zero and prevents the new backend from becoming healthy.

The runner will:

1. refuse any non-production environment
2. require the exact release confirmation
3. require the signed Chalin 03 backup confirmation
4. compare the connected database with `CHALIN03_EXPECTED_DATABASE`
5. verify the four Finance prerequisite migration records
6. acquire one MySQL advisory lock
7. create or verify the database-side safety snapshot
8. apply only the approved professional Finance migration
9. run only the approved read-only verifier
10. reject the operation unless every verifier count is zero
11. release the advisory lock
12. start the normal backend only after successful verification

## Required successful output

Railway logs must report:

```text
Database-side Professional Finance safety snapshot created and verified.
Professional Equipment Installment Finance migration verified successfully.
```

When the migration is already recorded, a later startup may instead report that the migration record already exists before re-running the idempotent verifier.

All ten verifier results must be exactly `0`:

```text
missing_professional_finance_tables = 0
missing_professional_finance_columns = 0
missing_professional_finance_indexes = 0
missing_professional_finance_foreign_keys = 0
invalid_professional_finance_settings = 0
duplicate_professional_finance_settings = 0
invalid_professional_finance_documents = 0
invalid_professional_finance_signatures = 0
invalid_professional_finance_payment_alerts = 0
professional_finance_migration_record_missing = 0
```

Any non-zero result means the release is not accepted.

## Remove temporary controls and startup gate

After successful production verification:

1. merge an immediate cleanup release restoring the normal backend start command
2. remove or reset:

```text
CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED
CHALIN03_SIGNED_BACKUP_CONFIRMED
CHALIN03_MIGRATION_RELEASE
CHALIN03_EXPECTED_DATABASE
```

The protected snapshot tables and manifest remain in the database as release evidence until a separate reviewed retention decision is made.

## Production smoke tests

### Readiness and former 500 error

1. Open **Installment Finance → Ownership Transfer**.
2. Confirm the account queue loads without a raw 500 response.
3. Confirm the page is company-wide and does not demand a Hire-location selector.
4. Confirm readiness problems show a controlled message rather than SQL details.

### Exact excavator register

1. Open **Excavator Register**.
2. Register a test excavator with code, make, model, serial/chassis, selling price and a full main photo.
3. Add front, rear, cabin and serial-plate pictures.
4. Confirm every picture shows the whole image using contain-fit rather than cropping.
5. Confirm duplicate code, serial, chassis, engine or registration numbers are rejected safely.

### Application and agreement

1. Select the exact registered excavator in a credit application.
2. Capture buyer identity, Ghana Card or accepted ID, address, income, commitments and guarantor evidence.
3. Complete independent review and approve the application.
4. Activate the agreement and confirm the schedule dates and amounts are exact.

### Documents

1. In **Finance Settings**, review the seeded terms with the company’s Ghana lawyer.
2. Mark the terms approved only after legal review.
3. Capture seller, buyer, witness and guarantor signatures as required.
4. Issue PDF and Word-compatible agreement documents.
5. Confirm the pack contains company identity, buyer and guarantor details, exact excavator identity, commercial terms, schedule, terms, full photos, signatures, document number and checksum.

### Collections and boss alert

1. Record a payment below the current period amount and confirm a partial allocation.
2. Complete the amount after the due date and confirm oldest-due-first allocation.
3. Record more than the current period amount and confirm the excess advances future schedule lines.
4. Attempt more than the final account balance and confirm rejection before saving.
5. Repeat the same request key and confirm no duplicate payment.
6. Confirm the boss SMS starts only after the payment commits.
7. Confirm an alert failure never rolls back the saved receipt.

### Reminders

1. Keep automatic reminders disabled initially.
2. Preview due-soon, due-today and overdue candidates.
3. Configure Ghana reminder time, repeat interval and SMS limits.
4. Enable reminders only after the boss approves wording and phone configuration.

### Delivery and ownership

1. Confirm delivery is blocked before the configured payment threshold.
2. Record machine condition, meter, fuel, tools, receiving person and evidence after eligibility.
3. Confirm ownership remains blocked while any balance remains.
4. After full settlement and delivery, complete ownership transfer.
5. Confirm the excavator becomes sold and cannot return to Hire availability.

### Staff access

1. Confirm Hire-only staff cannot open Finance.
2. Confirm Finance-only staff cannot open Hire Operations.
3. Confirm approved Equipment Business Manager or Accountant roles can open both divisions with one login.
4. Confirm the dual auditor is read-only.
5. Confirm assignment changes revoke active sessions and write an audit event.

## Failure handling

This is a forward-only additive release. Do not delete Finance rows or restore an old schema over new business records.

When a snapshot, migration statement or verifier fails:

1. stop application promotion
2. retain the signed application backup
3. preserve the complete Railway migration log
4. retain the database-side snapshot tables and manifest
5. identify the exact failed statement or non-zero verifier result
6. correct forward with another reviewed additive migration when necessary
7. rerun the verifier
8. promote only after every result is zero

When the application deployment fails after a successful database migration, keep the prior healthy application deployment active and correct the application forward. The new database objects are additive and do not require destructive rollback.
