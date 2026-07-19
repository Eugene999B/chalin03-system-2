# Chalin 03 Group Operations Platform

**Version Three · v3.0.0**

Production business-control platform for **Chalin 03 Company Limited**, prepared by **Eugene Amankwah Appiah**.

> **AI AGENT ENTRYPOINT**
>
> This repository is connected to a live business system with real sales, stock, debt, accounting, staff and operational records. Read this entire README before changing code. Production data is more valuable than the application source because source code can be restored from GitHub, while lost business records may not be reconstructable.

---

## 1. Current Production Environment

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
| Backend runtime | Node.js 20+; CI uses Node.js 24 |
| SMS provider | Arkesel when enabled; `mock` for safe development |
| WhatsApp receipts | Keep disabled until approved Meta setup exists |

`main` automatically deploys the backend and frontend. Never merge an unverified change into `main`.

The exact production commit changes over time. Before any release task, verify the current `main` commit, open pull requests, workflow status, Railway deployment and Cloudflare deployment rather than trusting an old commit hash in documentation.

---

## 2. Non-Negotiable Rules for Every Human or AI Agent

### Production and data safety

1. **Never run `database/schema.sql` against Railway production.** It is a fresh-install/reset schema.
2. **Never drop, truncate, reset or mass-update production tables to fix an application error.**
3. Production database changes must be additive, reviewed, backed up and verified.
4. Take or confirm a current full-system backup before any production migration.
5. Never expose `.env`, database credentials, JWT secrets, SMS keys, customer data, staff data or backup contents.
6. Do not rewrite historical audit, closing, approval, payment, signature or stock evidence.
7. Do not silently change financial formulas or historical interpretation.
8. Do not mix Spare Parts stores with Mining sites or Equipment Hire locations.
9. Do not bypass backend authentication, category isolation, permission checks or protected-action controls.
10. A hidden frontend button is not security. The backend must independently reject unauthorized requests.

### Change-management safety

1. Start from current `main`.
2. Use an isolated branch such as `agent/clear-change-name`.
3. Make the smallest coherent change.
4. Do not combine unrelated refactors with a production fix.
5. Add or update tests for every behavior, permission, schema or security change.
6. Run the complete required verification gates before requesting merge.
7. Use a pull request. Do not push feature work directly to `main`.
8. Confirm deployment and smoke-test the affected workspace after merge.
9. Preserve backward compatibility for existing records unless an approved migration explicitly changes it.
10. When uncertain, prefer stopping a risky write over guessing.

---

## 3. First 15 Minutes for a Newly Connected AI Agent

Perform these steps before proposing code:

1. Read this README completely.
2. Inspect the current repository and branch:
   ```bash
   git status -sb
   git branch --show-current
   git log --oneline -10
   ```
3. Confirm the current application version:
   - `backend/config/version.js`
   - `frontend/src/config/appVersion.js`
   - `backend/package.json`
   - `frontend/package.json`
4. Read the route and security entrypoints:
   - `backend/server.js`
   - `frontend/src/App.jsx`
   - `backend/middleware/authMiddleware.js`
   - `backend/security/permissionCatalog.js`
   - `frontend/src/security/permissionRules.js`
5. Identify the exact business workspace affected.
6. Trace the complete flow:
   ```text
   UI page/component
     → axiosClient request and workspace headers
     → server route registration
     → route handler
     → auth/category/permission middleware
     → service/database transaction
     → audit/notification/backup implications
     → frontend result
   ```
7. Read the closest backend and frontend tests before editing.
8. Determine whether the change requires:
   - a database migration,
   - backup-manifest updates,
   - permission-catalog changes,
   - activity-log evidence,
   - PWA/cache changes,
   - PDF/export changes,
   - mobile layout changes,
   - deployment configuration changes.
9. State the intended scope and production risk before writing code.
10. Do not claim completion until tests, lint, build and relevant security checks pass.

---

## 4. Source-of-Truth Order

When documentation and code disagree, investigate and update both. Use this order:

1. **Current database schema and applied additive migrations**
2. **Backend route, middleware and service behavior**
3. **Backend tests**
4. **Frontend route guards, contexts and pages**
5. **Frontend source tests**
6. **CI workflows**
7. **This README and in-app Help**

Important entrypoints:

| Purpose | Canonical location |
|---|---|
| Backend route registration and middleware order | `backend/server.js` |
| Frontend route tree and workspace shells | `frontend/src/App.jsx` |
| Authentication and current server-side identity refresh | `backend/middleware/authMiddleware.js` |
| Workspace/category isolation | `backend/services/categoryIsolationService.js` |
| Permission catalog | `backend/security/permissionCatalog.js` |
| Effective permission overrides | `backend/services/permissionOverrideService.js` |
| Session validation/revocation | `backend/services/accountSessionService.js` |
| Original System Administrator identity | `backend/security/systemAdminIdentity.js` |
| Frontend API headers and 401 handling | `frontend/src/api/axiosClient.js` |
| Frontend authentication state | `frontend/src/context/AuthContext.jsx` |
| Active Mining/Hire context | `frontend/src/context/WorkspaceContext.jsx` |
| Frontend permission mappings | `frontend/src/security/permissionRules.js` |
| Fresh local database | `database/schema.sql` |
| Production-safe database evolution | `database/migrations/` and reviewed legacy migration files in `database/` |
| Full-system backup manifest/order | `backend/routes/backupRoutes.js` |
| Normal verification pipeline | `.github/workflows/chalin03-verification.yml` |
| Security release audit | `.github/workflows/version-3-final-audit.yml` |
| Cloudflare response headers | `frontend/public/_headers` |
| PWA service worker | `frontend/public/sw.js` |

---

## 5. Platform Architecture

```text
Browser / installed PWA
  → React + Vite frontend on Cloudflare Pages
  → Axios client with Bearer token and workspace/context headers
  → https://api.chalin03.com/api
  → Express middleware: request context, security headers, CORS, rate limits
  → JWT + session + token-version validation
  → workspace/category isolation
  → permission/delegated-authority checks
  → route/service business logic
  → Railway MySQL
  → Activity Log / security evidence / notifications / exports
  → optional Arkesel SMS
```

### Technology stack

**Frontend**

- React 19
- Vite 8
- React Router 7
- Axios
- CSS
- PWA/service-worker support
- ESLint with React Hooks rules

**Backend**

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
- Arkesel SMS integration

---

## 6. Business Workspace Boundaries

Workspace separation is a security and accounting boundary, not only a visual layout choice.

### Spare Parts — `spare_parts`

Spare Parts uses the original store/branch model. It has two operational stores. Store context controls:

- products and quantity,
- sales and receipts,
- installment sales,
- customers and debts,
- debt payments,
- purchases and suppliers,
- expenses,
- returns and refunds,
- daily closing,
- reports and exports,
- stock adjustments,
- stock transfers,
- SMS,
- activity-log scope.

The Axios client sends Spare Parts branch headers only for this workspace:

- `X-Chalin03-Branch-Id`
- `X-Chalin03-Branch-Code`
- `X-Chalin03-Branch-Name`

Always confirm the active store before saving or testing a transaction.

### Mining Operations — `mining`

Mining sites are created by administrators. They are not Spare Parts stores.

Mining includes:

- site administration,
- daily logs,
- production records,
- stockpiles and dispatch,
- equipment shifts,
- fuel tanks, transactions and reconciliation,
- expenses,
- contractors and shift crews,
- incidents,
- site closing,
- documents and reports,
- workers,
- shared Fleet access.

The active Mining site is sent through:

- `X-Chalin03-Workspace: mining`
- `X-Chalin03-Context-Id: <mining_site_id>`

### Equipment Hire — `equipment_hire`

Hire locations, yards and bases are administrator-created and independent from Spare Parts.

Equipment Hire includes:

- customers and enquiries,
- availability,
- quotations,
- contracts and amendments,
- equipment assignment,
- dispatch,
- work logs,
- invoices and invoice lines,
- deposits and payments,
- commercial approvals,
- evidence files and damage assessment,
- return inspection,
- reports and documents,
- workers,
- shared Fleet access.

The active Hire location is sent through:

- `X-Chalin03-Workspace: equipment_hire`
- `X-Chalin03-Context-Id: <hire_location_id>`

### Shared Fleet

Fleet is shared only between Mining and Equipment Hire. A machine should be registered once. Fleet controls include:

- availability,
- current assignment and location,
- operator,
- meter readings,
- fuel,
- inspections,
- maintenance and breakdowns,
- service due,
- registration/insurance/document expiry,
- archive history.

Do not create duplicate Fleet assets for the same machine in different workspaces.

### Group Executive Control

Group Executive is a separate management shell. It is not an editing substitute for the operational workspaces. It presents consolidated operational and financial intelligence to authorized management.

---

## 7. Authentication, Sessions and Permissions

### Authentication model

The browser currently stores:

- `chalin03_token`
- `chalin03_user`
- active Mining/Hire context identifiers

The API client sends the JWT as a Bearer token. The backend does not trust stale token claims alone. On each authenticated request it reloads current security-sensitive state and validates:

1. JWT signature,
2. active user record,
3. token version,
4. category/workspace access,
5. active server-side session,
6. current effective permissions.

A new login may revoke the prior session. Permission or account changes may revoke active sessions.

### Authorization layers

A protected feature may require several controls at once:

```text
requireAuth
  + workspace/category boundary
  + role or effective permission
  + location/site/store access
  + protected-action token/password window
  + independent approver
```

Do not remove one layer because another exists.

### Permission model

- Role permissions are defaults.
- Per-user overrides may explicitly allow or deny a permission.
- Explicit deny takes precedence.
- Overrides may expire.
- Permission changes require reason and protected-action evidence.
- Permission changes must be recorded in the Activity Log/privileged ledger.
- Frontend route guards improve UX, but backend middleware is authoritative.
- The original System Administrator retains protected recovery and cross-category authority.
- Category-specific administrators must not silently become cross-category administrators.

When adding a permission-controlled feature, update all relevant places:

1. backend permission catalog,
2. role defaults,
3. backend middleware/route checks,
4. frontend permission rules,
5. navigation visibility,
6. route guard,
7. User Permission Manager grouping/labels,
8. tests,
9. Help documentation where user-facing.

---

## 8. Core Business Invariants

These rules must remain true after every change.

### Sales and stock

- A valid sale must update stock exactly once.
- A failed SMS or WhatsApp attempt must never roll back a valid sale.
- Completed sales must not be silently rewritten.
- Approved changes preserve before/after snapshots, reason, requester and approver.
- Voided/cancelled sales must not count as active revenue.
- Store context must be enforced server-side.
- Direct quantity edits are not a substitute for purchase, sale, return, transfer or adjustment records.

### Stock transfers

The workflow is:

```text
Request → Approve → Dispatch → Receive
```

- Approval does not move stock.
- Dispatch reduces the source store.
- Receive increases the destination store.
- Each state transition must be idempotent and auditable.
- Source and destination cannot be confused or silently changed after movement.

### Returns and refunds

A return may be:

- stock-only, or
- financial refund.

A financial refund requires:

- exact amount,
- exact payment channel,
- electronic reference where applicable,
- reason,
- independent manager/administrator approval.

Refunds reduce the matching Daily Closing channel.

### Daily Closing and cash control

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

- Never auto-copy expected values into counted values.
- Never force a difference to zero.
- Variances require explanation.
- Optional denomination counting must match the submitted cash count.
- The closing submitter cannot verify their own closing.
- A changed closing must preserve the original and create revision evidence.
- Manager verification confirms review; it does not erase a real shortage or excess.
- Externally funded expenses remain accounting expenses but do not reduce today's drawer/channel balance.

### Debts and installments

- Debt balances and payment ledgers must reconcile.
- Installment schedules must preserve original agreement terms and subsequent controlled changes.
- Payment allocation must not exceed received amount or outstanding balance.
- Corrections, reschedules, waivers and delivery events require evidence and permissions.
- Automatic installment SMS reminders remain disabled unless management deliberately enables them.

### Mining

- Every operational record must belong to the authenticated user's authorized site.
- Production, dispatch, stockpile and fuel algorithms must not create negative or duplicated movement.
- Site closings and reconciliation evidence must remain historical.
- Shared Fleet updates must preserve the machine's single identity.

### Equipment Hire

- Every record must belong to an authorized Hire location.
- A machine cannot be treated as simultaneously available and actively assigned.
- Contract, dispatch, work-log, invoice, payment, return and closure states must transition in a controlled order.
- Financial summaries must derive from invoices, deposits, payments, voids and balances without double counting.

### HR and employment documents

- Worker profiles are category-scoped.
- Standalone employment documents may exist before a worker account/profile exists.
- Documents use controlled draft, PDF, approval/signature, acknowledgement, archive and linking workflows.
- Approved documents preserve an immutable signature snapshot.
- Later signature-setting changes must not alter already approved documents.
- Empty fields should not create blank PDF sections or trailing blank pages.

### Audit evidence

Sensitive actions should preserve:

- actor,
- affected user/entity,
- workspace/context,
- branch/site/location,
- before state,
- after state,
- reason,
- approval identity,
- request ID,
- timestamp,
- outcome.

Do not delete underlying evidence merely because a notification is dismissed from the active UI.

---

## 9. Repository Structure

```text
chalin03-system-2/
├── .github/
│   └── workflows/
│       ├── chalin03-verification.yml
│       └── version-3-final-audit.yml
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
│   ├── schema_verify.sql
│   └── reviewed legacy migration/verification files
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

- Register backend routes only in `backend/server.js`.
- Registration order matters. Public branch loading is intentionally registered before authentication because login needs the store list.
- More-specific HR/PDF handlers are intentionally registered before legacy catch-all handlers.
- Add frontend routes only through `frontend/src/App.jsx` and the appropriate workspace layout/navigation.
- Do not put a Mining or Hire page inside the Spare Parts sidebar.

---

## 10. Local Development Setup

### Requirements

- Git
- Node.js 20 or newer; Node.js 24 matches CI
- npm
- MySQL
- MySQL Workbench or another trusted SQL client
- VS Code or equivalent
- Chrome or Edge

### Clone on Windows

```bat
cd /d C:\Users\DDK\Desktop
git clone https://github.com/Eugene999B/chalin03-system-2.git chalin03-system
cd /d C:\Users\DDK\Desktop\chalin03-system
git switch main
git pull --ff-only origin main
```

Do not copy `node_modules` from another machine.

### Install deterministic dependencies

Backend:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\backend
npm ci
```

Frontend:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\frontend
npm ci
```

Use `npm install` only when intentionally changing dependency versions and committing the resulting lockfile.

### Environment files

Create local files from the examples:

```bat
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

Essential local backend values:

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

Essential local frontend value:

```env
VITE_API_URL=http://localhost:5000/api
```

Use `backend/.env.example` as the complete variable reference. Never put real values in README, screenshots, issues, chat logs or commits.

### Create a fresh local database

For a new blank local installation only:

1. Create/select `chalin03_db`.
2. Run:
   ```text
   database/schema.sql
   ```
3. Run:
   ```text
   database/schema_verify.sql
   ```
4. Create the administrator:
   ```bat
   cd /d C:\Users\DDK\Desktop\chalin03-system\backend
   npm run create-admin
   ```

> `database/schema.sql` must never be used as a production migration or repair tool.

### Run locally

Backend:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\backend
npm run dev
```

Frontend:

```bat
cd /d C:\Users\DDK\Desktop\chalin03-system\frontend
npm run dev
```

Local addresses:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:5000
API:      http://localhost:5000/api
Health:   http://localhost:5000/api/health
```

---

## 11. Environment and Deployment Security

### Production frontend

```env
VITE_API_URL=https://api.chalin03.com/api
```

### Production backend CORS

Production must allow the canonical frontends:

```env
FRONTEND_URL=https://chalin03.com
FRONTEND_URL_ALT=https://www.chalin03.com
```

### Trusted API host controls

`backend/.env.example` documents:

- `TRUSTED_API_HOSTS`
- `ENFORCE_TRUSTED_API_HOSTS`
- `CLOUDFLARE_ORIGIN_SECRET`

Do not enable the Cloudflare origin secret until the identical value is configured on both sides. A mismatch can block all legitimate production traffic.

### Rate limiting

- A broad API ceiling protects ordinary routes.
- Login, recovery and sensitive administration have stricter dedicated limits.
- Do not remove rate limits to fix a client retry bug.
- Health is intentionally excluded from the broad limiter.

### Security headers

- Backend security middleware provides API headers.
- Cloudflare Pages headers are defined in `frontend/public/_headers`.
- HSTS, frame denial, content-type protection, CSP, referrer policy and private-route indexing controls are release requirements.
- Public company/division pages intentionally have different indexing rules from private application routes.

---

## 12. Database Change Procedure

### Fresh installation

Use `database/schema.sql` only for an empty local database.

### Existing local or production database

Use a reviewed additive migration. A safe migration should:

- use a unique chronological filename,
- avoid destructive statements,
- use `IF NOT EXISTS` where appropriate,
- preserve existing data,
- backfill deliberately,
- add indexes and constraints safely,
- include verification queries,
- be rerunnable only when explicitly designed to be idempotent,
- document rollback or repair strategy,
- update `schema.sql` for future fresh installs,
- update backup coverage,
- update tests.

### Production sequence

1. Verify the target Railway environment and database.
2. Download a current full-system backup.
3. Export critical management reports if the change is financial.
4. Review the migration and verification SQL.
5. Apply only the approved migration.
6. Run verification immediately.
7. Confirm all expected counts, constraints and problem counts.
8. Deploy code that depends on the migration.
9. Test old records and new workflows.
10. Confirm backups include every new table.
11. Record release evidence.

Some recent HR/signature tables also have guarded startup schema services:

- `backend/services/workerHrLetterSchemaService.js`
- `backend/services/employmentDocumentSchemaService.js`

These are specific compatibility mechanisms. Do not treat runtime DDL as the default for unrelated features.

### Transactions and concurrency

Financial and stock writes should be atomic. When changing multi-table operations:

- use a database transaction,
- validate state inside the transaction,
- lock relevant rows when concurrent execution could duplicate or overspend,
- commit only after all dependent writes succeed,
- roll back on failure,
- write audit evidence consistently,
- make retries idempotent where possible.

---

## 13. Backup and Restore Contract

Full-system backup and restore are intentionally system-wide. Store-separated management downloads belong in export routes, not the disaster-recovery backup.

Canonical backup logic:

```text
backend/routes/backupRoutes.js
```

Rules for new tables:

1. Add the table to fresh schema and migration.
2. Add it to backup order/manifest when it contains business or security state.
3. Add restore validation.
4. Add tests proving coverage.
5. Consider foreign-key order and date serialization.
6. Never include duplicate legacy alias tables.
7. Never expose backup data to unauthorized users.

Only the original System Administrator may perform the most sensitive full-system backup/restore operations.

Git restores code. It does not restore MySQL data.

---

## 14. Backend Development Conventions

### Route design

- Use parameterized SQL.
- Never concatenate untrusted input into SQL.
- Validate identifiers, numbers, dates, enums and state transitions.
- Return stable JSON shapes.
- Include `request_id` in error responses where middleware provides it.
- Do not expose stack traces, SQL, credentials or internal file paths.
- Use the central error middleware.
- Keep public routes minimal and intentional.
- Apply `requireAuth` and the correct workspace boundary before business routes.
- Apply permission/delegated-authority middleware to sensitive routes.
- Re-check permissions and state server-side even when the frontend already checks.

Typical error shape:

```json
{
  "status": "error",
  "code": "STABLE_ERROR_CODE",
  "message": "Safe user-facing explanation.",
  "request_id": "request-correlation-id"
}
```

### Financial and audit changes

A handler that modifies money, stock, permissions, approvals, backups, security settings or signed documents should answer:

- What is the current state?
- Is this transition legal?
- Who is allowed?
- Is independent approval required?
- What tables change?
- What happens if step 3 fails after step 2 succeeds?
- What evidence is preserved?
- Can a retry duplicate the effect?
- Does Daily Closing change?
- Does a notification or SMS failure affect the core transaction?
- Does backup/restore include the new state?

### Adding a backend route

1. Create or extend a file in `backend/routes/`.
2. Prefer services for reusable business logic.
3. Add middleware.
4. Register the route in `backend/server.js`.
5. Add tests in `backend/tests/`.
6. Update `/api` route documentation if the route group is new.
7. Update readiness/diagnostics expected tables if schema changes.
8. Update backup coverage if tables change.

---

## 15. Frontend Development Conventions

### Routing and workspace shells

- `frontend/src/App.jsx` is the route source of truth.
- Spare Parts, Mining and Equipment Hire use separate layouts.
- Use `ProtectedRoute`, `WorkspaceRoute`, `PermissionRoute` and `RoleRoute` appropriately.
- A page visible in the wrong workspace is a security/logic defect.
- Legacy shared links should redirect into the active workspace rather than reintroduce a shared sidebar.

### API requests

Use:

```text
frontend/src/api/axiosClient.js
```

Do not create unconfigured Axios instances for normal authenticated API calls. The shared client adds:

- Bearer token,
- workspace code,
- context ID,
- Spare Parts branch headers,
- timeout,
- centralized 401 cleanup and login redirect.

### State and hooks

- Follow React Hooks rules.
- Do not suppress dependency warnings casually.
- Use `useCallback`/`useMemo` only when they make dependencies and behavior clearer.
- Cancel or ignore stale async results when rapid context changes can race.
- Clear workspace-specific state when branch/site/location changes.
- Do not derive authorization only from stale local storage; server responses remain authoritative.

### Mobile and accessibility

Every user-facing change must be checked at:

- approximately 320 px,
- 375 px,
- 430 px,
- tablet width,
- desktop width.

Requirements:

- no horizontal page overflow,
- usable touch targets,
- readable form labels,
- phone-safe input font sizes,
- tables must transform into usable cards or scroll deliberately,
- action buttons must not overlap,
- dialogs/PDF previews must fit small screens,
- focus and keyboard behavior must remain usable,
- status must not depend on color alone.

### PWA and caching

Production registers `frontend/public/sw.js`.

When changing assets, routes or cache-sensitive behavior:

- update the service-worker cache namespace when necessary,
- ensure old caches are removed,
- verify install/update behavior,
- use Incognito or hard refresh during smoke tests,
- do not misdiagnose an old cached bundle as a backend defect.

---

## 16. PDF, Excel, Word and CSV Exports

Exports are business records.

When changing exports:

- preserve store/site/location context,
- preserve document number and date,
- include approval/signature evidence where required,
- omit empty optional fields cleanly,
- prevent trailing blank pages,
- use safe filenames,
- escape spreadsheet/CSV values,
- do not expose private fields to unauthorized roles,
- verify totals against the API/source records,
- test at least one populated and one sparse record.

ExcelJS currently carries monitored moderate transitive dependency findings through UUID. There are no known high or critical production dependency vulnerabilities. Do not force a breaking ExcelJS downgrade without export regression testing and an approved migration/release plan.

---

## 17. SMS and WhatsApp Rules

### Development

Use:

```env
SMS_PROVIDER=mock
```

Mock mode records provider-style evidence without spending SMS credit.

### Live SMS

Arkesel support includes:

- custom SMS,
- receipt SMS,
- debt reminders,
- low-stock alerts,
- daily summaries,
- installment reminders when deliberately enabled,
- provider reference and response evidence,
- callback and polling delivery confirmation,
- controlled retry,
- archived history.

Status must remain truthful:

- provider acceptance is not the same as delivery,
- delivered requires provider evidence,
- unknown must not be labeled delivered,
- retry only clearly failed/undelivered/expired messages,
- never resend automatically in a way that can create duplicate charges.

### WhatsApp

Keep:

```env
WHATSAPP_RECEIPT_ENABLED=false
```

until approved Meta Cloud API credentials, templates and operational policy exist.

Communication failure must not invalidate a completed business transaction.

---

## 18. Required Verification Commands

Run from a clean branch with deterministic dependencies.

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

### Required CI

Before merge, both permanent workflows must be green:

- **Chalin 03 Verification**
- **Version 3 Final Security Audit**

The normal workflow enforces:

- backend syntax,
- backend tests,
- frontend source tests,
- full frontend lint,
- production frontend build.

The security workflow covers:

- production dependency audit,
- tracked secret-shape scanning,
- CodeQL JavaScript security-extended analysis,
- API security headers,
- protected-route authentication,
- sensitive path exposure,
- hostile-origin CORS,
- TRACE handling,
- public-site headers and private-route noindex behavior.

Do not disable or mark a failing release gate `continue-on-error` to get a merge.

---

## 19. Tests: Where and What to Add

### Backend

Tests live in:

```text
backend/tests/*.test.js
```

Add tests for:

- permission enforcement,
- workspace/category isolation,
- context filtering,
- transaction/state transitions,
- calculations,
- migration presence/contract,
- audit evidence,
- backup coverage,
- security headers and route order where relevant,
- regressions from the reported bug.

### Frontend

Source/contract tests live in:

```text
frontend/scripts/
```

The frontend `npm test` command runs the repository's source checks, permission tests, public-security tests, employment-document tests and Version Three release tests.

Add or extend tests when changing:

- route visibility,
- permission labels,
- page source contracts,
- security headers,
- public metadata,
- employment documents,
- release identity,
- mobile CSS source requirements.

A build success alone does not prove permission or business logic correctness.

---

## 20. Safe Feature Workflow for AI Agents

### Before coding

1. Restate the affected workspace and data.
2. Identify the frontend page, backend route, tables, permissions and tests.
3. Identify whether production migration is needed.
4. Identify failure and rollback behavior.
5. Confirm no unrelated files will be changed.

### Branch

```bash
git switch main
git pull --ff-only origin main
git switch -c agent/clear-feature-name
```

### Implementation

- edit only required files,
- preserve existing APIs where practical,
- add tests with the code,
- update README/Help when behavior changes,
- update version only for an approved release,
- do not include secrets or generated production data.

### Pre-PR review

```bash
git diff --check
git diff --stat
git status --short
```

Then run the complete backend and frontend gates.

### Commit

Stage explicit paths:

```bash
git add path/to/file1 path/to/file2
git commit -m "Clear description of the verified change"
git push -u origin agent/clear-feature-name
```

Open a draft pull request describing:

- what changed,
- why,
- affected workspaces,
- database impact,
- security impact,
- tests run,
- deployment/smoke-test plan,
- residual risks.

Do not merge while required checks are pending or failing.

---

## 21. Production Deployment and Smoke Test

Production deploys from `main`.

After merge, verify:

### Railway/API

- deployment status is successful,
- `/api/health` returns success,
- reported version is `3.0.0`,
- startup self-check passes,
- database connection succeeds,
- no migration/startup error appears,
- protected endpoints still reject unauthenticated requests,
- affected API routes return correct records for authorized users.

### Cloudflare/frontend

- production deployment is successful,
- login displays `Version Three · v3.0.0`,
- HSTS/security headers are present,
- login/private routes remain noindex,
- service worker updates,
- no stale bundle remains after hard refresh,
- browser console has no new error.

### Functional smoke test

Test with realistic roles and contexts:

- original System Administrator,
- category Administrator where relevant,
- manager,
- cashier for Spare Parts,
- accountant/auditor where relevant,
- restricted user,
- user without the permission,
- different branch/site/location.

Test both existing records and a controlled new test record. Do not create uncontrolled financial data in production.

---

## 22. Definition of Done

A task is done only when all applicable statements are true:

- scope is complete and no unrelated behavior changed,
- business invariants remain true,
- authorization is enforced server-side,
- workspace/context isolation is verified,
- database changes are additive and documented,
- backup coverage includes new persistent state,
- audit evidence is preserved,
- backend syntax passes,
- backend tests pass,
- frontend tests pass,
- full lint passes,
- production build passes,
- dependency audit has no unreviewed high/critical finding,
- CI is green,
- mobile layout is checked,
- exports/PDFs are checked when affected,
- deployment succeeds,
- post-deploy smoke tests pass,
- documentation is updated,
- residual risk is stated honestly.

---

## 23. Common Failure Modes

### Old frontend after deployment

- confirm Cloudflare deployed the latest `main`,
- use `Ctrl + Shift + R`,
- open Incognito,
- close/reopen the installed PWA,
- inspect service-worker cache version.

### `API route not found`

- confirm Railway deployed latest `main`,
- inspect registration in `backend/server.js`,
- verify route ordering,
- verify frontend `VITE_API_URL`,
- check Railway logs.

### Redirect back to login

- inspect the API response code and error code,
- validate session and token version,
- verify workspace/category assignment,
- verify local stored workspace,
- verify the user is active,
- do not simply remove the 401 handler.

### Data appears from the wrong business

- inspect `X-Chalin03-Workspace`,
- inspect `X-Chalin03-Context-Id`,
- inspect Spare Parts branch headers,
- inspect category isolation middleware,
- inspect query filters,
- test with a second workspace user.

### Port `5000` already in use on Windows

```bat
netstat -ano | findstr :5000
taskkill /PID ACTUAL_PID /F
```

### Database error

- confirm the intended local or Railway database,
- inspect environment variable names,
- do not reset production,
- inspect migration status and schema verification,
- check Railway logs.

### Daily Closing mismatch

Review:

- payment allocations,
- voided/cancelled sales,
- debt collections,
- installment collections,
- expense funding source,
- refunds,
- post-closing changes,
- physical count,
- revision history,
- verifier identity.

Do not alter the formula merely to match an expected number.

### Export/PDF failure

- inspect the API response and Railway logs,
- verify required tables/columns,
- test sparse and populated records,
- inspect page-break logic,
- hard refresh after frontend deployment.

---

## 24. Security Posture and Residual Risks

Version Three includes:

- JWT verification,
- current server-side identity refresh,
- token-version revocation,
- server-side sessions,
- category isolation,
- effective permissions and explicit denies,
- protected-action windows,
- independent approval for sensitive actions,
- rate limiting,
- CORS allowlist,
- Helmet/API headers,
- Cloudflare security headers and HSTS,
- noindex protection for private routes,
- CodeQL security analysis,
- dependency audits,
- secret-shape scanning,
- passive production perimeter tests,
- system-wide backup and validation controls.

Known residual items:

1. Browser bearer-token storage remains in local storage. CSP, React escaping, session validation and token revocation reduce risk, but a future HttpOnly-cookie architecture would further reduce token theft impact from a hypothetical XSS defect.
2. ExcelJS has monitored moderate transitive UUID advisories. There are no known high or critical production dependency vulnerabilities. A breaking library change must be handled as a tested future release.
3. Non-destructive CI security checks do not replace an authorized external penetration test. Never perform credential stuffing, traffic flooding, destructive data mutation or third-party infrastructure exploitation against production.

Report suspected vulnerabilities privately. Do not place exploit details or secrets in a public issue.

---

## 25. Release and Version Rules

The current product identity is:

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

Do not change version strings independently. A version change requires coordinated backend/frontend metadata, tests, release notes and deployment verification.

Use Git tags for verified application releases where appropriate. A tag protects source history, not database contents.

---

## 26. AI Agent Handoff Template

When stopping work or handing to another agent, record:

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

Do not say “done” if deployment or required checks remain unverified.

---

## 27. Documentation Responsibilities

The in-app Help/User Guide is for operational users. This README is the engineering and AI-agent operating manual.

Update this README when changing:

- architecture,
- workspace boundaries,
- setup commands,
- environment variables,
- security controls,
- deployment process,
- database process,
- required checks,
- version identity,
- known residual risks.

Update in-app Help when changing how staff perform a task.

Do not append unordered release notes above the title. Keep the current operating truth near the top and preserve detailed historical material in `docs/` or Git history.

---

## 28. Ownership

Prepared by:

**Eugene Amankwah Appiah**

For:

**Chalin 03 Company Limited**

Location reference:

**Dunkwa Police Barrier, Ghana**

This repository controls a real business system. Protect the records, preserve the evidence and make every change reviewable.
