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
| Production baseline recorded 25 July 2026 | `0cf526cdb50690fa70d712c958edceeb19f55e54` |
| Authentication | Password-only browser sign-in |
| SMS | Arkesel when deliberately enabled |
| WhatsApp receipts | Disabled until approved Meta configuration exists |

The baseline commit is historical evidence, not a permanent pointer. Before every release, verify the current `main` head, the `main → production` pull request, GitHub checks, Railway deployment and Cloudflare deployment.

### Approved release path

```text
agent/* or hotfix/*
        ↓ reviewed PR + green checks
main
        ↓ controlled production-promotion PR
production
        ↓ automatic deployment
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
7. A hidden frontend button is not security; the backend must independently reject unauthorized requests.
8. Every production migration must be additive, reviewed, backed up, locked and verified.
9. Every production release must pass the applicable backend, frontend, dependency, secret-scan and CodeQL gates.
10. When uncertain, stop a risky write rather than guess.

---

## 3. Business categories and boundaries

The platform contains three independent operating categories plus a separate Group Executive management shell.

### 3.1 Spare Parts — `spare_parts`

Spare Parts uses the original two-store branch model. The selected store controls:

- dashboard and store performance;
- products, suppliers and stock quantities;
- low-stock planning;
- purchases and supplier payments;
- New Sale and receipts;
- Cash, MoMo, Bank, Other, Credit and Mixed allocations;
- customers, debts and customer statements;
- returns, refunds and protected corrections;
- Request → Approve → Dispatch → Receive stock transfers;
- expenses and funding-source evidence;
- Daily Closing and independent verification;
- reports, exports and accounting intelligence;
- SMS, notifications and Activity Log evidence;
- category-scoped users, permissions and workers;
- employment documents and protected signature settings;
- security, backups and diagnostics.

**New Spare Parts installment sales are retired.** Historical records remain preserved for authorized review. Current installment sales belong only to Equipment Sales & Hire.

Spare Parts context headers:

```text
X-Chalin03-Branch-Id
X-Chalin03-Branch-Code
X-Chalin03-Branch-Name
```

### 3.2 Mining Operations — `mining`

Mining sites are created and managed by authorized Mining administrators. They are not Spare Parts stores.

Mining covers:

- site administration and staff/site access;
- daily and shift logs;
- production records;
- stockpiles and dispatch;
- equipment assignments, meters and operating hours;
- fuel receipts, issues, transfers and reconciliation;
- contractors and site expenses;
- safety, environmental, security and equipment incidents;
- corrective actions;
- site closing and management review;
- Mining reports, documents and shared controls;
- Mining workers, licences and private files;
- employment documents and protected signatures;
- notifications and audit evidence.

Mining context headers:

```text
X-Chalin03-Workspace: mining
X-Chalin03-Context-Id: <mining_site_id>
```

### 3.3 Equipment Sales & Hire — `equipment_hire`

Equipment locations, bases, yards and offices are created by authorized Equipment Sales & Hire administrators. They are not Spare Parts stores or Mining sites.

The workspace contains two connected commercial families that share one fleet catalogue.

#### Equipment Catalogue and Sales

- one registered asset identity per machine;
- secure equipment photographs and condition evidence;
- serial, chassis, engine, make, model, year and location;
- selling price and Hire rate;
- availability and sale locks;
- sales enquiries and quotations;
- approval-controlled sale agreements;
- equipment installment schedules and collections;
- deposits, payments, receipts and aging;
- delivery evidence and ownership conditions;
- sales documents, profit and management reports.

#### Equipment Hire

- customers and enquiries;
- availability and rate cards;
- quotations and approvals;
- contracts and amendments;
- mobilization, dispatch and job cards;
- work logs and billable time;
- Hire invoices, deposits and payments;
- returns, damage assessment and settlement;
- equipment release controls;
- maintenance, meters, fuel and service history;
- Hire reports and operational documents.

Equipment context headers:

```text
X-Chalin03-Workspace: equipment_hire
X-Chalin03-Context-Id: <hire_location_id>
```

### 3.4 Shared Fleet

Mining and Equipment Sales & Hire share the fleet catalogue. Register a machine once; do not create duplicate assets for the same physical equipment.

### 3.5 Group Executive Control

Group Executive is a separate management shell for authorized consolidated review. It provides:

- group performance and risk intelligence;
- notifications and escalation evidence;
- shared reports and controlled documents;
- read-only security, backup and workforce oversight;
- controlled group configuration.

It does not merge operational records or replace editing inside the correct business workspace.

---

## 4. Main frontend routes

### Public and authentication

| Route | Purpose |
|---|---|
| `/login` | Category, location and password sign-in |
| `/owner-recovery` | Protected original-owner recovery |
| `/mining-operations` | Mining workspace entry |
| `/equipment-hire` | Equipment Sales & Hire workspace entry |

### Spare Parts

Key routes include `/`, `/products`, `/new-sale`, `/sales-history`, `/debts`, `/purchases`, `/expenses`, `/returns`, `/daily-closing`, `/stock-transfers`, `/low-stock`, `/reports`, `/exports`, `/audit-accounting`, `/advanced-accounting-intelligence`, `/workers`, `/employment-documents`, `/document-signature-settings`, `/backup`, `/security-centre` and `/help`.

The legacy `/installments` route remains only for controlled retirement/compatibility behavior; it must not create new Spare Parts agreements.

### Mining

Key routes include `/mining`, `/mining/sites`, `/mining/daily-logs`, `/mining/production`, `/mining/equipment`, `/mining/fuel`, `/mining/expenses`, `/mining/incidents`, `/mining/control-centre`, `/mining/fleet`, `/mining/documents`, `/mining/workers`, `/mining/employment-documents`, `/mining/document-signature-settings`, `/mining/administration`, `/mining/notifications` and `/mining/help`.

### Equipment Sales & Hire

Key routes include `/equipment-hire-operations`, customer/enquiry/availability/quotation/contract/commercial/operations/finance/return/report routes, plus:

```text
/equipment-hire-operations/fleet
/equipment-hire-operations/fleet?view=sales
/equipment-hire-operations/fleet?view=reports
/equipment-hire-operations/fleet?view=maintenance
```

The workspace also contains documents, shared controls, workforce, employment documents, signature settings, administration, notifications and help.

---

## 5. Authentication, sessions and permissions

The backend validates every authenticated request using:

1. JWT signature;
2. active user record;
3. token version;
4. server-side session;
5. assigned category/workspace;
6. assigned store/site/location;
7. effective permissions;
8. protected-action evidence where required.

### Current sign-in policy

- Browser passkeys and biometric login are retired.
- Users sign in with their account password.
- Sessions expire at the earlier of eight hours after login or the next Ghana midnight boundary.
- Up to five controlled active sessions per account may coexist; older sessions are retired when the limit is exceeded.
- Password changes, administrator revocation, restoration or security actions may revoke sessions immediately.

### Permission principles

- Roles provide defaults.
- User-specific overrides may allow or deny.
- Explicit deny takes precedence.
- Overrides may expire.
- Sensitive changes require a reason and protected-action confirmation.
- Independent approval is required where self-approval would create a control weakness.
- Frontend guards improve usability; backend middleware is authoritative.
- The protected original System Administrator is the only account designed for cross-category administration and owner recovery.

When adding a permission-controlled feature, update all of these:

1. backend permission catalog;
2. role defaults;
3. backend middleware;
4. frontend permission rules;
5. navigation visibility;
6. route guard;
7. permission-manager label/grouping;
8. Activity Log or privileged ledger;
9. tests;
10. in-app Help and handbook documentation.

---

## 6. Monetary and operational invariants

### Sales and stock

- A valid sale changes stock exactly once.
- SMS or receipt-delivery failure must not roll back a valid sale.
- Completed sales are not silently rewritten.
- Corrections preserve original values, before/after evidence, reason, requester and approver.
- Direct quantity edits do not replace purchases, returns, transfers or adjustments.

### Stock transfers

```text
Request → Approve → Dispatch → Receive
```

Approval does not move stock. Dispatch reduces the source store; receipt increases the destination store. Repeated requests must not duplicate movement.

### Returns and refunds

A stock return and a financial refund are separate effects. Financial refunds require the exact amount, channel, reference where applicable, reason and approval. Approved refunds reduce the matching Daily Closing channel.

### Daily Closing

Expected physical cash includes real cash receipts and excludes cash expenses funded from the day's receipts and approved cash refunds. MoMo, Bank and Other channels reconcile separately.

Rules:

- counted values come from real counting, not copied expectations;
- variances are never forced to zero;
- explanations are preserved;
- denomination totals must agree with submitted cash when used;
- a submitter cannot independently verify the same closing;
- later changes preserve prior versions;
- externally funded expenses remain expenses but do not reduce the day's drawer/channel balance.

### Debts and payments

- customer balances and payment ledgers must reconcile;
- a payment is recorded once;
- payment allocations cannot exceed money received;
- customer statements show history rather than rewriting old transactions.

### Equipment sales and installments

- an equipment sale agreement comes from approved terms;
- deposits and payments are allocated exactly once;
- outstanding balance equals agreement value less valid allocations;
- delivery and ownership controls follow the agreement;
- sale locks prevent incompatible Hire assignment;
- rescheduling and amendments preserve the original schedule and approval evidence.

### Mining reconciliation

- production, stockpile movement, dispatch and closing quantities reconcile by site, date, material and unit;
- fuel receipts, issues and balance reconcile by site and tank;
- machine meters and hours remain physically plausible;
- incidents and corrective actions preserve the original report.

---

## 7. Workforce, documents and signatures

Worker profiles are category-isolated and may include:

- personal and employment details;
- workspace/location assignments;
- licences and expiry dates;
- private documents;
- issued property;
- worker photographs;
- staff ID cards and QR verification;
- correspondence and employment documents.

Employment documents may be prepared for a candidate before a worker profile exists, then linked later after onboarding.

The boss signature settings page supports mouse, stylus and one-finger drawing, pen-weight control, undo/redo, clear, alignment guides, larger signing mode, transparent whitespace trimming and exact cleaned preview. Approved documents preserve an immutable signature snapshot; later signature changes do not rewrite historical PDFs.

---

## 8. Backup, restore and disaster recovery

Production uses signed `chalin03-full-system-v2` backups.

A valid backup includes:

- durable-table inventory;
- table/column and migration manifest;
- row counts and checksums;
- HMAC signature using `BACKUP_SIGNING_SECRET`;
- compatibility validation before destructive restore work.

Production protections:

- browser restore is disabled;
- incomplete, altered or wrong-server backups are rejected;
- restore verifies row counts before completion;
- sessions, OTPs, recovery sessions and protected-action credentials are invalidated after restore;
- user token versions are advanced so old tokens cannot continue;
- recovery evidence is recorded.

A disposable MySQL 8.4 recovery drill passed before Phase 0 was promoted. The current operating rule is still: download and privately store regular signed backups, and verify one before any production migration.

Legacy Version 1 backups remain private emergency evidence but do not meet the signed Version 2 restore contract.

---

## 9. Production hosting and security configuration

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

`DB_SSL_REJECT_UNAUTHORIZED=false` is accepted only for the effective Railway private MySQL host ending in `.railway.internal`. External/public MySQL hosts must retain certificate verification or use an explicit trusted CA through `DB_SSL_CA_BASE64`.

Production secrets must be strong, unique and different:

- `JWT_SECRET`;
- `ACCOUNT_RECOVERY_OTP_SECRET`;
- `CLOUDFLARE_ORIGIN_SECRET`;
- `OWNER_MFA_ENCRYPTION_KEY`;
- `BACKUP_SIGNING_SECRET`.

Never place those values in GitHub, frontend code, Google Docs, screenshots or chat.

### Cloudflare

- Pages production branch: `production`.
- `api.chalin03.com` must remain proxied through Cloudflare.
- Cloudflare injects `x-chalin-origin-key` using the same private value as Railway's `CLOUDFLARE_ORIGIN_SECRET`.
- The origin secret must never be exposed as a frontend variable.
- Direct public Railway hostnames must not be added to `TRUSTED_API_HOSTS`.

---

## 10. Repository structure and sources of truth

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
| Permission overrides | `backend/services/permissionOverrideService.js` |
| Session policy | `backend/services/accountSessionService.js` |
| System Administrator identity | `backend/security/systemAdminIdentity.js` |
| Frontend API client | `frontend/src/api/axiosClient.js` |
| Frontend auth state | `frontend/src/context/AuthContext.jsx` |
| Mining/Hire context | `frontend/src/context/WorkspaceContext.jsx` |
| Fresh local schema | `database/schema.sql` |
| Production migrations | `database/migrations/` and controlled migration services |
| Backup and restore | `backend/routes/backupRoutes.js` |
| Standard verification | `.github/workflows/chalin03-verification.yml` |
| Final security audit | `.github/workflows/version-3-final-audit.yml` |
| Production smoke | `.github/workflows/version-3-production-smoke.yml` |
| Release control | `docs/PRODUCTION_RELEASE_CONTROL.md` |
| Documentation/audit standard | `docs/SYSTEM_GUIDE_AND_AUDIT_STANDARD.md` |

When code and documentation disagree, investigate the live behavior and update both. Do not silently choose whichever text is more convenient.

---

## 11. Local development

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

Typical local services:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:5000
Database: local MySQL development schema
```

Use development-only values locally. Never copy production secrets into source files.

---

## 12. Required release checks

Before merging a normal change to `main`:

- backend syntax check;
- complete backend tests;
- frontend source tests;
- frontend lint;
- production frontend build;
- production dependency audit;
- repository secret/environment checks;
- full-history secret scan when triggered;
- CodeQL security-extended analysis;
- migration/recovery drill when database or backup contracts change;
- desktop and mobile checks for affected pages.

Before promoting `main` to `production`:

1. all feature PR checks are green;
2. the promotion PR is exactly `main → production`;
3. production-origin gate passes;
4. backend/frontend/dependency/secret/CodeQL gates pass again;
5. required Railway and Cloudflare configuration is already present;
6. a recent signed backup exists;
7. rollback target is known;
8. post-deployment smoke checks cover affected categories.

---

## 13. Help and handbook maintenance

Every feature or control change must update:

- the relevant in-app help page;
- this README when architecture, deployment or operating rules change;
- the Chalin 03 Google Docs handbook master index;
- the affected workspace/page guide;
- the affected daily procedure;
- security, backup, deployment, testing, training, roadmap or handover documents when relevant.

Documentation must distinguish current rules from historical release evidence. Old commit hashes may remain in release history, but they must not be presented as the current production source.

---

## 14. Full-system scoring standard

After documentation is synchronized, score the system using evidence rather than impressions.

| Area | Weight |
|---|---:|
| Production safety, migrations and disaster recovery | 15 |
| Authentication, sessions and shared security | 12 |
| Permissions, category and location isolation | 12 |
| Monetary correctness and approvals | 14 |
| Spare Parts correctness | 10 |
| Mining correctness | 10 |
| Equipment Sales & Hire correctness | 12 |
| Reports, documents, workforce and audit evidence | 7 |
| Mobile, usability and accessibility | 4 |
| Testing, deployment and documentation | 4 |
| **Total** | **100** |

A score requires:

- repository inspection;
- current automated checks;
- read-only architecture and permission review;
- financial invariant review;
- desktop/mobile acceptance evidence;
- production configuration and recovery evidence;
- documented findings with severity and remediation.

A working screen alone is not proof of correctness. A failing or missing evidence area cannot receive full marks merely because no worker has reported a problem.

---

## 15. Current release status and planned next step

As of the recorded 25 July 2026 baseline:

- Phase 0 production-safety hardening is complete;
- signed Version 2 backup/recovery controls are active;
- production deploys only from `production`;
- Railway MySQL connects through encrypted private-network TLS;
- the live system is operating without reported worker defects;
- a fresh signed production backup has been downloaded and stored privately;
- in-app help and the handbook are being synchronized before the next audit.

The next controlled programme is a full-system evidence review and rescoring. New feature families should wait until that review identifies and prioritizes any remaining correctness, permission, usability or documentation gaps.

---

## 16. Change checklist

Before coding:

- [ ] Start from current `main`.
- [ ] Use an isolated branch.
- [ ] Identify the affected category and location boundary.
- [ ] Trace frontend → API → middleware → transaction → audit effects.
- [ ] Check migrations, backups, permissions, financial formulas, documents, mobile layout and PWA caching.

Before merge:

- [ ] Update tests.
- [ ] Update in-app Help.
- [ ] Update README/handbook where applicable.
- [ ] Run backend checks.
- [ ] Run frontend tests, lint and build.
- [ ] Review the diff for unrelated changes and secrets.
- [ ] Keep the PR unmerged until required gates are green.

Before production:

- [ ] Promote only `main → production`.
- [ ] Confirm current signed backup.
- [ ] Confirm Railway and Cloudflare production configuration.
- [ ] Record rollback target.
- [ ] Verify deployment logs and `/api/health`.
- [ ] Smoke-test affected workspaces on desktop and mobile.
- [ ] Record release and update affected documentation.
