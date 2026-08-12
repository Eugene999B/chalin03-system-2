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

test("explicit trusted staging context works when NODE_ENV is production and Railway metadata is absent", () => {
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
    true
  );
});

test("ordinary production-mode validation stays strict without the trusted staging flag", () => {
  assert.equal(
    isCrossEnvironmentRecovery(
      {
        backup: signedV2Shape(),
        requireSignature: false,
        allowAdditiveSchemaDrift: true,
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

test("trusted staging recovery still requires unsigned-target validation plus additive schema mode", () => {
  assert.equal(
    isCrossEnvironmentRecovery(
      {
        backup: signedV2Shape(),
        requireSignature: true,
        allowAdditiveSchemaDrift: true,
        allowCrossEnvironmentRecovery: true,
      },
      { NODE_ENV: "production" }
    ),
    false
  );
  assert.equal(
    isCrossEnvironmentRecovery(
      {
        backup: signedV2Shape(),
        requireSignature: false,
        allowAdditiveSchemaDrift: false,
        allowCrossEnvironmentRecovery: true,
      },
      { NODE_ENV: "production" }
    ),
    false
  );
});

test("only the protected staging recovery router opts into trusted cross-environment recovery", () => {
  assert.match(stagingRouteSource, /allowCrossEnvironmentRecovery:\s*true/);
  assert.match(stagingRouteSource, /x-forwarded-host/);
  assert.doesNotMatch(canonicalRouteSource, /allowCrossEnvironmentRecovery/);
  assert.doesNotMatch(delegatedRouteSource, /allowCrossEnvironmentRecovery/);
});
