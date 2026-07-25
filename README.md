# Chalin 03 Group Operations Platform

**Version Three · v3.0.0**

Production business-control system for **Chalin 03 Company Limited**, prepared by **Eugene Amankwah Appiah**.

> **LIVE PRODUCTION WARNING**
>
> This repository controls a working business platform with real sales, stock, debts, payments, accounting, workers, Mining operations and Equipment Sales & Hire records. Code can be restored from GitHub; lost production records may not be reconstructable. Read this document before changing code or configuration.

---

## 1. Current production state

| Component | Current production value |
|---|---|
| Primary frontend | `https://chalin03.com` |
| Alternate frontend | `https://www.chalin03.com` |
| Backend API | `https://api.chalin03.com/api` |
| Frontend hosting | Cloudflare Pages |
| Backend hosting | Railway |
| Database | Railway MySQL |
| Live deployment branch | `production` |
| Integration branch | `main` |
| Work branches | `agent/*` or approved `hotfix/*` |
| Release | Version Three · v3.0.0 |
| Production release deployed 25 July 2026 | `84c554e157c9439de12b12a65438ea440c79acc0` |
| Integrated release candidate | `d71c3f1245d53fc6c636dbb6ef52ee3eaca69d2a` |
| Automated audit | `95 / 100`; 0 Critical and 0 High findings open |
| Production migrations | Financial-control hardening and Audit Sign-Off readiness applied and verified |
| Authentication | Password-only browser sign-in |
| SMS | Arkesel when deliberately enabled |
| WhatsApp receipts | Disabled until approved Meta configuration exists |

The current production release was promoted through PR #76 after PR #75 completed the post-Phase-1 audit and PR #77 added the fail-closed Railway migration runner. Commit hashes above are release evidence, not permanent pointers.

### Approved release path

```text
agent/* or hotfix/*
        ↓ reviewed PR + green checks
main
        ↓ controlled production-promotion PR
production
        ↓ deployment
Railway backend + Cloudflare frontend
```

Railway and Cloudflare must watch **only `production`**. Never point either service to `main`.

---

## 2. Non-negotiable safety rules

1. Never run `database/schema.sql` against Railway production. It is a fresh-install/reset schema.
2. Never drop, truncate, reset or mass-update production tables to repair a normal application error.
3. Never expose `.env`, database credentials, JWT secrets, OTP secrets, SMS keys, customer data, worker files or backup contents.
4. Never rewrite completed sales, payments, closings, approvals, signatures or audit history to make a report look correct.
5. Never change a monetary formula merely to force an expected result.
6. Never mix Spare Parts stores, Mining sites and Equipment Sales & Hire locations.
7. A hidden frontend button is not security; the backend must independently reject unauthorised requests.
8. Every production migration must be additive, reviewed, backed up, locked and verified.
9. Every production release must pass the applicable backend, frontend, dependency, secret-scan and CodeQL gates.
10. When uncertain, stop a risky write rather than guess.

---

## 3. Business categories and boundaries

### Spare Parts — `spare_parts`

Spare Parts uses the original two-store branch model. The selected store controls products, stock, suppliers, purchases, sales, receipts, customers, debts, returns, transfers, expenses, Daily Closing, reports, exports, SMS, users, workers, documents, signatures, backups and audit evidence.

New Spare Parts installment sales are retired. Historical records remain preserved for authorised review. Current installment sales belong only to Equipment Sales & Hire.

Context headers:

```text
X-Chalin03-Branch-Id
X-Chalin03-Branch-Code
X-Chalin03-Branch-Name
```

### Mining Operations — `mining`

Mining sites are created and managed by authorised Mining administrators. They are not Spare Parts stores. Mining includes site administration, daily logs, production, stockpiles, dispatch, equipment, fuel, contractors, expenses, incidents, corrective actions, site closing, reports, documents, workers, signatures, notifications and audit evidence.

Context headers:

```text
X-Chalin03-Workspace: mining
X-Chalin03-Context-Id: <mining_site_id>
```

### Equipment Sales & Hire — `equipment_hire`

Equipment locations, bases, yards and offices are created by authorised Equipment Sales & Hire administrators. They are not Spare Parts stores or Mining sites.

The workspace covers one shared equipment catalogue, equipment sales, enquiries, quotations, sale agreements, installment schedules, deposits, payments, delivery, Hire availability, quotations, contracts, mobilization, work logs, invoices, returns, damage, maintenance, meters, fuel, reports, documents, workers and audit evidence.

Context headers:

```text
X-Chalin03-Workspace: equipment_hire
X-Chalin03-Context-Id: <hire_location_id>
```

Mining and Equipment Sales & Hire share the fleet catalogue. Register a physical machine once.

### Group Executive Control

Group Executive is a separate authorised management shell for consolidated performance, risk, notifications, reports, documents, security, backup and workforce oversight. It does not merge operational records or replace editing inside the correct workspace.

---

## 4. Current control model

### Authentication and sessions

Every authenticated request checks JWT signature, active user state, token version, server session, assigned workspace, assigned store/site/location, effective permissions and protected-action evidence where required.

- Browser passkeys and biometric sign-in are retired.
- Users sign in with account passwords.
- Sessions expire at the earlier of eight hours after login or the next Ghana midnight boundary.
- Password changes, administrator revocation, restoration and security actions can revoke sessions immediately.

### User administration

Permanent account deletion is not part of the normal system.

- **Temporary Disable** stops access while preserving assignments for controlled reactivation.
- **Secure Offboard** revokes sessions, token state, branch/workspace/site/location access and active permission overrides while preserving the user identity on historical financial and audit records.

### Audit Sign-Off evidence

Audit Sign-Off records are permanent compliance evidence. The backend blocks physical deletion and the archive does not expose a normal Delete action.

### Expenses and corrections

The legacy physical expense-deletion route was removed. Corrections use the approved immutable void-and-reversal process with reason, requester, independent approver and linked negative reversal evidence.

### Maintenance reset

The system-wide test-data reset is permanently blocked in production. Explicitly enabled non-production reset uses transaction-compatible deletion, verifies zero counts before commit, restores foreign-key checks and rolls back safely on failure.

---

## 5. Monetary and operational invariants

- A valid sale changes stock exactly once.
- Completed sales, payments, closings, approvals and signatures are not silently rewritten.
- Corrections preserve original values, before/after evidence, reason, requester and approver.
- Stock transfer flow is `Request → Approve → Dispatch → Receive`.
- Approval does not move stock; dispatch and receipt perform the physical movements.
- Stock returns and financial refunds are separate effects.
- Daily Closing reconciles Cash, MoMo, Bank and Other independently.
- A submitter cannot independently verify the same closing.
- Debt payments and allocations cannot exceed money received.
- Equipment sale locks prevent incompatible Hire assignment.
- Mining production, stockpile, dispatch, fuel and machine-meter records must remain physically reconcilable.

---

## 6. Workforce, documents and signatures

Worker records are category-isolated and may include personal details, workspace assignments, licences, private files, issued property, photographs, ID cards, correspondence and employment documents.

Employment documents may be prepared before a worker profile exists and linked after onboarding.

Approved documents preserve an immutable signature snapshot. Later signature-setting changes do not rewrite historical PDFs.

---

## 7. Backup, restore and disaster recovery

Production uses signed `chalin03-full-system-v2` backups.

A valid backup includes durable-table inventory, schema/migration manifest, row counts, checksums, HMAC signature and compatibility validation.

Production protections:

- browser restore is disabled;
- altered, incomplete or wrong-server backups are rejected;
- restore verifies row counts before completion;
- sessions and temporary security credentials are invalidated after restore;
- token versions advance so old tokens cannot continue;
- recovery evidence is recorded.

Download and privately retain a fresh signed backup before every production migration. Legacy Version 1 backups are emergency evidence only and do not meet the signed Version 2 restore contract.

---

## 8. Production hosting and security

### Railway

Required production posture includes:

```text
NODE_ENV=production
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
TRUSTED_API_HOSTS=api.chalin03.com
ENFORCE_TRUSTED_API_HOSTS=true
ENFORCE_PRODUCTION_SECURITY_SECRETS=true
ALLOW_WEB_RESTORE=false
```

`DB_SSL_REJECT_UNAUTHORIZED=false` is accepted only for the effective Railway private MySQL host ending in `.railway.internal`.

Production secrets must be strong, unique and different. Never place them in GitHub, frontend code, Google Docs, screenshots or chat.

### Controlled Railway migration runner

The approved 25 July 2026 release used this backend Pre-deploy Command:

```text
npm run migrate:production
```

Canonical runner: `backend/scripts/runProductionMigrations.js`.

The runner requires production mode, explicit migration enablement, signed-backup confirmation and an exact release confirmation. It connects using Railway DB/MYSQL variables, acquires a MySQL advisory lock, applies only the approved financial-control and Audit Sign-Off migrations, runs both read-only verifiers and exits non-zero when any check fails.

The runner is release-specific. After retaining successful deployment evidence, remove its one-release Pre-deploy Command or disable the confirmation variable before an unrelated deployment. A later migration set requires a new reviewed plan and exact release confirmation.

### Cloudflare

- Pages production branch: `production`.
- `api.chalin03.com` remains proxied through Cloudflare.
- Cloudflare injects the origin header using the same private value as Railway's `CLOUDFLARE_ORIGIN_SECRET`.
- The origin secret must never be exposed as a frontend variable.

---

## 9. Sources of truth

| Purpose | Canonical location |
|---|---|
| Backend registration and middleware order | `backend/server.js` |
| Frontend route tree | `frontend/src/App.jsx` |
| Spare Parts help | `frontend/src/pages/HelpPage.jsx` |
| Mining and Equipment help | `frontend/src/pages/WorkspaceHelpPage.jsx` |
| Workspace navigation | `frontend/src/layouts/` |
| Authentication middleware | `backend/middleware/authMiddleware.js` |
| Category isolation | `backend/services/categoryIsolationService.js` |
| Permission catalog | `backend/security/permissionCatalog.js` |
| Session policy | `backend/services/accountSessionService.js` |
| Fresh local schema | `database/schema.sql` |
| Production migrations | `database/migrations/` |
| Railway migration runner | `backend/scripts/runProductionMigrations.js` |
| Backup and restore | `backend/routes/backupRoutes.js` |
| Standard verification | `.github/workflows/chalin03-verification.yml` |
| Final security audit | `.github/workflows/version-3-final-audit.yml` |
| Release control | `docs/PRODUCTION_RELEASE_CONTROL.md` |
| Post-Phase-1 audit | `docs/POST_PHASE1_FULL_SYSTEM_AUDIT.md` |
| 25 July 2026 release record | `docs/RELEASE_2026-07-25_PHASE1_POST_PHASE1.md` |
| Documentation standard | `docs/SYSTEM_GUIDE_AND_AUDIT_STANDARD.md` |

When code and documentation disagree, investigate the live behaviour and update both.

---

## 10. Local development

### Backend

```powershell
cd C:\Users\DDK\Desktop\chalin03-system\backend
npm ci
npm run syntax-check
npm test
npm run dev
```

### Frontend

```powershell
cd C:\Users\DDK\Desktop\chalin03-system\frontend
npm ci
npm test
npm run lint
npm run build
npm run dev
```

Use development-only values locally. Never copy production secrets into source files.

---

## 11. Required release checks

Before merging to `main`:

- backend syntax and complete tests;
- frontend tests, lint and production build;
- dependency audit;
- repository and full-history secret checks;
- CodeQL security-extended analysis;
- migration/recovery evidence when database or backup contracts change;
- desktop/mobile and role/workspace checks for affected pages;
- relevant README, help and handbook updates.

Before promoting `main` to `production`:

1. use an exact `main → production` pull request;
2. pass production-origin and security gates;
3. confirm Railway and Cloudflare configuration;
4. retain a fresh signed backup;
5. know the rollback target;
6. apply and verify approved additive migrations before the new backend starts;
7. verify deployment logs, `/api/health`, authentication and affected business journeys;
8. record the release commit and recovery point.

---

## 12. Current release status

As of the completed 25 July 2026 release:

- post-Phase-1 automated audit: **95 / 100**;
- open Critical findings: **0**;
- open High findings: **0**;
- PR #75 merged the audit corrections into `main`;
- PR #77 added the Railway production migration runner;
- a fresh signed Version 2 backup was downloaded before migration;
- both approved migrations were applied and verified before deployment;
- PR #76 promoted the release to `production`;
- Railway reported successful backend deployment;
- the authorised owner reported the live system and new features successful;
- existing production business data remained available;
- production release commit: `84c554e157c9439de12b12a65438ea440c79acc0`.

The next step is normal monitored operation. Preserve the backup and deployment logs, record any defect before changing code, and use `agent/* → main → production` for every future update.

---

## 13. Documentation maintenance

Every feature or control change must update the relevant in-app Help page, this README, the repository release/audit documents and the external Chalin 03 handbook where applicable.

Repository documentation is synchronized with the 25 July 2026 deployed release. The external Google Docs handbook still requires a separate consistency update and evidence check.
