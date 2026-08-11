# Inventory Loss Prevention & Traceability — Production Migration Runbook

## Status

This runbook prepares a future controlled production release. It does **not** authorize a merge, deployment, or migration by itself. Draft PR #489 remains DO NOT MERGE until the owner explicitly authorizes release.

The production migration command is:

```bash
cd backend
npm run migrate:inventory-loss-prevention:production
```

The command must never be added to normal API startup. It is a one-time, explicitly gated operation.

## Required release evidence before running

Do not run the production migration unless all of the following are true immediately before the operation:

1. The final feature-branch CI and permanent Chromium inventory pilot are green on the intended release head.
2. The disposable MySQL 8.4 migration rehearsal is green on the intended release head.
3. Production Migration Safety and Full-History Secret Scan are green.
4. A **fresh Professional Backup** has been created, downloaded/retained, and verified as restorable.
5. A **separate fresh SQL/database backup** has been created and independently verified.
6. The exact Railway production database name has been confirmed.
7. The owner has explicitly authorized the Inventory Loss Prevention & Traceability release.

A backup from an earlier payroll, finance, hotfix, or unrelated release does not satisfy this gate. The backups must be fresh for this inventory migration operation.

## Approved migration order

The runner pins and verifies these migrations in this exact order:

1. `20260810_inventory_traceability_foundation.sql`
2. `20260810_inventory_loss_detection_foundation.sql`
3. `20260810_inventory_count_snapshot_hardening.sql`
4. `20260811_inventory_transfer_traceability.sql`

Each migration has a matching read-only `_verify.sql` file. The runner checks `schema_migrations` before each stage. If exactly one marker already exists, it skips reapplying that migration and still runs its verifier. If the marker is absent, it applies the migration once, requires exactly one marker afterward, and then runs the verifier. Duplicate markers or any verifier problem stop the release.

## Required environment gates

Set these only for the controlled migration operation:

```text
NODE_ENV=production
CHALIN03_INVENTORY_MIGRATIONS_ENABLED=true
CHALIN03_INVENTORY_RELEASE_AUTHORIZED=true
CHALIN03_INVENTORY_MIGRATION_REHEARSAL_CONFIRMED=true
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_SQL_BACKUP_CONFIRMED=true
CHALIN03_MIGRATION_RELEASE=20260811_INVENTORY_LOSS_PREVENTION_TRACEABILITY
CHALIN03_EXPECTED_DATABASE=<exact production database name>
```

Normal database connection variables must also resolve to the intended production database through the existing `DB_*` or `MYSQL*` variables. Optional TLS behavior follows the repository's established `DB_SSL`, `DB_SSL_CA_BASE64`, and `DB_SSL_REJECT_UNAUTHORIZED` controls.

Do not persist the one-time enable/authorization confirmation flags longer than necessary. Clear or disable them after the controlled migration succeeds or aborts.

## What the runner protects

Before changing schema, the runner:

- requires `NODE_ENV=production`;
- requires all release/backup/rehearsal confirmation gates;
- requires the exact release token;
- requires the exact expected database name and rejects a mismatched connection;
- requires the existing `schema_migrations` control table;
- acquires a named MySQL advisory lock so two Inventory migration operations cannot run concurrently.

During execution, every approved stage is verified before the next stage begins. A non-zero `problem_count`, missing `PASS`, wrong selected database, SQL error, missing marker, duplicate marker, or lock failure aborts the runner.

## Abort conditions

Do not continue manually if the runner stops. Preserve the output and investigate first. In particular, stop for:

- database-name mismatch;
- inability to acquire the migration lock;
- missing or duplicate migration marker;
- any verifier result other than `problem_count=0` and `PASS`;
- SQL/connection/TLS errors;
- missing backup evidence or uncertainty about restore capability.

Do not paste later migrations manually to "finish" a partially failed run. The runner is intentionally restart-safe: after the issue is understood and corrected, rerunning it will skip already-marked stages and verify them before continuing.

## Rollback and recovery rule

These Inventory migrations are additive. Do not attempt an improvised destructive SQL rollback. If production must be restored, use the fresh verified backup/recovery process and preserve the failed migration evidence for diagnosis. Otherwise use a reviewed forward-fix migration.

## Post-migration checks before application rollout

After the runner reports that all approved Inventory migrations and verifiers passed:

1. Confirm all four Inventory migration markers exist exactly once.
2. Run the read-only verifiers again if any operational doubt remains.
3. Keep existing products at their current quantity/off behavior; there is no automatic conversion to serialization.
4. Deploy the application only through the normal reviewed `main` → production release path.
5. Pilot serialization deliberately on owner-selected products/stores. Initial `enforced` activation must occur only after exact physical identities reconcile with system stock.
6. Watch Sale, Return Quarantine, Stock Transfer, Blind Count, and investigation flows during the pilot.

## Current rehearsal evidence

The permanent workflow `Inventory Loss Prevention Migration Rehearsal` uses a disposable MySQL 8.4 service and a dedicated pre-feature test fixture. It does not connect to Railway or production data. It proves migration order, read-only verifier success, serialized enforcement lifecycle compatibility, second-pass idempotence, exact migration-marker count, and preservation of a seeded legacy product's business values.

Production backups and explicit owner release authorization are still required even when this rehearsal is green.
