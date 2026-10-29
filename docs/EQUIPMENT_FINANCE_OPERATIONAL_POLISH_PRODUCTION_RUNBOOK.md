# Equipment Finance Phase 3 — Operational Polish Production Runbook

Release identity: `20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH`

Migration record: `20260731_equipment_finance_operational_polish`

Migration SQL: `database/migrations/20260731_equipment_finance_operational_polish.sql`

Verifier SQL: `database/migrations/20260731_equipment_finance_operational_polish_verify.sql`

Controlled runner: `backend/scripts/runEquipmentFinanceOperationalPolishMigration.js`

Railway startup gate: `backend/scripts/runEquipmentFinanceOperationalPolishStartup.js`

## Release boundary

This release adds private operational support tables for:

- server-backed installment drafts
- protected case-document uploads
- tasks and approvals
- complete case events
- schedule simulations
- controlled amendments
- document and receipt sharing evidence

It does not alter the structure of existing Finance applications, agreements, schedules, payments, issued documents or boss-alert records.

The runner compares row counts before and after migration for:

- `equipment_credit_applications`
- `equipment_sale_agreements`
- `equipment_sale_payments`
- `equipment_finance_issued_documents`
- `equipment_finance_payment_alerts`

Any row-count change aborts the release.

## Backup protection for the Railway Hobby plan

Railway Hobby does not provide the separate managed SQL backup used by higher plans. The release therefore uses two available protections:

1. A fresh signed **Chalin 03 Professional Backup** downloaded from the live website and retained outside Railway.
2. An automatic database-side safety snapshot created by the controlled migration runner before any Phase 3 SQL is applied.

The runner copies and verifies all five preserved Finance evidence tables into release-specific snapshot tables. It records their exact row counts in `chalin03_phase3_finance_safety_snapshots`. A missing table, wrong database identity, incomplete copy or count mismatch stops the deployment.

The legacy `CHALIN03_SQL_BACKUP_CONFIRMED` variable is not required for this Railway Hobby release. It may remain present, but the runner does not rely on it.

## Mandatory production gate

Before the `main` to `production` release is merged:

1. Confirm that the fresh signed website backup exists, is non-zero and has been retained safely.
2. Confirm the exact Railway production database name.
3. Confirm that all required Railway variables below are present.
4. Merge only the reviewed production pull request from `main` to `production`.
5. Railway must run the startup gate before the API server starts.
6. Confirm the final migration success line exactly:

```text
Equipment Finance Phase 3 operational polish migration verified successfully.
```

7. Confirm the new deployment becomes healthy.
8. Remove or reset the temporary migration controls after success.

## Temporary Railway controls

These values belong on the backend/API service for the controlled migration deployment:

```text
CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED=true
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_MIGRATION_RELEASE=20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH
CHALIN03_EXPECTED_DATABASE=${{MySQL.MYSQLDATABASE}}
NODE_ENV=production
```

Normal Railway MySQL variables may use `DB_*` or `MYSQL*` names.

No local computer, PowerShell command or Railway CLI command is required. GitHub controls the release and Railway executes the gate during deployment.

## Required verifier outputs

Every result below must be exactly zero:

```text
missing_operational_polish_tables=0
missing_operational_polish_columns=0
missing_operational_polish_indexes=0
invalid_operational_polish_drafts=0
invalid_operational_polish_documents=0
invalid_operational_polish_amendments=0
operational_polish_migration_record_missing=0
```

Any non-zero result blocks production promotion.

## Failure handling

This is a forward-only additive migration.

Do not drop new tables and do not restore over live production merely because Railway reports a verifier problem.

Instead:

1. Keep the failed deployment from becoming active.
2. Preserve the exact Railway error output.
3. Verify the connected database identity.
4. Confirm the signed website backup is still retained.
5. Verify the database-side safety snapshot status and row counts.
6. Prepare a forward-only corrective pull request.
7. Redeploy only after review and green GitHub checks.

## Post-migration cleanup

Remove or reset these temporary values after a successful verified run:

```text
CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED
CHALIN03_SIGNED_BACKUP_CONFIRMED
CHALIN03_MIGRATION_RELEASE
```

`CHALIN03_SQL_BACKUP_CONFIRMED` is not part of the Railway Hobby release gate and may be removed.

Keep `CHALIN03_EXPECTED_DATABASE` when it is already part of the production database-safety configuration.

## Production smoke test

After the production branch deploys:

1. Sign out and sign back in as the protected original System Administrator.
2. Confirm all Spare Parts pages, Backup & Restore, Security Centre and System Operations are visible.
3. Open **Equipment Installment Finance → Task & Approval Inbox**.
4. Confirm the inbox and case list load without a raw SQL error.
5. Open **Start New Installment**, enter one harmless draft field and confirm the server-save indicator changes to Saved.
6. Clear the draft and confirm no test application is submitted.
7. Open an existing Finance case and confirm its chronology loads.
8. Run a schedule simulation and confirm no live balance changes.
9. Open an existing payment receipt and confirm allocation, outstanding balance and boss-alert status display.
10. Confirm Hire, Mining and Spare Parts workspaces continue to load normally.
