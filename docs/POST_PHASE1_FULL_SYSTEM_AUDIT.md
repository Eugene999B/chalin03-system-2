# Chalin 03 Post-Phase-1 Full-System Audit

## Control status

- Audit base: `main`
- Base commit: `fdc0c037727b522da198ad9ece3f80e05e8833a5`
- Audit branch: `agent/post-phase1-full-system-audit`
- Production branch: `production`
- Production deployment: unchanged
- Production database: unchanged
- Audit status: in progress

This register applies the weighted standard in `docs/SYSTEM_GUIDE_AND_AUDIT_STANDARD.md`. Findings must be supported by current repository, automated or controlled runtime evidence. A missing test is not automatically a product defect, but it limits the confidence and score that can be awarded.

## Weighted audit register

| Area | Weight | Evidence status | Score | Findings |
|---|---:|---|---:|---|
| Production safety, migrations and disaster recovery | 15 | In review | — | M-002 |
| Authentication, sessions and shared security | 12 | In review | — | H-002 |
| Permissions, category and location isolation | 12 | In review | — | — |
| Monetary correctness and approvals | 14 | In review | — | H-001, M-001 |
| Spare Parts correctness | 10 | In review | — | M-001 |
| Mining correctness | 10 | In review | — | — |
| Equipment Sales & Hire correctness | 12 | In review | — | — |
| Reports, documents, workforce and audit evidence | 7 | In review | — | H-001, H-002 |
| Mobile, usability and accessibility | 4 | In review | — | — |
| Testing, deployment and documentation | 4 | In review | — | — |
| **Total** | **100** | **In review** | **—** | Four findings recorded |

## Findings

### H-001 — Audit sign-offs can be physically deleted

- **Severity:** High
- **Affected area:** Spare Parts audit archive; `DELETE /api/audit-signoffs/:id`; `AuditSignoffHistoryPage.jsx`
- **Evidence:** The backend physically deletes the `audit_signoffs` row and the compliance archive exposes a normal Delete button.
- **Business risk:** An approved accounting-period sign-off can lose its primary approval record. An activity-log sentence is not an adequate replacement for the deleted sign-off, certificate and linked audit evidence.
- **Correction:** Preserve sign-offs permanently; keep the legacy DELETE endpoint only as a fail-closed compatibility guard; log blocked attempts; direct corrections through review, unlock and re-approval; remove the frontend Delete control.
- **Regression evidence:** Focused source contract, complete backend suite, frontend tests/lint/build and permanent security gates required.
- **Status:** Correction in progress.

### H-002 — Permanent user deletion destroys historical attribution

- **Severity:** High
- **Affected area:** Shared user administration; `DELETE /api/users/:id`
- **Evidence:** `clearUserReferencesBeforeDelete` explicitly sets user references to `NULL` in sales, expenses, debt and purchase payments, Daily Closings, stock approvals, SMS, audit sign-offs, unlock requests, re-approval logs and `activity_log`, then deletes the user row.
- **Business risk:** Financial and security records lose reliable attribution of who recorded, approved, closed, reviewed or performed an action.
- **Correction:** Replace permanent identity deletion with account deactivation, workspace/store access revocation, active-session revocation and retained historical identity evidence.
- **Regression evidence:** Controlled API contract and database-transaction acceptance required.
- **Status:** Open; next corrective item.

### M-001 — Shadowed legacy expense route still contains physical deletion

- **Severity:** Medium
- **Affected area:** Spare Parts expenses; legacy handler in `expenseRoutes.js`
- **Evidence:** The Phase 1 immutable void router currently shadows a later `DELETE FROM expenses` handler, but the physical-delete implementation remains in the repository and could become reachable after a future route-order change.
- **Business risk:** Latent bypass of the approved two-person void and linked-reversal ledger.
- **Correction:** Remove the legacy physical-delete handler and retain the Phase 1 void route as the only DELETE behaviour.
- **Regression evidence:** Source contract must prove `expenseRoutes.js` has no physical expense deletion and the reversal route retains the immutable controls.
- **Status:** Correction in progress with H-001.

### M-002 — Legacy request-time schema probes remain in audit routes

- **Severity:** Medium
- **Affected area:** Production runtime safety; audit sign-off route readiness helpers
- **Evidence:** The route still contains request-time `CREATE TABLE IF NOT EXISTS`, column and index readiness logic. The production database guard suppresses idempotent create-table probes and blocks actual runtime schema mutation.
- **Business risk:** Unnecessary request-time schema work, confusing readiness failures when an approved migration is incomplete, and ongoing dependence on compatibility behaviour.
- **Correction:** Replace request-time mutation helpers with read-only readiness checks after the immutable-evidence corrections are verified.
- **Regression evidence:** Production-mode DDL guard contract and disposable migrated-database route acceptance required.
- **Status:** Open.

## Required evidence checklist

- [x] Current repository and route map
- [ ] Backend syntax and complete test suite on final audit head
- [ ] Frontend source tests, lint and production build on final audit head
- [ ] Production dependency audits
- [ ] CodeQL security-extended analysis and reviewed SARIF policy
- [x] Full-history secret scan baseline
- [x] Migration-safety baseline
- [ ] Backup and restore control review
- [x] Production startup configuration review
- [ ] Role, permission and category-isolation review
- [ ] Financial formula and approval review
- [ ] Spare Parts workflow review
- [ ] Mining workflow review
- [ ] Equipment Sales & Hire workflow review
- [ ] Reports, PDF, export, workforce and signature review
- [ ] Desktop and mobile acceptance evidence
- [ ] README, in-app Help and release-document consistency review

## Finding format

Each finding must record:

- identifier;
- severity: Critical, High, Medium or Low;
- affected workspace and route/page;
- current evidence;
- business risk;
- proposed correction;
- regression evidence;
- resolution status.

## Release rule

This audit branch and its pull request must remain unmerged until all Critical and High findings are resolved, every changed path has focused regression evidence, permanent release gates pass on the unchanged reviewed head, and desktop/mobile acceptance is complete. No change from this audit may be promoted directly to `production`.
