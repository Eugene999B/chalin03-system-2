const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  BACKUP_MANIFEST_VERSION,
  BACKUP_TYPE,
  isCrossEnvironmentRecovery,
} = require("../services/backupSafetyService");

const repositoryRoot = path.resolve(__dirname, "../..");
const stagingRouteSource = fs.readFileSync(
  path.join(repositoryRoot, "backend/routes/stagingBackupRecoveryRoutes.js"),
  "utf8"
);
const canonicalRouteSource = fs.readFileSync(
  path.join(repositoryRoot, "backend/routes/backupRoutes.js"),
  "utf8"
);
const delegatedRouteSource = fs.readFileSync(
  path.join(repositoryRoot, "backend/routes/delegatedBackupRoutes.js"),
  "utf8"
);

function signedV2Shape() {
  return {
    backup_type: BACKUP_TYPE,
    version: BACKUP_MANIFEST_VERSION,
  };
}

test("verified staging recovery context works even when the process itself uses production mode", () => {
  assert.equal(
    isCrossEnvironmentRecovery(
      {
        backup: signedV2Shape(),
        requireSignature: false,
        allowAdditiveSchemaDrift: true,
        allowCrossEnvironmentRecovery: true,
      },
      {
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_NAME: "staging",
      }
    ),
    true
  );
});

test("an unverified production process cannot opt itself into staging recovery", () => {
  assert.equal(
    isCrossEnvironmentRecovery(
      {
        backup: signedV2Shape(),
        requireSignature: false,
        allowAdditiveSchemaDrift: true,
        allowCrossEnvironmentRecovery: true,
      },
      { NODE_ENV: "production" }
    ),
    false
  );
});

test("confirmed Railway production refuses cross-environment mode even if a caller passes the staging flag", () => {
  assert.equal(
    isCrossEnvironmentRecovery(
      {
        backup: signedV2Shape(),
        requireSignature: false,
        allowAdditiveSchemaDrift: true,
        allowCrossEnvironmentRecovery: true,
      },
      {
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_NAME: "production",
      }
    ),
    false
  );
});

test("verified staging recovery still requires additive schema mode", () => {
  assert.equal(
    isCrossEnvironmentRecovery(
      {
        backup: signedV2Shape(),
        requireSignature: false,
        allowAdditiveSchemaDrift: false,
        allowCrossEnvironmentRecovery: true,
      },
      { RAILWAY_ENVIRONMENT_NAME: "staging" }
    ),
    false
  );
});

test("the protected staging router owns the recovery opt-in and delegated restore reuses its successful preflight", () => {
  assert.match(stagingRouteSource, /allowCrossEnvironmentRecovery:\s*true/);
  assert.match(stagingRouteSource, /recoveryEnvironmentForRequest/);
  assert.match(stagingRouteSource, /signedV2StagingRecoveryAuthorized/);
  assert.match(stagingRouteSource, /stagingRecoveryValidation/);
  assert.doesNotMatch(canonicalRouteSource, /allowCrossEnvironmentRecovery/);
  assert.doesNotMatch(delegatedRouteSource, /allowCrossEnvironmentRecovery:\s*true/);
  assert.match(delegatedRouteSource, /req\.stagingRecoveryValidation/);
});
