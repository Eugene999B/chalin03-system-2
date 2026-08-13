"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const service = require("../services/backupSafetyService");

const CURRENT_WARNING_PREFIX =
  "The current application has newer migrations than this backup.";

function currentMigrationWarning(markers = service.STAGING_RECOVERY_DATABASE_MARKERS) {
  return `${CURRENT_WARNING_PREFIX} Additive compatibility checks were applied: ${markers.join(", ")}.`;
}

test("runtime fallback recognizes all three staging markers only in the server-generated current-migration warning", () => {
  const bootstrap = require("../services/backupSafetyRecoveryBootstrap");

  assert.equal(
    bootstrap.currentMigrationWarningConfirmsStaging({
      warnings: [currentMigrationWarning()],
      errors: [],
    }),
    true
  );

  assert.equal(
    bootstrap.currentMigrationWarningConfirmsStaging({
      warnings: [
        currentMigrationWarning(
          service.STAGING_RECOVERY_DATABASE_MARKERS.slice(0, 2)
        ),
      ],
      errors: [],
    }),
    false
  );

  assert.equal(
    bootstrap.currentMigrationWarningConfirmsStaging({
      warnings: [],
      errors: [
        `Unknown backup migrations: ${service.STAGING_RECOVERY_DATABASE_MARKERS.join(", ")}.`,
      ],
    }),
    false,
    "Uploaded backup content must never be able to activate staging recovery."
  );
});

test("runtime fallback is installed exactly once", () => {
  const bootstrap = require("../services/backupSafetyRecoveryBootstrap");
  assert.equal(bootstrap.installBackupSafetyRecoveryMarkerFallback(), false);
});
