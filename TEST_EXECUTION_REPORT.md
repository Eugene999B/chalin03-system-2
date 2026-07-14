# Test Execution Report

Generated from corrected v2 local verification on 2026-07-14.

PASS - one-command local acceptance wrapper executed:

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\run_full_local_acceptance.ps1 -SkipDatabase`

PASS - deterministic dependency install executed through the wrapper. `npm ci` was used when package lockfiles were present.

PASS - backend syntax - independent v3 review checked 64 backend JavaScript files.

PASS - backend unit/security tests - independent v3 review executed 34 Node tests; 34 passed, 0 failed. Added v2 coverage includes explicit Mining/Hire/Fleet route guards, role-scenario permission boundaries, audit context scoping, audit result scope guards, safe legacy error response sanitization, metadata redaction, removed public SMS debug route, permission catalog and route permission mapping.

PASS - frontend tests - `npm.cmd test` executed source checks and permission routing/action tests for site supervisor, equipment operator, site clerk, Mining accountant, hire officer, dispatcher, fleet officer, Hire accountant, auditor and cashier-denied scenarios.

PASS - frontend production build - `npm.cmd run build` completed with Vite. Vite reported a large bundle warning only. Output bundle observed: `dist/assets/index-BTL-Cndy.js` at about 1.28 MB before gzip.

PASS - local-only safety - verification did not connect to Railway or Cloudflare, deploy, commit, push or reset `chalin03_db`.

PASS - frontend dependency audit - 0 vulnerabilities.

NOT RUN - backend dependency audit clean pass. Actual result: 2 moderate advisories remain through `exceljs -> uuid`; npm only offers a semver-major downgrade to `exceljs@3.4.0`, so no automatic breaking change was applied.

PASS - secret scan through the wrapper - no `.env` files were found under source.

PASS - local destructive helper review. Guarded or existing-admin paths are documented:

- guarded local `_test` tooling: `tools/run_full_local_acceptance.ps1`, `tools/cleanup_full_test_database.ps1`, `backend/scripts/restoreBackupToLocalTestDb.js`;
- guarded backup restore path: `backend/routes/backupRoutes.js`, behind auth, admin permission and `ALLOW_WEB_RESTORE=true`;
- existing local/admin maintenance and business mutation paths: user deletion, sale edit item replacement, expense delete, audit signoff delete and maintenance clear-data route.

NOT RUN - destructive `_test` database/API acceptance in this Codex run. Exact reason: the v2 correction run used `-SkipDatabase`; no explicit `-ConfirmLocalTestDatabase` confirmation or local MySQL credentials were provided. The corrected runner now uses Node/mysql2, refuses non-local or non-`_test` targets, loads `schema.sql` with delimiter-aware SQL execution, applies and verifies every listed migration path, seeds final-schema fixtures and runs Express API role checks when database testing is enabled.

NOT RUN - real restore into `_test` in this Codex run. Exact reason: no backup file and no explicit `-ConfirmLocalTestDatabase` were provided for the restore tool. `tools/test_restore_on_local_test_db.ps1` now uses the Node/mysql2 restore implementation without requiring `mysql.exe`, validates backup table identifiers against the loaded schema, verifies checksum, row counts, representative rows, `CHECK TABLE` status and foreign-key references against only a confirmed local `_test` database.

PASS - independent v3 verification-runner regression tests: zero-count integrity summaries no longer fail, while real issue rows still fail.
