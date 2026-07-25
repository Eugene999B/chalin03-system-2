# Chalin 03 Production Release — 25 July 2026

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


## Independent post-release review follow-up

A later independent Slack review identified one genuine dormant security risk and one reporting-consistency gap. The follow-up hardening:

- removed the shadowed password-only `/owner/login` implementation from the legacy Release 2 router, leaving the MFA/recovery-code implementation as the only Owner Break-Glass login path;
- retained the existing fail-closed Spare Parts branch middleware after confirming the claimed active branch-1 fallback was not reachable through protected routes;
- added explicit `VOIDED` and `REVERSAL` correction evidence to Daily Closing PDF, Excel and Word output data, matching the browser control evidence while preserving both immutable ledger rows;
- added permanent regression tests for the unique MFA login route and cross-format expense-correction presentation.

This is post-release defence-in-depth and evidence consistency work. It does not rewrite the original 95/100 audit result or imply that the deployed release had an active Critical or High incident.
