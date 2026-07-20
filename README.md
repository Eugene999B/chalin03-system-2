# Chalin 03 Group Operations Platform

**Version Three · v3.0.0**

Production business-control platform for **Chalin 03 Company Limited**, prepared by **Eugene Amankwah Appiah**.

> **AI AGENT ENTRYPOINT**
>
> This repository controls a live business system with real sales, stock, debts, payments, accounting, staff and operational records. Read this README before changing code. Production data is more valuable than source code because code can be restored from GitHub, while lost business records may not be reconstructable.

---

## 1. Production Environment

| Component | Production value |
|---|---|
| Primary frontend | `https://chalin03.com` |
| Alternate frontend | `https://www.chalin03.com` |
| Backend API | `https://api.chalin03.com/api` |
| Frontend hosting | Cloudflare Pages |
| Backend hosting | Railway |
| Database | Railway MySQL |
| Production branch | `main` |
| Current release | `Version Three · v3.0.0` |
| Supported backend runtime | Node.js 20+; CI uses Node.js 24 |
| SMS | Arkesel when deliberately enabled; `mock` for development |
| WhatsApp receipts | Keep disabled until approved Meta setup exists |

`main` deploys automatically. Never merge an unverified change into `main`.

The exact production commit changes over time. Before a release task, verify current `main`, open pull requests, workflow status, Railway deployment and Cloudflare deployment instead of trusting an old hash in documentation.

---

## 2. Non-Negotiable Safety Rules

### Production data

1. **Never run `database/schema.sql` against Railway production.** It is a fresh-install/reset schema.
2. Never drop, truncate, reset or mass-update production tables to repair a normal application error.
3. Production database changes must be additive, reviewed, backed up and verified.
4. Confirm a current full-system backup before every production migration.
5. Never expose `.env`, database credentials, JWT secrets, SMS keys, customer data, staff data or backup contents.
6. Never silently rewrite historical audit, closing, approval, payment, signature, sale or stock evidence.
7. Never change a financial formula merely to make figures match an expectation.
8. Never mix Spare Parts stores with Mining sites or Equipment Hire locations.
9. Never bypass backend authentication, category isolation, permissions or protected-action controls.
10. A hidden frontend button is not security. The API must reject unauthorized requests independently.

### Change management

1. Start from current `main`.
2. Use an isolated branch such as `agent/clear-change-name`.
3. Make the smallest coherent change.
4. Do not combine unrelated refactors with a production fix.
5. Add or update tests for changed behavior, permissions, schema or security.
6. Run all required verification gates before merge.
7. Use a pull request; do not push feature work directly to `main`.
8. Verify deployment and smoke-test the affected workspace after merge.
9. Preserve backward compatibility for existing records unless an approved migration explicitly changes it.
10. When uncertain, stop a risky write rather than guess.

---

## 3. First 15 Minutes for a New AI Agent

Before proposing code:

1. Read this README completely.
2. Inspect repository state:

   ```bash
   git status -sb
   git branch --show-current
   git log --oneline -10
   ```

3. Confirm the application version in:
   - `backend/config/version.js`
   - `frontend/src/config/appVersion.js`
   - `backend/package.json`
   - `frontend/package.json`
4. Read the main control files:
   - `backend/server.js`
   - `frontend/src/App.jsx`
   - `backend/middleware/authMiddleware.js`
   - `backend/security/permissionCatalog.js`
   - `frontend/src/security/permissionRules.js`
5. Identify the exact workspace affected: Spare Parts, Mining or Equipment Hire.
6. Trace the complete request path:

   ```text
   UI page/component
     → shared Axios client and workspace headers
     → backend route registration
     → authentication/category/permission middleware
     → route/service logic
     → database transaction
     → audit/notification/backup effects
     → API response and frontend state
   ```

7. Read the closest backend and frontend tests before editing.
8. Decide whether the change affects:
   - database migrations,
   - backup/restore coverage,
   - permissions,
   - activity/audit evidence,
   - PWA caching,
   - PDFs or exports,
   - mobile layout,
   - deployment configuration.
9. State scope and production risk before writing code.
10. Do not claim completion until all applicable checks pass.

---

## 4. Sources of Truth

When code and documentation disagree, investigate and update both. Use this order:

1. Current schema plus applied additive migrations.
2. Backend route, middleware and service behavior.
3. Backend tests.
4. Frontend routes, guards, contexts and pages.
5. Frontend source tests.
6. CI workflows.
7. This README and in-app Help.

| Purpose | Canonical location |
|---|---|
| Backend route registration and middleware order | `backend/server.js` |
| Frontend route tree and workspace shells | `frontend/src/App.jsx` |
| Authentication and current identity refresh | `backend/middleware/authMiddleware.js` |
| Workspace/category isolation | `backend/services/categoryIsolationService.js` |
| Permission catalog | `backend/security/permissionCatalog.js` |
| Effective permission overrides | `backend/services/permissionOverrideService.js` |
| Session validation and revocation | `backend/services/accountSessionService.js` |
| Original System Administrator identity | `backend/security/systemAdminIdentity.js` |
| Frontend API headers and 401 handling | `frontend/src/api/axiosClient.js` |
| Frontend authentication state | `frontend/src/context/AuthContext.jsx` |
| Active Mining/Hire context | `frontend/src/context/WorkspaceContext.jsx` |
| Frontend permission mappings | `frontend/src/security/permissionRules.js` |
| Fresh local database | `database/schema.sql` |
| Fresh-schema verification | `database/schema_verify.sql` |
| Production-safe database evolution | `database/migrations/` and reviewed legacy migration files in `database/` |
| Full-system backup order and manifest | `backend/routes/backupRoutes.js` |
| Normal verification pipeline | `.github/workflows/chalin03-verification.yml` |
| Security release audit | `.github/workflows/version-3-final-audit.yml` |
| Live production smoke checks | `.github/workflows/version-3-production-smoke.yml` |
| Cloudflare response headers | `frontend/public/_headers` |
| PWA service worker | `frontend/public/sw.js` |

---

## 5. Architecture and Stack

```text
Browser / installed PWA
  → React + Vite frontend on Cloudflare Pages
  → Axios client with Bearer token and workspace/context headers
  → https://api.chalin03.com/api
  → Express request context, security headers, CORS and rate limits
  → JWT, token-version and server-side session validation
  → workspace/category isolation
  → role, effective permission and delegated-authority checks
  → route/service business logic
  → Railway MySQL
  → audit evidence, notifications, reports and exports
  → optional Arkesel SMS
```

### Frontend

- React 19
- Vite 8
- React Router 7
- Axios
- CSS
- PWA/service worker
- ESLint and React Hooks rules

### Backend

- Node.js
- Express 4
- MySQL through `mysql2`
- JWT authentication
- bcrypt password hashing
- server-side sessions and token versioning
- Helmet security headers
- Express rate limiting
- PDFKit
- ExcelJS
- Sharp
- QR code generation
- Arkesel integration

---

## 6. Workspace Boundaries

Workspace separation is a security and accounting boundary, not only a layout choice.

### Spare Parts — `spare_parts`

Spare Parts uses the original branch/store model with two operational stores. Store context controls:

- products and quantity,
- sales and receipts,
- installment sales,
- customers and debts,
- purchases and suppliers,
- expenses,
- returns and refunds,
- Daily Closing,
- reports and exports,
- adjustments and transfers,
- SMS,
- activity-log scope.

The shared Axios client sends Spare Parts branch headers only for this workspace:

- `X-Chalin03-Branch-Id`
- `X-Chalin03-Branch-Code`
- `X-Chalin03-Branch-Name`

Always confirm the active store before saving or testing a transaction.

### Mining Operations — `mining`

Mining sites are administrator-created and are not Spare Parts stores. Mining covers sites, daily logs, production, stockpiles, dispatch, equipment, fuel, contractors, shift crews, expenses, incidents, closings, workers, reports and shared Fleet.

The active site is sent through:

- `X-Chalin03-Workspace: mining`
- `X-Chalin03-Context-Id: <mining_site_id>`

### Equipment Hire — `equipment_hire`

Hire locations, yards and bases are administrator-created and independent from Spare Parts. Hire covers customers, enquiries, availability, quotations, contracts, amendments, dispatch, work logs, invoices, deposits, payments, approvals, evidence, damage assessment, returns, workers, reports and shared Fleet.

The active Hire location is sent through:

- `X-Chalin03-Workspace: equipment_hire`
- `X-Chalin03-Context-Id: <hire_location_id>`

### Shared Fleet

Fleet is shared only between Mining and Equipment Hire. A machine should be registered once. Do not create duplicate assets for the same machine in different workspaces.

### Group Executive Control

Group Executive is a separate management shell for consolidated intelligence. It does not replace operational editing in the business workspaces.

---

## 7. Authentication and Authorization

The browser currently stores the bearer token, user record and active Mining/Hire context identifiers. The backend does not trust stale token claims alone. Each authenticated request validates:

1. JWT signature.
2. Current active user record.
3. Token version.
4. Workspace/category access.
5. Active server-side session.
6. Current effective permissions.

A new login may revoke the previous active session. Account and permission changes may revoke sessions immediately.

A protected action may require several layers together:

```text
requireAuth
  + workspace/category boundary
  + role or effective permission
  + branch/site/location access
  + protected-action password/token window
  + independent approver
```

Do not remove one layer because another exists.

### Permission model

- Role permissions are defaults.
- Per-user overrides may explicitly allow or deny.
- Explicit deny takes precedence.
- Overrides may expire.
- Sensitive changes require reason and protected-action evidence.
- Changes must be recorded in the Activity Log or privileged ledger.
- Frontend guards improve UX; backend middleware is authoritative.
- The original System Administrator retains protected recovery and cross-category authority.
- Category administrators must not silently gain cross-category control.

When adding a permission-controlled feature, review all of these:

1. Backend catalog.
2. Role defaults.
3. Backend middleware.
4. Frontend permission rules.
5. Navigation visibility.
6. Route guard.
7. User Permission Manager grouping and labels.
8. Tests.
9. In-app Help.

---

## 8. Core Business Invariants

### Sales and stock

- A valid sale updates stock exactly once.
- Communication failure must never roll back a valid sale.
- Completed sales are not silently rewritten.
- Approved corrections preserve before/after snapshots, reason, requester and approver.
- Voided or cancelled sales do not count as active revenue.
- Store context is enforced server-side.
- Direct quantity edits do not substitute for sales, purchases, returns, transfers or adjustments.

### Stock transfers

```text
Request → Approve → Dispatch → Receive
```

- Approval does not move stock.
- Dispatch reduces the source store.
- Receive increases the destination store.
- State transitions must be idempotent and auditable.

### Returns and refunds

A return may be stock-only or a financial refund. A financial refund requires exact amount, channel, electronic reference where applicable, reason and independent approval. Approved refunds reduce the matching Daily Closing channel.

### Daily Closing

Expected physical cash is:

```text
Cash sales
+ Cash allocation from Mixed sales
+ Cash received on part-paid Credit sales
+ Cash debt collections
+ Cash installment collections
- Cash expenses funded from today's sales receipts
- Cash refunds
= Expected physical cash
```

MoMo, Bank and Other are reconciled separately.

Critical rules:

- Never auto-copy expected figures into counted figures.
- Never force a variance to zero.
- Variances require explanation.
- Optional denomination counting must match submitted cash.
- The submitter cannot verify their own closing.
- Changed closings preserve originals and revision evidence.
- Verification confirms review; it does not erase a real shortage or excess.
- Externally funded expenses remain accounting expenses but do not reduce today's drawer/channel balance.

### Debts and installments

- Debt balances and payment ledgers must reconcile.
- Installment schedules preserve original terms and controlled changes.
- Allocations cannot exceed money received or outstanding balance.
- Corrections, reschedules, waivers and delivery events require evidence and permission.
- Automatic installment reminders remain disabled unless management deliberately enables them.

### Mining

- Every record belongs to an authorized site.
- Production, dispatch, stockpile and fuel logic must not create duplicate or negative movement.
- Site closing and reconciliation history is preserved.
- Fleet updates preserve one machine identity.

### Equipment Hire

- Every record belongs to an authorized Hire location.
- A machine cannot be both available and actively assigned.
- Contract, dispatch, work-log, invoice, payment, return and closure states follow controlled transitions.
- Financial summaries must not double-count invoices, deposits, payments, voids or balances.

### HR and employment documents

- Worker profiles are category-scoped.
- Standalone employment documents may exist before a worker profile.
- Draft, PDF, approval/signature, acknowledgement, archive and linking are controlled workflows.
- Approved documents preserve an immutable signature snapshot.
- Later signature-setting changes do not alter approved documents.
- Empty fields must not create blank sections or trailing PDF pages.

### Audit evidence

Sensitive actions should preserve actor, affected entity, workspace/context, before/after state, reason, approval identity, request ID, timestamp and outcome. Dismissing a notification must not delete underlying evidence.

---

## 9. Repository Structure

```text
chalin03-system-2/
├── .github/
│   └── workflows/
│       ├── chalin03-verification.yml
│       ├── version-3-final-audit.yml
│       └── version-3-production-smoke.yml
├── backend/
│   ├── config/
│   ├── middleware/
│   ├── routes/
│   ├── scripts/
│   ├── security/
│   ├── services/
│   ├── tests/
│   ├── utils/
│   ├── .env.example
│   ├── package.json
│   └── server.js
├── database/
│   ├── migrations/
│   ├── schema.sql
│   └── schema_verify.sql
├── docs/
├── frontend/
│   ├── public/
│   ├── scripts/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── config/
│   │   ├── context/
│   │   ├── data/
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── security/
│   │   ├── styles/
│   │   └── utils/
│   ├── .env.example
│   ├── package.json
│   └── vite.config.js
├── .gitignore
└── README.md
```

### Route ownership

- Register backend routes in `backend/server.js`.
- Route order matters. Branch loading is intentionally public because login needs the store list.
- More-specific HR/PDF routes are registered before legacy catch-all handlers.
- Add frontend routes through `frontend/src/App.jsx` and the correct workspace layout.
- Never place a Mining or Hire page inside the Spare Parts sidebar.

---

## 10. Local Setup on Windows

### Requirements

- Git
- Node.js 20+; Node.js 24 matches CI
- npm
- MySQL
- MySQL Workbench or another trusted client
- VS Code or equivalent
- Chrome or Edge

### Clone

```bat
cd /d C:\Users\DDK\Desktop
git clone https://github.com/Eugene999B/chalin03-system-2.git chalin03-system
cd /d C:\Users\DDK\Desktop\chalin03-system
git switch main
git pull --ff-only origin main
```

Do not copy `node_modules` from another computer.

### Install deterministic dependencies

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\backend
npm ci

cd /d C:\Users\DDK\Desktop\chalin03-system\frontend
npm ci
```

Use `npm install` only when intentionally changing dependencies and committing the lockfile.

### Environment files

From the repository root:

```bat
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

Essential local backend settings:

```env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:5173
FRONTEND_URL_ALT=http://localhost:3000
APP_VERSION=3.0.0

DB_HOST=localhost
DB_PORT=3306
DB_USER=chalin03_user
DB_PASSWORD=your_local_password
DB_NAME=chalin03_db
DB_SSL=false

JWT_SECRET=use_a_long_random_local_secret
SYSTEM_ADMIN_USER_ID=1
SYSTEM_ADMIN_USERNAME=admin

SMS_ENABLED=true
SMS_PROVIDER=mock
SMS_SENDER_ID=CHALIN03
INSTALLMENT_SMS_REMINDERS_ENABLED=false
```

`DB_USER` and `DB_PASSWORD` must identify an existing local MySQL account. The example `chalin03_user` is not created automatically; create it locally or use another existing local account. Never reuse Railway production credentials on a development computer.

Frontend:

```env
VITE_API_URL=http://localhost:5000/api
```

Use `backend/.env.example` as the complete variable reference. Never put real values in README, screenshots, issues, chats or commits.

### Fresh local database

For a new empty local installation only:

1. Create/select `chalin03_db`.
2. Run `database/schema.sql`.
3. Run `database/schema_verify.sql`.
4. Create the administrator:

   ```bat
   cd /d C:\Users\DDK\Desktop\chalin03-system\backend
   npm run create-admin
   ```

Never use `schema.sql` as a production migration or repair tool.

### Run locally

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\backend
npm run dev
```

In another terminal:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\frontend
npm run dev
```

```text
Frontend: http://localhost:5173
Backend:  http://localhost:5000
API:      http://localhost:5000/api
Health:   http://localhost:5000/api/health
```

---

## 11. Environment and Deployment Security

Production frontend:

```env
VITE_API_URL=https://api.chalin03.com/api
```

Production backend CORS:

```env
FRONTEND_URL=https://chalin03.com
FRONTEND_URL_ALT=https://www.chalin03.com
```

`backend/.env.example` also documents trusted host controls, the optional Cloudflare origin secret, API limits, session security, recovery secrets and provider settings.

Do not enable `CLOUDFLARE_ORIGIN_SECRET` until the identical value is configured in Railway and Cloudflare. A mismatch can block legitimate traffic.

- A broad rate ceiling protects ordinary routes.
- Login, recovery and sensitive administration use stricter limits.
- Do not remove rate limits to repair a client retry bug.
- Health is intentionally excluded from the broad limiter.
- API headers come from backend security middleware.
- Pages headers come from `frontend/public/_headers`.
- HSTS, CSP, frame denial, content-type protection, referrer policy and private-route noindex behavior are release requirements.

---

## 12. Database Change Procedure

Use `database/schema.sql` only for an empty local database. Existing local and production databases must use reviewed additive migrations.

A safe migration should:

- have a chronological unique filename,
- avoid destructive statements,
- preserve existing data,
- backfill deliberately,
- add indexes and constraints safely,
- include verification queries,
- be idempotent only when explicitly designed that way,
- document repair or rollback strategy,
- update fresh schema,
- update backup coverage,
- update tests.

### Production sequence

1. Verify the target Railway environment and database.
2. Download a current full-system backup.
3. Export critical reports when financial data is affected.
4. Review migration and verification SQL.
5. Apply only the approved migration.
6. Run verification immediately.
7. Confirm counts, constraints and problem queries.
8. Deploy dependent code.
9. Test old records and new workflows.
10. Confirm backups include every new table.
11. Record release evidence.

`backend/services/workerHrLetterSchemaService.js` and `backend/services/employmentDocumentSchemaService.js` are specific compatibility mechanisms. Do not treat runtime DDL as the default for unrelated work.

### Transactions and concurrency

For multi-table financial or stock writes:

- use a database transaction,
- validate state inside the transaction,
- lock relevant rows when concurrent execution can duplicate or overspend,
- commit only after all dependent writes succeed,
- roll back on failure,
- write audit evidence consistently,
- make retries idempotent where possible.

---

## 13. Backup and Restore Contract

Full-system backup/restore is intentionally system-wide. Store-separated management downloads belong in exports, not disaster recovery.

Canonical logic: `backend/routes/backupRoutes.js`.

When adding a persistent table:

1. Add it to fresh schema and migration.
2. Add it to backup order/manifest when it contains business or security state.
3. Add restore validation.
4. Add tests proving coverage.
5. Respect foreign-key order and date serialization.
6. Do not include duplicate legacy aliases.
7. Do not expose backup data to unauthorized users.

The most sensitive full-system backup and restore operations require the original System Administrator. Git restores code, not MySQL data.

---

## 14. Backend Development Rules

- Use parameterized SQL.
- Never concatenate untrusted input into SQL.
- Validate IDs, numbers, dates, enums and state transitions.
- Return stable JSON shapes.
- Include `request_id` where middleware provides it.
- Do not expose stack traces, SQL, credentials or internal paths.
- Use central error middleware.
- Keep public routes minimal and intentional.
- Apply `requireAuth` and the correct workspace boundary.
- Apply permissions or delegated authority to sensitive routes.
- Re-check state server-side even when the frontend already checks.

A money, stock, permission, backup, approval or document handler must answer:

- Is the current transition legal?
- Who is allowed?
- Is independent approval required?
- What tables change?
- What happens if an intermediate step fails?
- What evidence is preserved?
- Can a retry duplicate the effect?
- Does Daily Closing change?
- Can communication failure affect the core transaction?
- Does backup/restore include the state?

When adding a route, register it in `backend/server.js`, add middleware, add tests, update the API root list if the group is new, and review readiness/diagnostics plus backup coverage.

---

## 15. Frontend Development Rules

- `frontend/src/App.jsx` is the route source of truth.
- Spare Parts, Mining and Hire use separate layouts.
- Use `ProtectedRoute`, `WorkspaceRoute`, `PermissionRoute` and `RoleRoute` appropriately.
- A page visible in the wrong workspace is a security and logic defect.
- Use `frontend/src/api/axiosClient.js` for normal authenticated requests.
- Do not create an unconfigured Axios instance for ordinary API calls.
- Follow React Hooks rules.
- Do not suppress dependency warnings casually.
- Ignore or cancel stale asynchronous results when rapid context changes can race.
- Clear workspace-specific state when branch/site/location changes.
- Do not derive authorization only from local storage.

### Mobile and accessibility

Check user-facing changes near 320 px, 375 px, 430 px, tablet and desktop widths.

Require:

- no accidental horizontal page overflow,
- usable touch targets,
- readable labels,
- phone-safe input font sizes,
- tables that become cards or deliberately scroll,
- no overlapping actions,
- small-screen dialogs and PDF previews,
- usable keyboard/focus behavior,
- status that does not depend only on color.

### PWA

Production registers `frontend/public/sw.js`. For cache-sensitive changes, update the cache namespace when needed, remove obsolete caches and test installation/update behavior. Use Incognito or a hard refresh before diagnosing a stale frontend.

---

## 16. PDF and Export Rules

Exports are business records. Preserve workspace context, document number, dates, totals and approval/signature evidence. Omit empty optional fields, prevent blank trailing pages, use safe filenames, escape spreadsheet/CSV values and never expose private fields to unauthorized roles.

Test at least one populated and one sparse record.

ExcelJS currently has monitored moderate transitive UUID advisories. There are no known high or critical production dependency vulnerabilities. Do not force a breaking ExcelJS change without export regression testing.

---

## 17. SMS and WhatsApp Rules

Development should use:

```env
SMS_PROVIDER=mock
```

Mock mode records provider-style evidence without spending credit.

Live Arkesel support includes custom messages, receipts, debt reminders, low-stock alerts, summaries, deliberately enabled installment reminders, provider references, callbacks/polling, controlled retry and archived history.

- Provider acceptance is not delivery.
- Delivered requires provider evidence.
- Unknown must not be labeled delivered.
- Retry only clearly failed, undelivered or expired records.
- Never create uncontrolled duplicate sends or charges.

Keep WhatsApp receipts disabled until approved Meta credentials, templates and policy exist:

```env
WHATSAPP_RECEIPT_ENABLED=false
```

Communication failure must not invalidate a completed business transaction.

---

## 18. Required Verification

### Backend

```bash
cd backend
npm ci
npm run syntax-check
npm test
npm audit --omit=dev --audit-level=high
```

### Frontend

```bash
cd frontend
npm ci
npm test
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
```

### Repository hygiene

```bash
git diff --check
git status --short
git diff --stat
```

### Permanent CI gates

All must be green before merge:

- **Chalin 03 Verification**
- **Version 3 Final Security Audit**
- **Version 3 Production Smoke**

Normal verification enforces backend syntax/tests and frontend source tests, full lint and production build.

The security audit covers production dependency gates, secret-shape scanning, CodeQL, API security headers, protected routes, sensitive paths, hostile CORS, TRACE and private-route indexing.

Production smoke checks the live API version/readiness, database/schema/configuration health, rate-limit headers, HSTS, login release identity, service worker and PWA manifest.

Never weaken a failing release gate to obtain a merge.

---

## 19. Test Locations

Backend tests: `backend/tests/*.test.js`.

Add backend tests for permissions, category isolation, context filtering, transactions, calculations, migrations, audit evidence, backup coverage, security and regressions.

Frontend source/contract tests: `frontend/scripts/`.

Frontend `npm test` covers source contracts, permissions, public security, employment documents and Version Three identity. Extend it when changing routes, permission labels, security headers, public metadata, documents, version identity or mobile CSS contracts.

A successful build alone does not prove business logic or permission correctness.

---

## 20. Safe Feature Workflow

```bash
git switch main
git pull --ff-only origin main
git switch -c agent/clear-feature-name
```

Before coding, identify the workspace, data, page, backend route, tables, permissions, tests, migration need and rollback behavior.

Before committing:

```bash
git diff --check
git diff --stat
git status --short
```

Stage explicit files, commit clearly, push the isolated branch and open a draft PR describing scope, affected workspaces, database/security impact, checks, deployment plan and residual risk.

Do not merge while required checks are pending or failing.

---

## 21. Deployment and Smoke Test

After merge, verify Railway and Cloudflare deployed the merged `main` commit.

### API

- `/api/health` succeeds and reports `3.0.0`.
- `/api/readiness` is ready.
- Database/schema/configuration checks pass.
- Startup self-check passes.
- Protected endpoints reject unauthenticated requests.
- Affected routes return correct scoped records.

### Frontend

- Login displays `Version Three · v3.0.0`.
- HSTS and other security headers remain present.
- Private routes remain noindex.
- Service worker and PWA update correctly.
- Browser console has no new error.
- Mobile layout remains usable.

Test realistic roles, permissions and different branches/sites/locations. Do not create uncontrolled financial test data in production.

---

## 22. Definition of Done

A task is done only when all applicable items are true:

- scope is complete and unrelated behavior is unchanged,
- business invariants remain true,
- authorization is enforced server-side,
- workspace/context isolation is verified,
- database changes are additive and documented,
- backup coverage includes new persistent state,
- audit evidence is preserved,
- backend syntax and tests pass,
- frontend tests, full lint and build pass,
- no unreviewed high/critical dependency finding remains,
- permanent CI gates are green,
- mobile behavior is checked,
- exports/PDFs are checked when affected,
- deployment succeeds,
- post-deploy smoke tests pass,
- documentation is updated,
- residual risk is stated honestly.

---

## 23. Common Failure Modes

### Old frontend

Confirm the latest Cloudflare deployment, use `Ctrl + Shift + R`, open Incognito, close/reopen the installed PWA and inspect the service-worker cache version.

### API route not found

Confirm Railway deployed current `main`, inspect `backend/server.js`, route order, `VITE_API_URL` and Railway logs.

### Redirect to login

Inspect the response status/code, session, token version, active user state, workspace/category assignment and stored workspace. Do not remove the central 401 handler as a shortcut.

### Wrong-business data

Inspect workspace and context headers, Spare Parts branch headers, category middleware, SQL filters and a second workspace user.

### Port 5000 already in use

```bat
netstat -ano | findstr :5000
taskkill /PID ACTUAL_PID /F
```

### Daily Closing mismatch

Review payment allocations, voids, debt/installment collections, expense funding source, refunds, post-closing changes, physical count, revisions and verifier identity. Do not alter the formula merely to match an expected number.

### PDF/export failure

Inspect API response and Railway logs, required columns/tables, sparse and populated records, page breaks and stale frontend caching.

---

## 24. Security Posture and Residual Risk

Version Three includes JWT verification, current server-side identity refresh, token-version revocation, server-side sessions, category isolation, effective permissions, protected-action windows, independent approval, rate limiting, CORS allowlist, Helmet/API headers, Cloudflare HSTS/CSP, private-route noindex, CodeQL, dependency audits, secret scanning, passive perimeter checks and system-wide backup controls.

Known residual items:

1. Bearer-token storage remains in local storage. CSP, React escaping, session validation and revocation reduce risk, but a future HttpOnly-cookie architecture would further reduce token theft impact from a hypothetical XSS defect.
2. ExcelJS has monitored moderate transitive UUID advisories. There are no known high or critical production dependency vulnerabilities.
3. Non-destructive CI does not replace an authorized external penetration test. Never perform credential stuffing, traffic flooding, destructive mutation or third-party infrastructure exploitation against production.

Report suspected vulnerabilities privately. Never put secrets or exploit details in a public issue.

---

## 25. Version Rules

Current identity:

```text
Version Three
v3.0.0
Version Three · v3.0.0
```

Canonical files:

- `backend/config/version.js`
- `frontend/src/config/appVersion.js`
- `backend/package.json`
- `frontend/package.json`
- `backend/.env.example`
- Version Three release tests

Do not change version strings independently. A version release requires coordinated metadata, tests, documentation and deployment verification. A Git tag protects source history, not database contents.

---

## 26. AI Agent Handoff Template

```text
Repository:
Branch:
Base commit:
Latest commit:
PR:
Production status:

User request:
Completed:
Not completed:
Files changed:
Database impact:
Migration required:
Backup impact:
Permissions affected:
Business logic affected:
Tests run:
CI status:
Deployment status:
Smoke tests:
Known risks:
Exact next action:
```

Do not say “done” while required checks or deployment remain unverified.

---

## 27. Documentation Responsibilities

Update this README when architecture, workspace boundaries, setup, environment variables, security, deployment, database procedure, required checks, version identity or known risks change.

Update in-app Help when staff workflow changes.

Do not append unordered release notes above the title. Put detailed release history in `docs/` or Git history while keeping current operating truth near the top.

---

## 28. Ownership

Prepared by **Eugene Amankwah Appiah** for **Chalin 03 Company Limited**.

Location reference: **Dunkwa Police Barrier, Ghana**.

This repository controls a real business system. Protect the records, preserve the evidence and make every change reviewable.
