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
| Production safety, migrations and disaster recovery | 15 | In review | — | M-002 open |
| Authentication, sessions and shared security | 12 | In review | — | H-002 resolved |
| Permissions, category and location isolation | 12 | In review | — | H-002 resolved |
| Monetary correctness and approvals | 14 | In review | — | H-001 resolved; M-001 resolved |
| Spare Parts correctness | 10 | In review | — | M-001 resolved |
| Mining correctness | 10 | In review | — | H-002 access revocation verified |
| Equipment Sales & Hire correctness | 12 | In review | — | H-002 access revocation verified |
| Reports, documents, workforce and audit evidence | 7 | In review | — | H-001 resolved; H-002 resolved |
| Mobile, usability and accessibility | 4 | In review | — | — |
| Testing, deployment and documentation | 4 | In review | — | — |
| **Total** | **100** | **In review** | **—** | Three resolved; one open |

## Findings

### H-001 — Audit sign-offs can be physically deleted

- **Severity:** High
- **Affected area:** Spare Parts audit archive; `DELETE /api/audit-signoffs/:id`; `AuditSignoffHistoryPage.jsx`
- **Evidence:** The prior backend physically deleted the `audit_signoffs` row and the compliance archive exposed a normal Delete button.
- **Business risk:** An approved accounting-period sign-off could lose its primary approval record. An activity-log sentence is not an adequate replacement for the deleted sign-off, certificate and linked audit evidence.
- **Correction:** Audit sign-offs are now permanent. The legacy DELETE endpoint logs `BLOCK_DELETE_AUDIT_SIGNOFF` and returns `AUDIT_SIGNOFF_IMMUTABLE`; the archive Delete action was removed and replaced with a `Permanent evidence` marker and controlled correction guidance.
- **Regression evidence:** `auditSignoffExpenseImmutability.test.js`; complete backend suite; frontend source tests, targeted lint and production build passed against the exact corrected files.
- **Status:** Resolved; permanent current-head gates pending.

### H-002 — Permanent user deletion destroys historical attribution

- **Severity:** High
- **Affected area:** Shared user administration; `DELETE /api/users/:id`; `UsersSettingsPage.jsx`
- **Evidence:** The previous implementation cleared user references from financial, closing, approval and activity records before deleting the user identity.
- **Business risk:** Financial and security records lost reliable attribution of who recorded, approved, closed, reviewed or performed an action.
- **Correction:** Permanent deletion was replaced with temporary Disable and controlled Secure Offboard actions. Temporary Disable revokes active sessions while retaining assigned access for controlled reactivation. Secure Offboard retains the user identity and every historical reference while revoking sessions, token state, branch access, workspace access, Mining-site access, Hire-location access and active permission overrides.
- **Regression evidence:** `userIdentityPreservation.test.js`; all 395 backend tests passed; frontend source tests, targeted lint and production build passed; disposable MySQL 8.4 acceptance retained the user ID on historical sale `staff_id`, sale `approved_by` and `activity_log.user_id`, incremented token version from 4 to 5, revoked two sessions, revoked one row in each of the four access tables and revoked the active permission override. Artifact digest: `sha256:67b5a2c38a432b9ef06433271271fc27e812c5a6cbd73871636696f482e2e894`.
- **Status:** Resolved in product commit `8fbd54638b16a18fbd913efb6640c3e976fb3a7e`; permanent current-head gates pending.

### M-001 — Shadowed legacy expense route still contains physical deletion

- **Severity:** Medium
- **Affected area:** Spare Parts expenses; legacy handler in `expenseRoutes.js`
- **Evidence:** The Phase 1 immutable void router shadowed a later `DELETE FROM expenses` handler, but the physical-delete implementation remained in the repository and could become reachable after a future route-order change.
- **Business risk:** Latent bypass of the approved two-person void and linked-reversal ledger.
- **Correction:** The legacy physical-delete handler was removed. `expenseReversalRoutes.js` remains the only DELETE behaviour, and the older operations-route contract was updated so it no longer requires the deleted legacy boundary.
- **Regression evidence:** `auditSignoffExpenseImmutability.test.js`; updated `operationsRouteReleaseContract.test.js`; complete backend suite passed against the exact corrected files.
- **Status:** Resolved; permanent current-head gates pending.

### M-002 — Legacy request-time schema probes remain in audit routes

- **Severity:** Medium
- **Affected area:** Production runtime safety; audit sign-off route readiness helpers
- **Evidence:** The route still contains request-time `CREATE TABLE IF NOT EXISTS`, column and index readiness logic. The production database guard suppresses idempotent create-table probes and blocks actual runtime schema mutation.
- **Business risk:** Unnecessary request-time schema work, confusing readiness failures when an approved migration is incomplete, and ongoing dependence on compatibility behaviour.
- **Correction:** Replace request-time mutation helpers with read-only readiness checks after the immutable-evidence corrections are verified.
- **Regression evidence:** Production-mode DDL guard contract and disposable migrated-database route acceptance required.
- **Status:** Open; next corrective item.

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
