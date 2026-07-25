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
| Production safety, migrations and disaster recovery | 15 | Critical correction required | — | M-002 resolved; C-001 open |
| Authentication, sessions and shared security | 12 | In review | — | H-002 resolved |
| Permissions, category and location isolation | 12 | In review | — | H-002 resolved |
| Monetary correctness and approvals | 14 | In review | — | H-001 resolved; M-001 resolved |
| Spare Parts correctness | 10 | In review | — | M-001 resolved; C-001 system-wide reset risk |
| Mining correctness | 10 | In review | — | H-002 access revocation verified; C-001 system-wide reset risk |
| Equipment Sales & Hire correctness | 12 | In review | — | H-002 access revocation verified; C-001 system-wide reset risk |
| Reports, documents, workforce and audit evidence | 7 | In review | — | H-001 resolved; H-002 resolved; M-002 resolved; C-001 audit records at risk |
| Mobile, usability and accessibility | 4 | In review | — | C-001 maintenance guidance review required |
| Testing, deployment and documentation | 4 | In review | — | C-001 missing transactional rollback evidence |
| **Total** | **100** | **In review** | **—** | Four resolved; one Critical open |

## Findings

### C-001 — System-wide clear operation can partially erase data despite rollback

- **Severity:** Critical
- **Affected area:** `DELETE /api/maintenance/clear-business-data`; `maintenanceRoutes.js`; `MaintenancePage.jsx`; all three business workspaces.
- **Evidence:** The clear route begins a transaction, then runs `TRUNCATE TABLE` for each business table and may run `ALTER TABLE ... AUTO_INCREMENT = 1` after a fallback `DELETE`. MySQL treats those schema operations as implicit-commit boundaries, so the catch block's rollback cannot guarantee restoration after a later failure. Production can also enable the operation by setting `ALLOW_CLEAR_BUSINESS_DATA=true`.
- **Business risk:** A failure midway through the system-wide operation can leave Spare Parts, Mining and Equipment Sales & Hire partially and irreversibly cleared while the API reports failure. Audit and activity evidence are among the first records removed.
- **Correction:** Permanently block the browser clear operation in production; require explicit opt-in in every non-production environment; replace `TRUNCATE` and `ALTER TABLE` with transaction-compatible `DELETE` operations only; preserve foreign-key reset in `finally`; fail closed on partial verification; update the interface to describe a non-production test reset rather than a live business reset.
- **Regression evidence:** Source contract, complete backend/frontend suites and disposable-MySQL failure-injection acceptance must prove rollback restores every table when a later delete fails and prove production always returns a blocked response regardless of the environment flag.
- **Status:** Open; immediate corrective priority.

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
- **Affected area:** Production runtime safety; Audit Sign-Off and re-approval schema readiness
- **Evidence:** The route previously contained request-time `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE` and index-creation logic. The clean schema also lacked seven evidence columns used by the Audit Sign-Off interface.
- **Business risk:** Production requests depended on compatibility suppression of runtime DDL and could fail when the approved schema was incomplete.
- **Correction:** Request-time mutation helpers were replaced with cached, read-only `information_schema` readiness checks that fail closed with `AUDIT_SCHEMA_NOT_READY`. The clean schema now contains the seven extended evidence columns. Additive migration `20260725_post_phase1_audit_signoff_readiness.sql` and its read-only verifier were added.
- **Regression evidence:** `auditSchemaReadiness.test.js`; all 397 backend tests passed; the migration applied successfully twice to a disposable legacy MySQL 8.4 schema; the verifier returned zero missing columns and zero missing indexes; production-mode readiness executed 12 read-only queries and zero runtime DDL statements. Artifact digest: `sha256:258f7014e16e34ac264573ea483592c3b7feec5ce5596de2bc645a9d5281be7e`.
- **Status:** Resolved in product commit `4dc7f03887cdcb44f9ec656cdd7dcbbf58672425`; permanent current-head gates pending.

## Required evidence checklist

- [x] Current repository and route map
- [ ] Backend syntax and complete test suite on final audit head
- [ ] Frontend source tests, lint and production build on final audit head
- [ ] Production dependency audits
- [ ] CodeQL security-extended analysis and reviewed SARIF policy
- [x] Full-history secret scan baseline
- [x] Migration-safety baseline
- [ ] Backup and restore control review — signed backup/restore reviewed; C-001 maintenance reset remains open
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
