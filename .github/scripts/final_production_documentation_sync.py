from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


readme_path = Path("README.md")
readme = readme_path.read_text()

readme = replace_once(
    readme,
    "| Production baseline recorded 25 July 2026 | `0cf526cdb50690fa70d712c958edceeb19f55e54` |\n| Authentication | Password-only browser sign-in |",
    "| Production release deployed 25 July 2026 | `84c554e157c9439de12b12a65438ea440c79acc0` |\n| Integrated release candidate | `d71c3f1245d53fc6c636dbb6ef52ee3eaca69d2a` |\n| Automated audit | `95 / 100`; 0 Critical and 0 High findings open |\n| Production migrations | Financial-control hardening and Audit Sign-Off readiness applied and verified |\n| Authentication | Password-only browser sign-in |",
    "README production table",
)

readme = replace_once(
    readme,
    "The baseline commit is historical evidence, not a permanent pointer. Before every release, verify the current `main` head, the `main → production` pull request, GitHub checks, Railway deployment and Cloudflare deployment.",
    "The current production release was promoted through PR #76 after PR #75 completed the post-Phase-1 audit and PR #77 added the fail-closed Railway migration runner. The commit values above are release evidence, not permanent pointers. Before every later release, verify the current `main` head, the exact `main → production` pull request, GitHub checks, Railway deployment and Cloudflare deployment.",
    "README baseline paragraph",
)

railway_anchor = """ALLOW_WEB_RESTORE=false
```

`DB_SSL_REJECT_UNAUTHORIZED=false` is accepted only for the effective Railway private MySQL host ending in `.railway.internal`. External/public MySQL hosts must retain certificate verification or use an explicit trusted CA through `DB_SSL_CA_BASE64`."""
railway_replacement = """ALLOW_WEB_RESTORE=false
```

### Controlled Railway migration runner

The approved 25 July 2026 production release used:

```text
npm run migrate:production
```

through Railway's **Pre-deploy Command**. The runner:

- requires `NODE_ENV=production`;
- requires explicit migration, signed-backup and release confirmation variables;
- connects with the existing Railway MySQL variables;
- acquires a MySQL advisory lock;
- applies only the approved financial-control and Audit Sign-Off readiness migrations;
- executes both read-only verifier files;
- exits non-zero and blocks the new deployment when any check fails.

Canonical runner: `backend/scripts/runProductionMigrations.js`.

The runner is release-specific. After the deployment and migration logs are retained, remove the one-release Pre-deploy Command or disable its confirmation variable before an unrelated future release. A later migration set must receive a new reviewed runner plan and exact release confirmation value; do not silently reuse the 25 July 2026 confirmation.

`DB_SSL_REJECT_UNAUTHORIZED=false` is accepted only for the effective Railway private MySQL host ending in `.railway.internal`. External/public MySQL hosts must retain certificate verification or use an explicit trusted CA through `DB_SSL_CA_BASE64`."""
readme = replace_once(
    readme,
    railway_anchor,
    railway_replacement,
    "README Railway migration section",
)

readme = replace_once(
    readme,
    "| Production migrations | `database/migrations/` and controlled migration services |",
    "| Production migrations | `database/migrations/`, `backend/scripts/runProductionMigrations.js` and controlled migration services |",
    "README canonical migration source",
)

old_status = """## 15. Current release status and planned next step

As of the recorded 25 July 2026 baseline:

- Phase 0 production-safety hardening is complete;
- signed Version 2 backup/recovery controls are active;
- production deploys only from `production`;
- Railway MySQL connects through encrypted private-network TLS;
- the live system is operating without reported worker defects;
- a fresh signed production backup has been downloaded and stored privately;
- in-app help and the handbook are being synchronized before the next audit.

The next controlled programme is a full-system evidence review and rescoring. New feature families should wait until that review identifies and prioritizes any remaining correctness, permission, usability or documentation gaps."""
new_status = """## 15. Current release status and planned next step

As of the completed 25 July 2026 production release:

- the post-Phase-1 full-system automated audit is complete at **95 / 100**;
- all identified Critical and High findings are resolved;
- PR #75 is merged into `main`;
- PR #77 added and verified the Railway production migration runner;
- a fresh signed Version 2 production backup was downloaded before migration;
- the financial-control and Audit Sign-Off readiness migrations were applied and verified by Railway before deployment;
- PR #76 promoted the exact reviewed `main` release to `production`;
- Railway reported a successful backend deployment;
- the production frontend and live workspaces were checked successfully by the authorised owner;
- existing production business data remained available;
- the live release commit is `84c554e157c9439de12b12a65438ea440c79acc0`.

The next step is normal monitored operation: preserve the signed backup and deployment logs, remove or disable the one-release Railway migration confirmation after evidence is retained, record any live defect before changing code, and use the standard `agent/* → main → production` process for every future update."""
readme = replace_once(
    readme,
    old_status,
    new_status,
    "README current release status",
)
readme_path.write_text(readme)

Path("docs/POST_PHASE1_FULL_SYSTEM_AUDIT.md").write_text("""# Chalin 03 Post-Phase-1 Full-System Audit

## Final result

- **Automated audit score:** **95 / 100**
- **Automated-control confidence:** High
- **Critical findings open:** 0
- **High findings open:** 0
- **Audit PR:** #75 — merged into `main`
- **Migration-runner PR:** #77 — merged into `main`
- **Production-promotion PR:** #76 — merged into `production`
- **Integrated release candidate:** `d71c3f1245d53fc6c636dbb6ef52ee3eaca69d2a`
- **Production release commit:** `84c554e157c9439de12b12a65438ea440c79acc0`
- **Production deployment:** successful
- **Production database migrations:** applied and verified
- **Live owner acceptance:** successful

The five-point deduction remains an evidence-quality deduction from the automated audit, not an open Critical or High defect. The audit environment could not independently operate every desktop/mobile journey or revalidate the external Google Docs handbook. The authorised owner subsequently reported that the live production release and tested features were successful.

## Weighted audit register

| Area | Weight | Score | Evidence |
|---|---:|---:|---|
| Production safety, migrations and disaster recovery | 15 | 15 | Signed backup, production restore block, additive migration gates, Railway pre-deploy runner and verified production migration execution |
| Authentication, sessions and shared security | 12 | 12 | Password authentication, server sessions, token versioning, revocation, recovery controls and secure offboarding |
| Permissions, category and location isolation | 12 | 12 | Endpoint permissions, Spare Parts store context, Mining-site scope, Hire-location scope and protected original-owner boundary |
| Monetary correctness and approvals | 14 | 14 | Independent approval, immutable expense reversal, protected records, Daily Closing and financial validation contracts |
| Spare Parts correctness | 10 | 10 | Store isolation and complete automated workflow coverage |
| Mining correctness | 10 | 9 | Site scope, permissions, approvals, schema and route contracts; live acceptance reported successful |
| Equipment Sales & Hire correctness | 12 | 11 | Catalogue, sales, Hire, finance, location and conflict controls; live acceptance reported successful |
| Reports, documents, workforce and audit evidence | 7 | 7 | PDF/export, signature snapshot, workforce privacy, immutable sign-off and audit evidence |
| Mobile, usability and accessibility | 4 | 2 | Source/layout contracts and production build; independent device evidence was not captured in the automated audit |
| Testing, deployment and documentation | 4 | 3 | 400 backend tests at audit close, frontend tests/lint/build, migration/security gates and successful deployment; external handbook still requires independent synchronization evidence |
| **Total** | **100** | **95** | **Release deployed successfully with no open Critical or High finding** |

## Resolved findings

### C-001 — System-wide clear operation could partially erase data

Production is permanently blocked from using the browser test-data reset. Explicitly enabled non-production resets use transaction-compatible deletion, verify zero counts before commit, restore foreign-key checks and roll back safely on injected failure.

### H-001 — Audit sign-offs could be physically deleted

Audit Sign-Off records are immutable. The backend blocks deletion and the interface no longer exposes a Delete action.

### H-002 — Permanent user deletion destroyed historical attribution

Permanent deletion was replaced with **Temporary Disable** and **Secure Offboard**. Historical staff identity remains attached to financial and audit evidence while live sessions and access are revoked.

### M-001 — Legacy physical expense deletion remained in the route file

The shadowed physical-delete implementation was removed. Expense correction uses the approved immutable void-and-reversal workflow.

### M-002 — Audit routes performed request-time schema mutation

Runtime schema mutation was replaced by read-only readiness checks. The additive Audit Sign-Off migration supplies and verifies the required columns and indexes.

## Production migration and deployment evidence

Before production promotion:

1. a fresh signed `chalin03-full-system-v2` backup was downloaded and retained;
2. `20260725_phase1_financial_control_hardening.sql` and its verifier were approved;
3. `20260725_post_phase1_audit_signoff_readiness.sql` and its verifier were approved;
4. the fail-closed Node runner was merged through PR #77;
5. Railway was configured with `npm run migrate:production` as a Pre-deploy Command;
6. exact backup, migration-enable and release-confirmation variables were supplied;
7. PR #76 promoted `main` to `production`;
8. Railway reported successful deployment of production merge commit `84c554e157c9439de12b12a65438ea440c79acc0`;
9. the authorised owner reported the live system and new features successful.

## Evidence checklist

- [x] Repository and route map
- [x] Backend syntax and complete audit test suite
- [x] Frontend tests, lint and production build
- [x] Dependency audit, CodeQL and secret scan
- [x] Migration safety and disposable MySQL evidence
- [x] Signed production backup
- [x] Railway migration runner and verifier contracts
- [x] Production migration execution and deployment success
- [x] Live owner acceptance reported successful
- [ ] Independent external Google Docs handbook consistency evidence

## Operating rule

Future changes must start from current `main`, use an isolated branch, pass relevant tests and documentation checks, merge into `main`, and use a separate reviewed `main → production` promotion. Never run `database/schema.sql` against production and never reuse a release-specific migration confirmation for an unrelated migration set.
""")

Path("docs/PRODUCTION_RELEASE_CONTROL.md").write_text("""# Chalin 03 Production Release Control

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
""")

Path("docs/RELEASE_2026-07-25_PHASE1_POST_PHASE1.md").write_text("""# Chalin 03 Production Release — 25 July 2026

## Release identity

- Release: Version Three post-Phase-1 audit and corrective hardening
- Audit score: **95 / 100**
- Critical findings open at release: **0**
- High findings open at release: **0**
- Audit PR: #75
- Railway migration-runner PR: #77
- Production promotion PR: #76
- `main` release candidate: `d71c3f1245d53fc6c636dbb6ef52ee3eaca69d2a`
- `production` release commit: `84c554e157c9439de12b12a65438ea440c79acc0`

## Main corrections released

- Audit Sign-Off records became immutable permanent evidence.
- The legacy physical expense-delete route was removed.
- Permanent user deletion was replaced by Temporary Disable and Secure Offboard while preserving historical attribution.
- Audit routes stopped attempting request-time schema mutation and now use read-only readiness checks.
- Production test-data reset became permanently blocked; non-production reset became transactional and rollback-safe.
- Financial and approval controls received the approved additive schema readiness.

## Database release

A fresh signed Version 2 full-system backup was downloaded before migration.

Railway executed `npm run migrate:production` before starting the new backend. The runner applied and verified:

1. `20260725_phase1_financial_control_hardening.sql`;
2. `20260725_post_phase1_audit_signoff_readiness.sql`.

The runner used an advisory lock, exact release confirmation and read-only verifiers. Railway reported deployment success for the production merge commit.

## Verification evidence

- Complete backend audit suite passed.
- Frontend tests, lint and production build passed.
- Production dependency audit passed.
- CodeQL security-extended policy passed.
- Full-history secret scan passed.
- Production migration-safety checks passed.
- Disposable MySQL acceptance passed for secure offboarding, audit schema readiness and transactional maintenance rollback.
- The authorised owner reported the live system and new features successful after deployment.

## Operational follow-up

- Keep the signed backup and deployment logs unchanged until the release is fully settled.
- Remove or disable the one-release Railway migration confirmation before an unrelated deployment.
- Record any live defect before changing code.
- Use `agent/* → main → production` for every future change.
- Never run `database/schema.sql` against production.

## Documentation status

Repository README, audit report, production release-control guide and this release record are synchronized with the deployed release. The external Google Docs handbook still requires a separate consistency update and evidence check.
""")
