# Chalin 03 Post-Phase-1 Full-System Audit

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
