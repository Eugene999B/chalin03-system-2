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

The release preserves every current Equipment Hire, Finance, Mining and Spare Parts record. It adds:

- extra exact-machine identity and commercial fields on `fleet_assets`
- issued-agreement identity fields on `equipment_sale_agreements`
- company-wide Finance settings and immutable settings history
- controlled document signatures
- immutable issued document snapshots and SHA-256 checksums
- boss payment-alert evidence

No business table is truncated, reset or bulk-deleted.

## Required prerequisites

Do not begin until all of the following are true:

1. The four approved Equipment Finance foundation migrations from 29 July 2026 are recorded in `schema_migrations`:
   - `20260729_equipment_credit_application_foundation`
   - `20260729_equipment_finance_agreement_activation`
   - `20260729_equipment_finance_deposit_reservation`
   - `20260729_equipment_finance_final_lifecycle`
2. The current live service is healthy.
3. No Finance staff are entering applications, deposits, collections, delivery or ownership records during the short migration window.
4. Two verified backups exist:
   - a signed Chalin 03 Professional Backup downloaded from the system
   - a separate SQL backup from Railway/MySQL
5. Both backups have been checked for non-zero file size, readable metadata and the expected production database identity.
6. The exact production database name is known.

## Temporary migration environment controls

Set these only for the controlled migration operation:

```text
NODE_ENV=production
CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED=true
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_SQL_BACKUP_CONFIRMED=true
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

TLS remains governed by the existing production database settings. Do not weaken an external database TLS configuration for this migration.

## Run the migration

From the `backend` directory of the exact reviewed release commit:

```bash
npm ci
npm run migrate:equipment-finance:professional:production
```

The runner will:

1. refuse any non-production environment
2. require the exact release confirmation
3. require both backup confirmations
4. compare the connected database with `CHALIN03_EXPECTED_DATABASE`
5. verify the four Finance prerequisite migration records
6. acquire one MySQL advisory lock
7. apply only the approved professional Finance migration
8. run only the approved read-only verifier
9. reject the operation unless every verifier count is zero
10. release the advisory lock

## Required successful output

The runner must report that it connected to the approved database and that the Professional Equipment Installment Finance migration verified successfully.

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

Any non-zero result means the release is not accepted. Do not promote the application while a verifier problem remains.

## Remove temporary controls

After successful verification, remove or reset the temporary migration controls:

```text
CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED
CHALIN03_SIGNED_BACKUP_CONFIRMED
CHALIN03_SQL_BACKUP_CONFIRMED
CHALIN03_MIGRATION_RELEASE
CHALIN03_EXPECTED_DATABASE
```

They are not ordinary runtime settings and should not remain enabled.

## Application promotion order

1. Complete and verify the database migration.
2. Promote the exact verified application release from `main` to `production`.
3. Wait for Railway backend deployment to report healthy.
4. Wait for the frontend deployment to report healthy.
5. Hard-refresh one test browser or allow the new service-worker cache to activate.
6. Perform the smoke tests below before ordinary staff use.

## Production smoke tests

### Readiness and the former 500 error

1. Open **Installment Finance → Ownership Transfer**.
2. Confirm the account queue loads without a raw 500 response.
3. Confirm the page is company-wide and does not demand a Hire-location selector.
4. Confirm a missing migration would show a controlled readiness warning rather than technical SQL details.

### Exact excavator register

1. Open **Excavator Register**.
2. Register a test excavator with code, make, model, serial/chassis, selling price and a full main photo.
3. Add front, rear, cabin and serial-plate pictures.
4. Confirm each picture shows the whole image using contain-fit rather than cropping.
5. Confirm the machine reports Finance-ready only when required evidence is present.
6. Confirm a duplicate code, serial, chassis, engine or registration number is rejected safely.

### Application and agreement

1. Select the exact registered excavator in a credit application.
2. Capture buyer identity, Ghana Card or accepted ID, address, income, commitments and guarantor evidence.
3. Complete independent review and approve the application.
4. Activate the agreement and confirm the schedule dates and amounts are exact.
5. Confirm no payment, Hire job or machine reservation is created during approval or activation.

### Documents

1. In **Finance Settings**, review the seeded terms with the company’s Ghana lawyer.
2. Enter reviewer name and date, then mark the version approved only after legal review.
3. Capture seller, buyer, witness and guarantor signatures as required.
4. Issue both PDF and Word agreement documents.
5. Confirm the document includes:
   - Chalin 03 company identity
   - buyer and guarantor details
   - exact excavator identity
   - purchase price, deposit and financed balance
   - full installment schedule
   - versioned terms and conditions
   - full uncropped excavator and identity-plate photos
   - signatures
   - immutable document number and checksum evidence
6. Re-download the issued document and confirm it remains linked to the same snapshot.

### Deposit and machine reservation

1. Record a partial opening deposit and confirm the machine is not reserved yet.
2. Complete the required deposit and confirm reservation occurs atomically.
3. Confirm an active Hire assignment blocks Finance reservation or handover.

### Collections and boss alert

Use a test agreement with multiple future schedule lines.

1. Record less than the current period amount; confirm the schedule line becomes partial.
2. Record the rest after the due date; confirm the oldest due line is completed first.
3. Record more than the current period amount but less than the account balance; confirm the excess advances future schedule lines.
4. Attempt more than the final account balance; confirm it is rejected before saving.
5. Repeat the same request key; confirm the original receipt is returned without a duplicate payment.
6. Confirm the boss SMS alert starts only after the payment commits.
7. Temporarily use an invalid or disabled boss alert configuration and confirm the payment remains saved while alert status is reported separately.
8. Confirm the payment receipt, allocations, outstanding balance and staff identity remain exact.

### Reminders

1. Keep automatic reminders disabled initially.
2. Preview due-soon, due-today and overdue candidates.
3. Configure Ghana reminder time, due-soon days, repeat interval and SMS frequency limits.
4. Enable automatic reminders only after the boss approves the wording and phone configuration.
5. Run the manual confirmation action once.
6. Confirm duplicate protection and 7-day/30-day/minimum-hour limits.

### Delivery and ownership

1. Confirm delivery remains blocked before the configured payment threshold.
2. Record machine condition, meter, fuel, tools, receiving person and evidence after eligibility.
3. Confirm delivery does not create Hire work.
4. Confirm ownership remains blocked while any balance remains.
5. After full settlement and delivery, complete ownership transfer with date and authority/registration reference.
6. Confirm the exact excavator becomes sold and cannot return to Hire availability.

### Staff access

1. Assign a Hire-only employee and confirm Finance remains unavailable.
2. Assign a Finance-only employee and confirm Hire Operations remains unavailable.
3. Assign Equipment Business Manager or Accountant and confirm one login can open both divisions.
4. Confirm the dual auditor can inspect both but cannot write.
5. Confirm changing an assignment revokes existing sessions and records an audit event.

## Failure handling

This is a forward-only additive release. Do not delete Finance rows or restore an old schema over new business records.

When a migration statement or verifier fails:

1. stop application promotion
2. retain both backups
3. preserve the complete migration log
4. identify the exact failed statement or non-zero verifier result
5. correct forward with another reviewed additive migration when necessary
6. rerun the verifier
7. promote only after every result is zero

When the application deploy fails after a successful database migration, keep the prior healthy application deployment active and correct the application forward. The new database objects are additive and do not require destructive rollback.
