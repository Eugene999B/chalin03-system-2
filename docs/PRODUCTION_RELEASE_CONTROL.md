# Chalin 03 Production Release Control

## Purpose

Production must not deploy merely because a feature pull request is merged into `main`.

Branch responsibilities:

- `agent/*`: isolated implementation or documentation branches;
- `main`: reviewed, integrated release-candidate code;
- `production`: the only branch approved to trigger live Railway and Cloudflare production deployments.

Railway and Cloudflare must watch **only `production`**.

## Normal release process

1. Start from current `main` and create an isolated `agent/*` branch.
2. Implement the smallest controlled change.
3. Update focused tests and documentation.
4. Open a pull request into `main`.
5. Pass backend syntax/tests, frontend tests/lint/build, migration safety when applicable, dependency audit, repository and full-history secret checks, and CodeQL.
6. Complete required desktop/mobile and role/workspace checks.
7. Merge into `main`; this creates a release candidate only.
8. Confirm neither Railway nor Cloudflare deployed from `main`.
9. Open a separate `main → production` pull request.
10. Re-run the applicable production-origin and security gates.
11. Confirm a current signed backup and a known rollback target.
12. Apply approved production migrations through the controlled method before the new backend starts.
13. Merge the promotion PR.
14. Observe Railway and Cloudflare deployments.
15. Verify `/api/health`, authentication, security headers and affected business journeys.
16. Record the released commit, migration evidence and recovery point.

## Controlled Railway production migrations

For the 25 July 2026 release, Railway used:

```text
npm run migrate:production
```

as the backend service **Pre-deploy Command**.

Canonical implementation: `backend/scripts/runProductionMigrations.js`.

The runner is deliberately fail-closed. It requires:

```text
NODE_ENV=production
CHALIN03_PRODUCTION_MIGRATIONS_ENABLED=true
CHALIN03_SIGNED_BACKUP_CONFIRMED=true
CHALIN03_MIGRATION_RELEASE=20260725_PHASE1_POST_PHASE1
```

It connects using the existing Railway DB/MYSQL variables, optionally checks `CHALIN03_EXPECTED_DATABASE`, acquires a MySQL advisory lock, applies only the approved plan, runs read-only verifiers and exits non-zero on any failure. Railway must not start the new backend when the Pre-deploy Command fails.

### Post-release cleanup

The confirmation values and migration plan are specific to the 25 July 2026 release. After retaining the successful logs:

1. remove the release-specific Pre-deploy Command, or set `CHALIN03_PRODUCTION_MIGRATIONS_ENABLED=false` before an unrelated deployment;
2. remove or retire `CHALIN03_SIGNED_BACKUP_CONFIRMED` and `CHALIN03_MIGRATION_RELEASE` when they no longer describe a current release gate;
3. add a new reviewed migration plan and new exact confirmation value for future schema work;
4. never broaden the existing runner silently to execute unreviewed SQL.

## Backup and recovery gate

Before any production migration:

1. download a fresh signed `chalin03-full-system-v2` backup;
2. retain it privately and unchanged;
3. verify its signature/manifest through the supported application controls;
4. record the current production commit and deployment rollback target;
5. never run `database/schema.sql` against production.

Production browser restore remains disabled. Database recovery must use a verified signed backup through an isolated, approved recovery procedure.

## Completed 25 July 2026 release

- Audit/corrective PR: #75 → `main`
- Migration-runner PR: #77 → `main`
- Production-promotion PR: #76 → `production`
- Release candidate: `d71c3f1245d53fc6c636dbb6ef52ee3eaca69d2a`
- Production merge: `84c554e157c9439de12b12a65438ea440c79acc0`
- Fresh signed backup: confirmed before migration
- Financial-control migration: applied and verified
- Audit Sign-Off readiness migration: applied and verified
- Railway deployment: successful
- Live owner acceptance: successful

## Emergency stop

When a migration, build, health check or deployment fails:

1. do not force the failed release live;
2. keep the last successful production deployment serving traffic;
3. preserve the signed backup and failure logs;
4. identify whether the failure is application, configuration or schema-related;
5. correct the issue on an isolated branch and repeat the normal release path;
6. never repair a normal release failure by dropping, truncating or rewriting production records.

## Rollback rule

Do not rewrite database history or run `database/schema.sql` against production. Roll application code forward or use the hosting platform's approved deployment rollback only after confirming database compatibility. Database recovery must use a verified signed backup in an isolated recovery procedure.
