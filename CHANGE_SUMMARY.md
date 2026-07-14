# Change Summary

Completed local-only final package additions for Stages 6B to 6F:

- central permission catalog and middleware;
- workspace/site/location route guards;
- structured searchable audit trail and CSV export;
- backup manifest/checksum, dry-run validation and web-restore gate;
- health, readiness and admin diagnostics;
- request IDs and centralized safe error handling;
- login lockout and token revocation;
- Helmet, rate limits, safer CORS defaults and CSV formula escaping;
- frontend System Operations and structured Audit Trail pages;
- idempotent migrations, verification SQL, tools, tests and documentation.

Spare Parts receipt motto `IN GOD, WE TRUST` is preserved.

Correction after independent review:

- frontend Mining, Equipment Hire and Fleet routes now use permission codes instead of only global roles;
- specialist workspace roles have executable frontend permission tests;
- Audit Trail results and CSV export are scoped by the authenticated user's branch, Mining site or Hire location assignment;
- public SMS debug endpoint was removed and public readiness was sanitized;
- safe response middleware now strips technical fields from legacy error JSON;
- critical Mining, Hire, Fleet, backup/restore, user/admin and Spare Parts sale/product/purchase/debt/return/closing helpers now use structured audit events;
- `server.js` exports the Express app for tests without auto-listening on import;
- guarded restore and local database acceptance tooling now performs real `_test`-database validation when confirmed.
