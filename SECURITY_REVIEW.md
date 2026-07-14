# Security Review

PASS - no Railway, Cloudflare, commit, push or deploy operation was added.

PASS - destructive database tooling refuses non-local hosts, Railway-like names and database names not ending in `_test`.

PASS - web restore is disabled unless `ALLOW_WEB_RESTORE=true`.

PASS - JWT token version is checked on authenticated requests.

PASS - disabled users are rejected by auth middleware.

PASS - audit CSV export escapes spreadsheet formula-leading values.

PASS - the public SMS environment debug route was removed from `server.js` and from the public route index.

PASS - public readiness no longer returns database name or missing configuration names; detailed diagnostics remain behind `system.diagnostics`.

PASS - legacy JSON error responses are sanitized centrally before leaving the server.

PASS - Audit Trail search/export applies server-side assignment scope and does not trust query IDs to widen access.

PASS - dependency audit executed. Frontend has 0 vulnerabilities. Backend has 2 moderate advisories via `exceljs -> uuid`; npm offered only a semver-major downgrade to `exceljs@3.4.0`, so no automatic breaking dependency change was applied.

REVIEW NOTE - legacy frontend pages still contain some `window.confirm` and `window.prompt` calls from earlier workflows. New final-stage Backup restore uses typed confirmation plus dry-run validation without browser prompts.
