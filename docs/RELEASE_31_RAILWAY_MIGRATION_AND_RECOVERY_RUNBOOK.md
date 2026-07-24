# Chalin 03 Release 3.1 Railway Migration and Recovery Runbook

## Scope

This is the production procedure for PR #56 in `Eugene999B/chalin03-system-2`.
It covers the Railway backend, production MySQL, controlled migrations, rollback,
workspace verification, and the final GitHub source backup.

Release 3.1 is additive. Ordinary HTTP requests must never create, alter, drop,
truncate, or rename database objects.

## Production authority

- Production branch: `main`
- Release PR: `#56`
- Railway backend directory: `backend`
- Railway command: `npm start`
- Effective startup:

```text
node scripts/runControlledDeployment.js --deployment && node server.js
```

The API starts only after controlled migrations and read-only verification pass.

## Absolute safeguards

1. Never run `database/schema.sql` against production.
2. Never run `npm run drill:release31` against Railway. The drill accepts only
   localhost and a database ending `_test`.
3. Never deploy without a fresh Railway database snapshot or an accepted,
   verified Chalin 03 recovery package.
4. Never bypass a failed verification query or migration checksum error.
5. Keep PR #56 draft until executable validation evidence exists.
6. Restore the Railway snapshot whenever database integrity cannot be proven.
7. Do not create the final GitHub source backup until the merged commit and
   production verification are complete.

## Merge gates

All of these must have evidence:

- Repository whitespace check.
- Backend `npm ci`.
- Backend syntax check.
- Migration-safety check against the PR base SHA.
- Complete backend test suite.
- Frontend source tests.
- Frontend production build.
- Disposable MySQL 8.4 migration and recovery drill.
- `release31-disposable-drill-evidence.json` with `status: passed`.
- Evidence field `backup_history_recorded: true`.
- Fresh Railway snapshot reference and UTC timestamp.
- Named approver and change ticket.

Full-project frontend lint is retained as advisory legacy debt for this
backend/database safety release. It does not replace source tests or the build.

## Phase 1 — Freeze and identify the current state

1. Announce the maintenance window.
2. Stop new sales, payments, stock movements, mining entries, hire entries, and
   audit approvals during the database change.
3. Record the currently deployed Railway commit and deployment ID.
4. Confirm the current API health endpoint is healthy.
5. Confirm Railway snapshot restoration access before proceeding.

## Phase 2 — Create fresh Railway snapshot evidence

Create a production database snapshot immediately before deployment and record:

- Exact snapshot reference.
- Creation timestamp in UTC ISO-8601 format.
- Railway project and environment.
- Operator who created and checked the snapshot.

The default approved age is 24 hours. Generate the bound attestation from the
`backend` directory:

```powershell
npm run migrate:snapshot-attestation -- "<SNAPSHOT_REFERENCE>" "<UTC_ISO_TIMESTAMP>"
```

Set these temporary Railway backend variables exactly:

```text
NODE_ENV=production
MIGRATION_BACKUP_SOURCE=railway_snapshot
MIGRATION_BACKUP_REFERENCE=<exact snapshot reference>
MIGRATION_BACKUP_CREATED_AT=<exact UTC timestamp>
MIGRATION_BACKUP_SHA256=<generated SHA-256>
MIGRATION_APPROVED_BY=<approved operator identity>
MIGRATION_CHANGE_TICKET=<change reference>
```

The first controlled-migration ledger bootstrap requires
`MIGRATION_BACKUP_SOURCE=railway_snapshot`.

## Phase 3 — Preflight from the exact release commit

From a clean checkout:

```powershell
cd backend
npm ci
npm run syntax-check
npm test
npm run migrate:plan
```

The plan must show only approved pending entries from
`database/migrations/controlled-manifest.json`. Stop for an unknown migration,
missing verification file, checksum mismatch, or conflicting history record.

Expected Release 3.1 sequence includes:

1. `20260723_release31_database_safety_guards`
2. `20260723_release31_audit_schema_safety`
3. `20260723_release31_runtime_schema_baseline`
4. `20260723_release31_audit_schema_baseline`

## Phase 4 — Deploy

1. Merge only after all executable gates pass.
2. Deploy the exact merged `main` commit.
3. Watch Railway logs from process startup.
4. Confirm the migration lock is acquired.
5. Confirm every SQL migration and baseline verification passes.
6. Confirm `server.js` starts only after migration completion.
7. Record the new deployment ID and commit SHA.

## Phase 5 — Database verification

Confirm `controlled_migration_history` contains one passed record for every
manifest entry, including migration and verification checksums, backup evidence,
approver, change ticket, result summary, and applied timestamp.

Confirm the audit contract contains:

- `audit_signoffs`
- `audit_unlock_requests`
- `audit_reapproval_log`
- Required columns and indexes.
- Every approved `request_area` value.

Confirm application logs show no runtime DDL from normal requests.

## Phase 6 — Workspace smoke checks

### Shared

- Open `https://chalin03.com` and `https://www.chalin03.com`.
- Confirm API health.
- Confirm an existing active Administrator can sign in.
- Confirm invalid credentials fail without a server error.
- Confirm audit/security events retain user, workspace, location, and outcome.

### Spare Parts

- Only the two approved Spare Parts stores appear.
- Administrator, Manager, Cashier, and Auditor scopes remain correct.
- Open Dashboard, Sales History, Products, Debts, Purchases, Returns, Reports,
  Activity Log, SMS Center, and Backup/Recovery.
- Do not create a live sale solely for testing without business approval.

### Mining Operations

- Mining has its own sidebar and never inherits Spare Parts stores.
- The active site selector uses Administrator-created mining sites.
- A site-scoped user cannot access another site.
- Open dashboard, daily logs, production, fuel, expenses, incidents, stockpiles,
  dispatches, and closings.

### Equipment Hire and Sales

- Hire has its own sidebar and Administrator-created location selector.
- Hire-location scope is enforced.
- Open enquiries, quotations, contracts, dispatches, work logs, invoices,
  payments, returns, fleet, catalogue, and equipment sales.
- An actively hired asset cannot be sold.
- A sale-locked asset cannot enter an active hire contract.

### Audit

- Open sign-off history and unlock requests.
- Confirm existing audit records remain present.
- Missing audit schema must return controlled `503 AUDIT_SCHEMA_NOT_READY`, never
  perform schema repair.

## Phase 7 — Backup and recovery verification

Create a new protected full-system backup and confirm:

- Manifest version is `chalin03-version-3.1-full-recovery-v3`.
- Schema contract version is
  `tables-columns-foreign-keys-indexes-triggers-v1`.
- Canonical tables, row counts, protected owner, schema fingerprint, index count,
  trigger count, and package checksum are present.
- Protected dry-run validation records `validated/verified` evidence in
  `backup_history`.
- A completed restore records `restored/verified`; a rolled-back failure records
  `restore_failed/failed`.
- Restored sessions and biometric credentials are invalidated.

Keep the private recovery package outside the public web root.

## Rollback triggers

Rollback or stop deployment for:

- Migration or verification failure.
- API startup before migration completion.
- Valid production users unable to sign in.
- Missing or materially changed business records.
- Workspace/location isolation failure.
- Missing audit records.
- Hire/sale conflict guards failing.
- Backup creation or validation failure.
- Repeated database-related 500 errors.

## Rollback procedure

1. Stop application writes and preserve logs/evidence.
2. If migrations failed before traffic switched, keep the last healthy deployment.
3. Use a reviewed forward migration only when data and schema integrity are proven.
4. Restore the fresh pre-deployment Railway snapshot when integrity is uncertain.
5. Redeploy the last compatible application commit.
6. Re-run database, workspace, audit, and backup verification before reopening.
7. Never delete or rewrite migration-history evidence manually.

## Completion and final GitHub backup

After production verification succeeds:

1. Record merged commit SHA and Railway deployment ID.
2. Retain migration and disposable-drill evidence.
3. Retain the pre-deployment Railway snapshot under the recovery policy.
4. Remove temporary migration-attestation variables when no migration is pending.
5. Create the final source archive from the merged GitHub `main` branch.
6. Record the archive filename, merged commit SHA, and SHA-256.
7. Update the project handoff with deployment and recovery evidence.

## Release record

```text
Release: Chalin 03 Release 3.1
Change ticket:
Approved by:
PR: #56
Merged commit SHA:
Previous Railway deployment ID:
New Railway deployment ID:
Railway snapshot reference:
Snapshot created at UTC:
Snapshot attestation SHA-256:
Disposable drill artifact:
Backup history evidence: restored / verified
Backend checks:
Frontend source tests:
Frontend production build:
Post-deploy verification operator:
Post-deploy verification UTC:
Rollback required: Yes / No
Final GitHub source backup filename:
Final GitHub source backup SHA-256:
Notes:
```
