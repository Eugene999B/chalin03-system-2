# Chalin 03 Production Release — 25 July 2026

## Release identity

- Release: Version Three post-Phase-1 audit and corrective hardening
- Audit score: **95 / 100**
- Critical findings open at release: **0**
- High findings open at release: **0**
- Audit PR: #75
- Railway migration-runner PR: #77
- Initial production-promotion PR: #76
- `main` release candidate: `d71c3f1245d53fc6c636dbb6ef52ee3eaca69d2a`
- Initial `production` release commit: `84c554e157c9439de12b12a65438ea440c79acc0`
- Current post-review production commit: `96ab439931e2331a5a537207881c4467a64856af`

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

Repository README, audit report, production release-control guide, external Google Docs handbook, frozen handbook PDF and this release record are synchronized. A sanitised production source snapshot and SHA-256 checksum for `84c554e157c9439de12b12a65438ea440c79acc0` are retained in the controlled Drive archive.

## Independent post-release review follow-up

A later independent Slack review identified one genuine dormant security risk and one reporting-consistency gap. The follow-up hardening:

- removed the shadowed password-only `/owner/login` implementation from the legacy Release 2 router, leaving the MFA/recovery-code implementation as the only Owner Break-Glass login path;
- retained the existing fail-closed Spare Parts branch middleware after confirming the claimed active branch-1 fallback was not reachable through protected routes;
- added explicit `VOIDED` and `REVERSAL` correction evidence to Daily Closing PDF, Excel and Word output data, matching the browser control evidence while preserving both immutable ledger rows;
- added permanent regression tests for the unique MFA login route and cross-format expense-correction presentation.

Hardening PR #82 merged into `main` at `043bdccb7464c01bb2e3505403dba6cf9eace13c`. Production PR #83 merged at `96ab439931e2331a5a537207881c4467a64856af`, and Railway reported a successful deployment for that exact commit. No schema migration, reset or destructive production data operation was introduced.

## Equipment Sales routing clarification

A subsequent fresh scan initially described `equipmentSalesRoutes.js` and `equipmentSalesFinalizationRoutes.js` as unreachable because they are not directly imported by `server.js`. A deeper route-chain review proved they are active:

1. the frontend calls `/api/equipment-catalogue/sales/...`;
2. `server.js` mounts `/api/equipment-catalogue` with `enforceEquipmentCatalogueWriteIntegrity`;
3. that middleware detects `/sales`, removes the prefix and dispatches into `equipmentSalesRoutes.js`;
4. `equipmentSalesSchemaService.js` attaches `equipmentSalesFinalizationRoutes.js` to the same router.

The files must not be deleted or mounted a second time. Their indirect reachability is documented in `docs/EQUIPMENT_SALES_ROUTING_ARCHITECTURE.md` and protected by `backend/tests/equipmentSalesReachabilityContract.test.js`.

## Performance backlog

The production frontend build remains healthy. Route-level lazy loading for heavier reporting, accounting, Mining, Equipment Sales & Hire and Group Executive pages is a separate measured performance improvement so it cannot be mixed with security or financial-control changes.
