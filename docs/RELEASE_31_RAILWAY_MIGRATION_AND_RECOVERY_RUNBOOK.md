# Chalin 03 Release 3.1 Railway Migration and Recovery Runbook

## Purpose

This runbook controls the first production deployment of the Release 3.1 database-safety and disaster-recovery changes. It applies to the Chalin 03 production backend on Railway and the production MySQL database.

Release 3.1 is additive. Application requests must never create, alter, drop, truncate, or rename production database objects. All schema changes are applied by the controlled deployment runner before `server.js` starts.

## Absolute rules

1. Never run `database/schema.sql` against production.
2. Never use the disposable drill against Railway. The drill accepts only localhost and a database whose name ends in `_test`.
3. Never deploy without a fresh Railway database snapshot or a current verified Chalin 03 full-system backup accepted by the migration attestation service.
4. Never bypass a failed migration verification query.
5. Keep the pull request draft and production unchanged until every release gate has evidence.
6. A failed controlled migration means the API must not start.
7. Database rollback uses a verified Railway snapshot. Code rollback alone is not a substitute when database state is uncertain.

## Release authority

- Repository: `Eugene999B/chalin03-system-2`
- Release pull request: `#56`
- Production branch: `main`
- Backend working directory on Railway: `backend`
- Backend start command: `npm start`
- Effective start sequence:

```text
node scripts/runControlledDeployment.js --deployment && node server.js
```

The `&&` is intentional. The API starts only when controlled migrations and verification pass.

## Required release evidence

Before merging or deploying, retain the following evidence:

- Successful backend syntax check.
- Successful backend test suite.
- Successful migration-safety check against the pull-request base SHA.
- Successful frontend source tests.
- Successful frontend production build.
- Successful disposable MySQL migration and backup/restore drill.
- `release31-disposable-drill-evidence.json` artifact with `status: passed`.
- Fresh Railway snapshot reference and UTC creation timestamp.
- Named production approver.
- Change-ticket reference.
- Post-deploy workspace verification record.

Full-project frontend lint is recorded as legacy debt for this backend-only release. It does not replace source tests or the production build.

## Phase 1 — Pre-deployment freeze

1. Announce a short maintenance window.
2. Confirm that cashiers and managers are not entering sales, payments, stock movements, mining records, hire records, or audit approvals during the database change.
3. Confirm PR #56 is mergeable and contains only reviewed Release 3.1 work.
4. Record the current production Railway deployment ID and commit SHA.
5. Record the current production database service and environment name.
6. Confirm the production health endpoint is healthy before change work begins.
7. Confirm access to Railway snapshot restoration before taking the new snapshot.

## Phase 2 — Fresh Railway snapshot

Create a Railway database snapshot immediately before deployment.

Record exactly:

- Snapshot reference or identifier.
- Snapshot creation timestamp in UTC ISO-8601 format.
- Railway project and environment.
- Person who created and verified the snapshot.

The default approved evidence window is 24 hours. A timestamp more than 24 hours old is rejected. The configured window may be changed only through `MIGRATION_BACKUP_MAX_AGE_HOURS`, between 1 and 168 hours, with documented approval.

Generate the attestation values from the backend directory:

```powershell
npm run migrate:snapshot-attestation -- "<RAILWAY_SNAPSHOT_REFERENCE>" "<UTC_ISO_TIMESTAMP>"
```

Example timestamp format:

```text
2026-07-23T16:30:00.000Z
```

Copy the four generated values exactly. Do not calculate or type the checksum manually.

## Phase 3 — Railway migration variables

Set these temporary variables on the production backend service:

```text
NODE_ENV=production
MIGRATION_BACKUP_SOURCE=railway_snapshot
MIGRATION_BACKUP_REFERENCE=<exact snapshot reference>
MIGRATION_BACKUP_CREATED_AT=<exact UTC ISO timestamp>
MIGRATION_BACKUP_SHA256=<generated attestation SHA-256>
MIGRATION_APPROVED_BY=<full name or approved operator identity>
MIGRATION_CHANGE_TICKET=<release/change reference>
```

Optional only when formally approved:

```text
MIGRATION_BACKUP_MAX_AGE_HOURS=<1 to 168>
```

For the first controlled-migration-ledger bootstrap, `railway_snapshot` is mandatory. A Chalin 03 JSON backup cannot replace the first Railway snapshot requirement.

After the migration ledger exists, a later release may use:

```text
MIGRATION_BACKUP_SOURCE=chalin03_verified_backup
```

That option is accepted only when `backup_history` contains the exact backup ID, package checksum, current manifest version, current schema fingerprint, `status=validated`, `verification_status=verified`, and verification timestamps inside the approved window.

## Phase 4 — Preflight plan

From a clean checkout of the release commit, run in the backend directory:

```powershell
npm ci
npm run syntax-check
npm test
npm run migrate:plan
```

The plan must show only the expected pending Release 3.1 entries. Do not continue if an unknown migration appears, a checksum changed, a verification file is missing, or a previously recorded migration conflicts with the manifest.

## Phase 5 — Deployment

1. Merge only after all release gates are green and reviewed.
2. Deploy the exact merged commit to Railway.
3. Watch the backend logs from the first line of startup.
4. Confirm the migration-ledger lock is acquired.
5. Confirm every pending SQL migration reports successful verification.
6. Confirm baseline entries are recorded only after read-only verification passes.
7. Confirm `server.js` starts only after migration completion.
8. Record the new Railway deployment ID and commit SHA.

Expected migration sequence includes:

- `20260723_release31_database_safety_guards`
- `20260723_release31_audit_schema_safety`
- `20260723_release31_runtime_schema_baseline`
- `20260723_release31_audit_schema_baseline`

The exact order is controlled by `database/migrations/controlled-manifest.json`.

## Phase 6 — Database verification

Confirm `controlled_migration_history` contains one passed record for every manifest entry. Each record must retain:

- Migration name and mode.
- Migration and verification checksums.
- Manifest and application versions.
- Backup source, reference, checksum, and timestamp.
- Approver and change ticket.
- Verification status and summary.
- Applied timestamp.

Confirm the audit schema has:

- `audit_signoffs`
- `audit_unlock_requests`
- `audit_reapproval_log`
- All required Release 3.1 audit columns.
- All required audit indexes.
- Every approved `request_area` enum value.

Confirm ordinary API requests no longer perform schema repair.

## Phase 7 — Application smoke checks

### Shared checks

- Open `https://chalin03.com` and `https://www.chalin03.com`.
- Confirm the API health endpoint responds successfully.
- Confirm login works with an existing active Administrator account.
- Confirm invalid credentials fail without a server error.
- Confirm no request returns an unexpected database-schema mutation error.
- Confirm audit and security logs record the correct user, workspace, location, and outcome.

### Spare Parts

- Confirm only the two approved Spare Parts stores appear.
- Confirm Administrator, Manager, Cashier, and Auditor access remains correctly scoped.
- Open Dashboard, Sales History, Products, Debts, Purchases, Returns, Reports, Activity Log, SMS Center, and Backup/Recovery.
- Create no live sale merely for testing unless the business authorizes it.

### Mining Operations

- Confirm Mining opens with its own sidebar and does not display Spare Parts stores.
- Confirm the active mining-site selector uses Administrator-created sites.
- Confirm a site-scoped user cannot access another site.
- Open Mining dashboard, daily logs, production, fuel, expenses, incidents, stockpiles, dispatches, and closing controls.

### Equipment Hire and Sales

- Confirm Equipment Hire opens with its own sidebar and location selector.
- Confirm hire-location scope is enforced.
- Open enquiries, quotations, contracts, dispatches, work logs, invoices, payments, return inspections, fleet, equipment catalogue, and equipment sales.
- Confirm an actively hired asset cannot be sold.
- Confirm a sale-locked asset cannot be assigned to an active hire contract.

### Audit controls

- Open audit sign-off history.
- Open unlock requests.
- Confirm missing-schema behavior would be a controlled `503 AUDIT_SCHEMA_NOT_READY`, not a schema alteration.
- Confirm existing audit records remain present.

### Backup and recovery

- Create a fresh full-system backup through the protected application workflow.
- Confirm the package uses manifest version `chalin03-version-3.1-full-recovery-v2`.
- Confirm the package contains the canonical table list, row counts, schema fingerprint, package checksum, and protected owner.
- Run protected validation or dry-run verification and confirm `backup_history` records verified evidence.
- Store the private backup outside the public web root.

## Phase 8 — Success criteria

The deployment is successful only when all of the following are true:

- Railway deployment is healthy.
- Controlled migration history is complete and passed.
- No runtime DDL appears in application logs.
- All three workspaces open with correct independent location context.
- Login, permissions, protected owner, and audit controls work.
- Full-system backup creation and validation work.
- No new 500 errors appear in Dashboard, Sales, Debts, Activity Log, Mining, Hire, Equipment Sales, or Audit pages.
- The deployment ID, commit SHA, snapshot reference, evidence files, and verification result are recorded.

## Rollback decision

Rollback immediately when any of these occurs:

- Controlled migration verification fails.
- The API starts before migrations finish.
- Login fails for valid existing production users.
- Existing business records disappear or counts materially change unexpectedly.
- Workspace or location isolation fails.
- Audit records are missing or corrupted.
- Equipment hire/sale conflict guards fail.
- Backup creation or validation fails after deployment.
- Repeated database 500 errors appear.

## Rollback procedure

### When migration fails before API startup

1. Do not bypass the failure.
2. Keep the current production deployment serving if Railway has not switched traffic.
3. Preserve the failed deployment logs.
4. Correct forward on the draft branch with a new migration when no production schema change was committed.
5. Do not edit an already recorded migration file.

### When deployment is unhealthy after schema changes

1. Stop application writes and place the system in maintenance mode.
2. Record the failed deployment ID, commit SHA, migration history rows, and error logs.
3. Redeploy the last known-good application commit only when its code is compatible with the current additive schema.
4. When database integrity is uncertain, restore the fresh pre-deployment Railway snapshot.
5. Verify database restoration before reopening application traffic.
6. Re-run the complete shared, workspace, audit, and backup smoke checks.
7. Do not delete migration-history evidence manually.

### Forward-fix preference

Because Release 3.1 migrations are additive, prefer a reviewed forward migration when production data is intact and the failure can be corrected without destructive rollback. Snapshot restoration is required when data integrity, schema integrity, or security state cannot be proven.

## After successful deployment

1. Export and retain the successful controlled-migration evidence.
2. Retain the fresh Railway snapshot according to the business recovery policy.
3. Remove temporary migration-attestation variables after confirming no pending SQL migration requires them.
4. Keep `MIGRATION_APPROVED_BY` and `MIGRATION_CHANGE_TICKET` only if required by the next controlled change.
5. Create the final source backup from the merged GitHub `main` branch.
6. Record the final source archive SHA-256 and merged commit SHA.
7. Update the project handoff with deployment, backup, and recovery evidence.

## Release record template

```text
Release: Chalin 03 Release 3.1
Change ticket:
Approved by:
PR:
Merged commit SHA:
Railway previous deployment ID:
Railway new deployment ID:
Railway snapshot reference:
Snapshot created at UTC:
Snapshot attestation SHA-256:
Disposable drill artifact:
Migration verification result:
Backend test result:
Frontend source test result:
Frontend production build result:
Post-deploy verification completed by:
Post-deploy verification completed at UTC:
Rollback required: Yes / No
Final GitHub source backup filename:
Final GitHub source backup SHA-256:
Notes:
```
