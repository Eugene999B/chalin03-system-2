# Route Security Inventory

This inventory covers the corrected v2 package after the second independent review.

## Public Read-Only Routes

- `GET /` - public liveness banner only.
- `GET /api` - public route index; no debug endpoints listed.
- `GET /api/health` - public health; returns service, version, uptime, time and request ID.
- `GET /api/readiness` - public readiness; returns only coarse database/schema/configuration status.
- `GET /api/branches` - public store list used before login.

## Authentication And Account Routes

- `POST /api/auth/login` - login rate limiter, failed-attempt lockout, disabled-account check, workspace access enforcement, token version in JWT.
- `GET /api/auth/me` - authenticated, token version and active-user check in `requireAuth`.
- `POST /api/auth/change-password` - authenticated, strong password policy, token revocation through `token_version`.
- User and workspace password/status changes - authenticated administrator paths; token version increments invalidate old sessions.

## Permission-Protected System Routes

- `GET /api/system/diagnostics` - `requireAuth` plus `system.diagnostics`; detailed DB/config/SMS/permission catalog is available only here.
- `/api/backups/*` - authenticated administrator paths. Restore requires `ALLOW_WEB_RESTORE=true`, dry-run validation, manifest/checksum validation and transaction restore.
- `/api/activity-log` and `/api/activity-log/export.csv` - `audit.view`/`audit.export`; results are scoped by authenticated branch, Mining site or Hire location assignment.

## Spare Parts Mutation Families

- Products, purchases, sales, debts, returns, expenses, stock transfers, daily closing, audit signoffs, unlock requests and maintenance routes retain existing auth/role/branch checks to preserve stable behavior.
- Critical sales create/edit/void, product, purchase, expense, debt, return and daily closing helper paths now write structured audit rows through `writeAuditEvent`.
- CSV/export paths use formula escaping where added for the corrected audit/export path.

## Mining Routes

- `/api/mining/*` uses `requireAuth`, Mining workspace assertion, Mining site scope enforcement and explicit permission middleware on every route declaration.
- `GET /dashboard` accepts any legitimate Mining operational view permission.
- Read routes require exact `mining.*.view` permissions.
- Mutation routes require exact create/manage/approve permissions such as `mining.daily_logs.create`, `mining.daily_logs.approve`, `mining.equipment_logs.create`, `mining.expenses.manage` and `mining.expenses.approve`.
- No `requireRole(...)` or broad `requireWorkspaceRoutePermission(...)` guard remains in the Mining route tree.
- Structured audit rows include `workspace_code='mining'`, request ID and Mining site context.

## Equipment Hire Routes

- `/api/equipment-hire/*` uses `requireAuth`, Hire location scope enforcement and explicit permission middleware on every route declaration.
- `GET /dashboard` accepts any legitimate Hire operational view permission.
- `GET /availability` requires `fleet.assets.view`.
- Contract asset add/remove before dispatch requires `hire.contracts.manage`.
- Mutation routes require exact permissions for customers, enquiries, quotations, contracts, dispatch, work logs, invoices, payments and returns.
- Operational closure is `PATCH /contracts/:id/close` with `hire.contracts.close_operational`; financial closure is `PATCH /contracts/:id/financial-close` with `hire.contracts.close_financial`.
- No `requireRole(...)` or broad `requireWorkspaceRoutePermission(...)` guard remains in the Equipment Hire route tree.
- Structured audit rows include `workspace_code='equipment_hire'`, request ID and Hire location context.

## Fleet Routes

- `/api/fleet/*` uses `requireAuth` plus explicit permission middleware on every route declaration.
- `GET /summary`, `GET /assets` and `GET /assets/:id` require `fleet.assets.view`.
- Asset create/edit/status/archive routes require `fleet.assets.manage`.
- Nested actions require exact permissions: meter readings `fleet.meter.manage`, fuel logs `fleet.fuel.manage`, maintenance `fleet.maintenance.manage` and inspections `fleet.inspections.manage`.
- No `requireRole(...)` or broad `requireWorkspaceRoutePermission(...)` guard remains in the Fleet route tree.
- Structured audit rows include request ID and fleet entity context.

## Central Error And Request-ID Handling

- Every request receives a request ID.
- Central error handler records safe application errors.
- Safe response middleware strips `technical_message`, `stack` and 5xx `details` from legacy route responses and attaches `request_id`.
