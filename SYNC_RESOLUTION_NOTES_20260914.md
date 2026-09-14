# Chalin One / Production conflict resolution — 2026-09-14

Production was merged as a parent commit. The following conflict files intentionally keep the Chalin One implementation because it is a tested superset of the production behavior rather than an older divergent implementation:

- backend/routes/backupRoutes.js
- backend/routes/delegatedBackupRoutes.js
- backend/services/backupSafetyService.js
- backend/services/backupSafetyService/index.js
- backend/tests/crossEnvironmentBackupRecovery.test.js
- frontend/src/main.jsx (future multi-surface loader and explicit no-auto-refresh policy)
- frontend/scripts/browserCacheHotfixTests.mjs (matches the future no-auto-refresh shell)
- backend/tests/equipmentFinanceOuterWorkspaceDeliveryContract.test.js (matches the future shell release contract)
- backend/tests/operationalApprovalCentreContract.test.js (matches the future shell release contract)

The remaining conflict files were reconciled to add the missing production security, runtime, API-routing, Finance, backup-UX, accessibility, regression-test and login-artwork standards while retaining future Chalin One behavior.
