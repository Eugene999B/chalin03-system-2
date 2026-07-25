# Chalin 03 Post-Phase-1 Full-System Audit

## Executive result

- **Automated audit score:** **95 / 100**
- **Automated-control confidence:** High
- **Overall release confidence:** Moderate until interactive desktop/mobile acceptance is completed
- **Critical findings open:** 0
- **High findings open:** 0
- **Production deployment:** unchanged
- **Production database:** unchanged
- **Audit branch:** `agent/post-phase1-full-system-audit`
- **Pull request:** draft PR #75

The current repository, permanent release gates and disposable-MySQL acceptances provide strong evidence for production safety, authentication, permissions, financial controls, category isolation, all three workspaces, reports, documents, workforce and audit evidence. The remaining five-point deduction is evidence-related: this environment could not interact with the Cloudflare preview on desktop/mobile or independently revalidate the external Google Docs handbook.

No score proves the future absence of defects. The score records the controls and evidence available for this exact reviewed head.

## Weighted audit register

| Area | Weight | Score | Current evidence |
|---|---:|---:|---|
| Production safety, migrations and disaster recovery | 15 | 15 | Signed backup controls, production restore block, additive migration gates, read-only audit readiness and transactional non-production reset acceptance |
| Authentication, sessions and shared security | 12 | 12 | Password-only authentication, server sessions, token versioning, revocation, recovery controls and secure offboarding contracts |
| Permissions, category and location isolation | 12 | 12 | Explicit endpoint permissions, fail-closed Spare Parts store context, Mining-site scope, Hire-location scope and original-owner cross-category boundary |
| Monetary correctness and approvals | 14 | 14 | Independent approval, immutable expense reversal, protected sale/return/payment evidence, Daily Closing and financial validation contracts |
| Spare Parts correctness | 10 | 10 | Store isolation, sales, stock, purchases, debts, returns, expenses, transfers, audit and closing contracts |
| Mining correctness | 10 | 9 | Site scope, permissions, approvals, operational schema, backup and UI route contracts; interactive acceptance remains outstanding |
| Equipment Sales & Hire correctness | 12 | 11 | Catalogue, sales, Hire, finance, dispatch, return, location isolation and sale/Hire conflict contracts; interactive acceptance remains outstanding |
| Reports, documents, workforce and audit evidence | 7 | 7 | PDF/export, signature snapshot, worker privacy, employment document, immutable sign-off and audit evidence contracts |
| Mobile, usability and accessibility | 4 | 2 | Mobile source/layout contracts and production build pass; no interactive device acceptance from this environment |
| Testing, deployment and documentation | 4 | 3 | 400 backend tests, frontend tests/lint/build, migration, secret and security gates; external Google Docs handbook not independently revalidated |
| **Total** | **100** | **95** | **Automated audit complete; interactive release acceptance pending** |

## Resolved findings

### C-001 — System-wide clear operation could partially erase data despite rollback

- **Severity:** Critical
- **Affected area:** `DELETE /api/maintenance/clear-business-data`; all three workspaces.
- **Prior risk:** The old implementation used implicit-commit operations inside a transaction and could be enabled in production.
- **Correction:** Production is permanently blocked regardless of environment flags. Non-production requires explicit opt-in. Clearing now uses transaction-compatible deletes, verifies zero counts before commit, restores foreign-key checks in `finally`, and writes the clear audit event within the same transaction. The interface now identifies the operation as a non-production test reset.
- **Regression evidence:** `maintenanceResetSafety.test.js`; all 400 backend tests; frontend tests, lint and production build; disposable MySQL failure injection restored the retained sale and activity rows, restored foreign-key checks, then completed a successful two-table transactional reset. Artifact digest: `sha256:0d1de3a1c10c3ee898680affbba1e51faf007fe7c4e7281d28204515585d0c33`.
- **Status:** Resolved in product commit `3edfe9861a3b92d1f159d54394a4021e2d700fa3`.

### H-001 — Audit sign-offs could be physically deleted

- **Severity:** High
- **Correction:** Audit sign-offs are permanent. The legacy DELETE endpoint logs the blocked attempt and returns `AUDIT_SIGNOFF_IMMUTABLE`; the archive no longer exposes a Delete action.
- **Regression evidence:** `auditSignoffExpenseImmutability.test.js` and the complete backend/frontend gates.
- **Status:** Resolved.

### H-002 — Permanent user deletion destroyed historical attribution

- **Severity:** High
- **Correction:** Permanent deletion was replaced with temporary Disable and controlled Secure Offboard actions. Secure Offboard retains the identity and historical references while revoking sessions, token state, branch/workspace/site/location access and active permission overrides.
- **Regression evidence:** `userIdentityPreservation.test.js`; disposable MySQL retained historical sale and activity attribution while revoking every live access path.
- **Status:** Resolved.

### M-001 — Shadowed legacy expense route contained physical deletion

- **Severity:** Medium
- **Correction:** The legacy physical-delete handler was removed. The protected immutable void/reversal route is the only expense DELETE behaviour.
- **Regression evidence:** `auditSignoffExpenseImmutability.test.js` and `operationsRouteReleaseContract.test.js`.
- **Status:** Resolved.

### M-002 — Audit routes performed request-time schema mutation

- **Severity:** Medium
- **Correction:** Runtime mutation was replaced by cached, read-only readiness checks. The clean schema and additive migration now provide all required sign-off evidence columns and indexes.
- **Regression evidence:** `auditSchemaReadiness.test.js`; migration applied twice to disposable MySQL; verifier reported no missing schema; production-mode readiness executed only read queries.
- **Status:** Resolved.

## Verified strengths

- Spare Parts fails closed without a selected authorised store.
- Mining and Equipment Sales & Hire retain independent site/location context and do not inherit Spare Parts stores.
- Cashiers cannot gain Mining, Hire or Fleet permissions; auditors remain read-only.
- Completed financial records require controlled correction and independent approval rather than silent rewriting.
- Daily Closing preserves channel-specific, revision and post-closing evidence.
- Equipment identity and sale/Hire conflict controls prevent incompatible assignment.
- Signed full-system backups dynamically cover durable tables and production browser restore remains blocked.
- User offboarding preserves staff identity across historical financial and audit evidence.
- Audit sign-offs and associated compliance evidence are immutable.
- Production runtime schema mutation remains blocked.
- The non-production reset can no longer be enabled in production or partially commit on failure.

## Evidence checklist

- [x] Current repository and route map
- [x] Backend syntax and complete 400-test suite
- [x] Frontend source tests, lint and production build
- [x] Production dependency and security workflow baseline
- [x] CodeQL/security-extended workflow baseline
- [x] Full-history secret scan
- [x] Migration-safety and disposable-database evidence
- [x] Signed backup, restore and non-production reset review
- [x] Production startup configuration review
- [x] Role, permission and category-isolation review
- [x] Financial formula and approval review
- [x] Spare Parts automated workflow review
- [x] Mining automated workflow review
- [x] Equipment Sales & Hire automated workflow review
- [x] Reports, PDF, export, workforce and signature automated review
- [ ] Interactive desktop/mobile acceptance on the deployed preview
- [ ] Independent external Google Docs handbook consistency review

## Remaining release acceptance

PR #75 must remain unmerged until an authorised tester confirms on the deployed preview or a safe local/test backend:

1. Spare Parts opens independently in each authorised store and fails closed with missing/invalid store context.
2. Mining and Equipment Sales & Hire log in without a Spare Parts store and stay within assigned site/location.
3. Audit Sign-Off history shows permanent evidence and no Delete action.
4. User administration shows Disable and Secure Offboard, with no permanent Delete Account action.
5. Maintenance displays Non-Production Test Reset and is disabled in production.
6. Expense void/reversal evidence, Daily Closing corrections and approval controls remain usable.
7. The changed pages are readable and fully operable at desktop and narrow mobile widths.

## Release rule

After interactive acceptance:

1. mark PR #75 ready for review;
2. confirm all permanent gates are green on the unchanged reviewed head;
3. merge PR #75 into `main` only;
4. create a fresh signed backup and apply/verify the additive audit-signoff migration in the approved recovery/deployment procedure;
5. use a separate reviewed `main → production` pull request;
6. perform passive live verification after deployment.

No change from this audit may be promoted directly to `production`.
