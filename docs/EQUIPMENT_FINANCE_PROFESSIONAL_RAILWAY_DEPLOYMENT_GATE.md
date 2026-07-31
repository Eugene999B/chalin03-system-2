# Professional Equipment Installment Finance — Railway Deployment Gate

## Purpose

This temporary release gate applies the reviewed `20260731_EQUIPMENT_FINANCE_PROFESSIONAL` migration through Railway before the backend process starts. It follows the same GitHub-controlled one-time deployment pattern previously used for the protected Mining trial-data cleanup.

## Deployment order

1. Retain a fresh signed Chalin 03 Professional Backup.
2. Retain a separate verified Railway/MySQL SQL backup.
3. Configure the exact temporary Railway variables required by `runEquipmentFinanceProfessionalRebuildMigration.js`.
4. Promote the reviewed release from `main` to `production`.
5. Railway runs `runEquipmentFinanceProfessionalRebuildMigration.js` before `server.js`.
6. Any failed gate, prerequisite, SQL statement, advisory lock, database-identity check or verifier result exits non-zero and prevents the backend deployment.
7. The backend starts only after all ten verifier results are zero.

## Exact temporary variables

```text
NODE_ENV=production
CHALIN03_EQUIPMENT_FINANCE_PROFESSIONAL_ENABLED=true
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_SQL_BACKUP_CONFIRMED=true
CHALIN03_MIGRATION_RELEASE=20260731_EQUIPMENT_FINANCE_PROFESSIONAL
CHALIN03_EXPECTED_DATABASE=<exact Railway production database name>
```

Database credentials remain private Railway variables and must never be committed.

## Safety

- The runner uses only the timestamped professional Finance migration and its read-only verifier.
- It does not run `database/schema.sql`.
- It does not truncate, reset or bulk-delete business records.
- The migration is additive and preserves Spare Parts, Mining, Equipment Hire and existing Finance records.
- The four approved 29 July Equipment Finance prerequisite migrations must already be recorded.

## Required successful evidence

The Railway deployment log must contain:

```text
Professional Equipment Installment Finance migration verified successfully.
```

The application must not be accepted unless Railway then reports the backend deployment healthy.

## Immediate cleanup release

After the migration and smoke tests succeed, a separate reviewed GitHub release must restore the normal backend start command:

```text
node -r ./services/exportWorkbookSafetyBootstrap.js server.js
```

The temporary migration flags must then be disabled or removed from Railway. The migration record remains as permanent database evidence and prevents uncertainty about the installed release.
