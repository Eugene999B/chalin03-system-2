# CHALIN ONE — Phase 2 Public Content Database Runbook

This runbook is for the additive public website and Chalin Content Studio database foundation.

## Permanent branch rule

```text
chalin-one -> main verification -> production -> Cloudflare and Railway
```

Do not merge or deploy this phase independently. The complete CHALIN ONE project remains on `chalin-one` until final acceptance.

## Files

```text
database/migrations/20260805_chalin_one_public_content_foundation.sql
database/migrations/20260805_chalin_one_public_content_foundation_verify.sql
backend/scripts/runChalinOnePublicContentFoundationMigration.js
```

## What the migration does

- Creates 28 new tables whose names begin with `public_`.
- Does not alter or remove an existing Chalin 03 business table.
- Creates no website content records.
- Records itself in `schema_migrations`.
- Preserves counts in critical existing tables.
- Supports a safe second execution through `CREATE TABLE IF NOT EXISTS` and an idempotent migration record.

## What the migration does not do

- It is not included in `npm start`.
- It does not enable the public website.
- It does not enable Content Studio.
- It does not change Cloudflare or Railway configuration.
- It does not merge any branch.
- It does not run against production during normal development.

## Required isolated database

Use a dedicated database such as:

```text
chalin03_chalin_one_test
```

Do not use a database named:

```text
railway
production
prod
```

for a non-production rehearsal.

## Local preparation

From the project root on Windows PowerShell:

```powershell
cd C:\Users\DDK\Desktop\chalin03-system\backend
npm install
```

Create or update `backend/.env` for the isolated test database:

```env
NODE_ENV=development
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_LOCAL_MYSQL_PASSWORD
DB_NAME=chalin03_chalin_one_test
DB_SSL=false

CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=true
CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM=20260805_CHALIN_ONE_PUBLIC_CONTENT_FOUNDATION
```

The two migration variables are temporary operation gates. Return them to false/blank immediately after the rehearsal.

## Run static safety and code tests first

```powershell
npm run migration-safety -- --base origin/main --head HEAD
npm run syntax-check
npm test
```

All commands must pass before connecting the runner to any database.

## First migration rehearsal

```powershell
npm run migrate:chalin-one:public-content
```

Expected success message:

```text
CHALIN ONE public-content foundation verified: 28 tables present; existing business row counts unchanged.
```

## Second idempotency rehearsal

Run the exact same command again:

```powershell
npm run migrate:chalin-one:public-content
```

It must complete successfully again without:

- Duplicate-table errors.
- Duplicate migration records.
- Changes to existing business row counts.
- Missing foreign keys or indexes.

## Manual read-only verification

Run this file in MySQL Workbench against the isolated database:

```text
database/migrations/20260805_chalin_one_public_content_foundation_verify.sql
```

Required observations:

1. The migration record exists once.
2. The `missing_table` query returns zero rows.
3. All `public_` tables use InnoDB and utf8mb4.
4. Required columns are present.
5. Index and foreign-key result sets are populated.
6. New content tables are empty unless test content was intentionally added.

## Existing-system regression check

After the migration, start the existing backend and frontend with every CHALIN ONE feature flag disabled:

```env
FEATURE_AI_ENABLED=false
FEATURE_PUBLIC_WEBSITE=false
FEATURE_CONTENT_STUDIO=false
FEATURE_CHALIN_COPILOT=false
FEATURE_CHALIN_EXECUTIVE=false
FEATURE_CHALIN_GUIDE=false
FEATURE_CUSTOMER_PORTAL=false
FEATURE_SUPPLIER_PORTAL=false
FEATURE_APPLICANT_PORTAL=false
FEATURE_AI_ACTIONS=false
FEATURE_AI_SCHEDULED_JOBS=false
```

Verify:

- Login.
- Spare Parts sales and receipts.
- Products and stock.
- Customer statements and customer merging.
- Debts and payments.
- Mining workspace.
- Equipment Hire workspace.
- Equipment Finance workspace.
- Reports, backups and permissions.

The new empty tables must not change existing behaviour.

## Safe production-copy rehearsal

This is performed later, after local acceptance, against a recent restored copy of production—not the live production database.

Required evidence:

- Source backup identity.
- Restored test database name.
- First migration result.
- Second migration result.
- Verification query output.
- Existing table count comparison.
- Existing application regression result.

## Production gates for the final project release

The runner requires all of the following only when `NODE_ENV=production`:

```env
CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=true
CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM=20260805_CHALIN_ONE_PUBLIC_CONTENT_FOUNDATION
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_SQL_BACKUP_CONFIRMED=true
```

These values are used only during the controlled final release operation after:

1. The complete CHALIN ONE branch is finished.
2. It is merged into `main`.
3. `main` is fully verified.
4. The approved `main` release is promoted into `production`.

## After any migration operation

Return the operation gates to safe defaults:

```env
CHALIN_ONE_ALLOW_SCHEMA_MIGRATION=false
CHALIN_ONE_PUBLIC_CONTENT_MIGRATION_CONFIRM=
CHALIN03_SIGNED_BACKUP_CONFIRMED=false
CHALIN03_SQL_BACKUP_CONFIRMED=false
```

## Rollback principle

This migration is additive. The previous application can ignore the new tables.

Do not drop the new tables automatically if a later feature fails. Roll back the application code to the previous verified `production` commit and correct the schema forward with another reviewed migration if necessary.
