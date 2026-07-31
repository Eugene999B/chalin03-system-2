# Equipment Finance Phase 3 — Operational Polish Production Runbook

Release identity: `20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH`

Migration record: `20260731_equipment_finance_operational_polish`

Migration SQL: `database/migrations/20260731_equipment_finance_operational_polish.sql`

Verifier SQL: `database/migrations/20260731_equipment_finance_operational_polish_verify.sql`

Runner: `backend/scripts/runEquipmentFinanceOperationalPolishMigration.js`

Command from `backend`:

```powershell
npm run migrate:equipment-finance:operational-polish:production
```

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

The migration runner compares row counts before and after migration for:

- `equipment_credit_applications`
- `equipment_sale_agreements`
- `equipment_sale_payments`
- `equipment_finance_issued_documents`
- `equipment_finance_payment_alerts`

Any row-count change aborts the release.

## Mandatory production gate

Do not merge the `main` to `production` release pull request until every item below is complete.

1. Download a fresh signed **Chalin 03 Professional Backup** from the live system.
2. Create a separate fresh Railway/MySQL SQL backup.
3. Verify that both files exist, are non-zero and can be opened or listed successfully.
4. Confirm the exact Railway production database name.
5. Run the approved migration command against the Railway backend service environment.
6. Confirm the final success line exactly:

```text
Equipment Finance Phase 3 operational polish migration verified successfully.
```

7. Confirm all seven verifier outputs are zero.
8. Remove or reset the temporary migration controls after success.
9. Only then merge the production release pull request.

## Temporary Railway controls

Add these only to the backend/API service for the controlled migration operation:

```text
CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED=true
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_SQL_BACKUP_CONFIRMED=true
CHALIN03_MIGRATION_RELEASE=20260731_EQUIPMENT_FINANCE_OPERATIONAL_POLISH
CHALIN03_EXPECTED_DATABASE=${{MySQL.MYSQLDATABASE}}
```

The runner also requires:

```text
NODE_ENV=production
```

Normal Railway MySQL variables may use `DB_*` or `MYSQL*` names.

`CHALIN03_PRODUCTION_MIGRATIONS_ENABLED=true` does not replace the Phase 3 release controls above.

After changing Railway variables, apply **Deploy Changes** before running the migration command.

## Approved execution from Windows PowerShell

Use the local repository that is connected to Railway CLI:

```powershell
cd C:\Users\DDK\Desktop\chalin03-system

git fetch origin
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
```

Confirm the printed SHA matches the exact verified Phase 3 `main` release commit recorded in the open production pull request.

Then run:

```powershell
cd backend
npm ci
railway run npm run migrate:equipment-finance:operational-polish:production
```

Do not paste secrets into chat or screenshots. The complete non-secret migration output must be retained as release evidence.

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

Do not drop the new tables and do not restore over live production merely because the command reports a verifier problem.

Instead:

1. Keep the production pull request open and unmerged.
2. Preserve the full error output.
3. Verify the connected database identity.
4. Confirm both fresh backups still exist.
5. Prepare a forward-only corrective migration or verifier fix.
6. Re-run the controlled command only after review.

## Post-migration cleanup

Remove or reset these temporary values after a successful verified run:

```text
CHALIN03_EQUIPMENT_FINANCE_OPERATIONAL_POLISH_ENABLED
CHALIN03_SIGNED_BACKUP_CONFIRMED
CHALIN03_SQL_BACKUP_CONFIRMED
CHALIN03_MIGRATION_RELEASE
```

Keep `CHALIN03_EXPECTED_DATABASE` when it is already part of the production database-safety configuration.

## Production smoke test

After the production branch deploys:

1. Sign in as the protected System Administrator or Finance Manager.
2. Open **Equipment Installment Finance → Task & Approval Inbox**.
3. Confirm the inbox and case list load without a raw SQL error.
4. Open **Start New Installment**, enter one harmless draft field and confirm the server-save indicator changes to Saved.
5. Clear the draft and confirm no test application is submitted.
6. Open an existing Finance case and confirm its chronology loads.
7. Upload a small non-sensitive test PDF or image, verify it, download it and confirm it is not exposed by a public URL.
8. Run a schedule simulation and confirm no live balance changes.
9. Create a low-risk test correction, approve it and confirm the original snapshot remains visible.
10. Open an existing payment receipt and confirm allocation, outstanding balance and boss-alert status display.
11. Record one copy or print sharing action and confirm it appears in the timeline.
12. Confirm Hire, Mining and Spare Parts workspaces continue to load normally.

Do not use a real customer identity document for the smoke test unless business operations require it.
