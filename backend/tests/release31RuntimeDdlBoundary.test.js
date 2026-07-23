const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");

const RUNTIME_SCHEMA_SENSITIVE_FILES = Object.freeze([
  "server.js",
  "routes/branchRoutes.js",
  "routes/settingsRoutes.js",
  "routes/systemRoutes.js",
  "routes/activityRoutes.js",
  "routes/release2FinalRoutes.js",
  "routes/biometricRoutes.js",
  "routes/equipmentCatalogueRoutes.js",
  "middleware/equipmentCatalogueIntegrityMiddleware.js",
  "middleware/equipmentSalesReadinessMiddleware.js",
  "services/accountRecoveryService.js",
  "services/accountSessionService.js",
  "services/auditTrailService.js",
  "services/branchSchemaReadinessService.js",
  "services/categoryIsolationService.js",
  "services/delegatedAdministrationService.js",
  "services/employmentDocumentSchemaService.js",
  "services/equipmentSalesSchemaService.js",
  "services/groupCommandCentreService.js",
  "services/groupConfigurationService.js",
  "services/passkeySchemaService.js",
  "services/permissionOverrideService.js",
  "services/workerHrLetterSchemaService.js",
  "services/workerIdentityService.js",
]);

function executableSource(relativePath) {
  return fs
    .readFileSync(path.join(backendRoot, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("mounted runtime paths never perform database definition changes", () => {
  const forbidden = [
    /CREATE\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW)/i,
    /ALTER\s+TABLE/i,
    /DROP\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW|DATABASE|SCHEMA)/i,
    /TRUNCATE\s+TABLE/i,
    /RENAME\s+TABLE/i,
  ];

  for (const relativePath of RUNTIME_SCHEMA_SENSITIVE_FILES) {
    const source = executableSource(relativePath);
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${relativePath} contains runtime DDL`);
    }
  }
});

test("only controlled deployment scripts may reference migration execution", () => {
  const server = executableSource("server.js");
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
  );

  assert.doesNotMatch(server, /runControlledMigrations|runControlledDeployment/);
  assert.match(packageJson.scripts.start, /^node scripts\/runControlledDeployment\.js --deployment/);
  assert.match(packageJson.scripts["migrate:apply"], /runControlledDeployment\.js --apply/);
});

test("ordinary GET routes do not seed database rows", () => {
  for (const relativePath of ["routes/branchRoutes.js", "routes/settingsRoutes.js"]) {
    const source = executableSource(relativePath);
    const getBlocks = source.split(/router\.get\(/).slice(1);
    for (const block of getBlocks) {
      const untilNextRoute = block.split(/router\.(?:get|post|put|patch|delete)\(/)[0];
      assert.doesNotMatch(untilNextRoute, /INSERT\s+INTO/i, relativePath);
      assert.doesNotMatch(untilNextRoute, /UPDATE\s+[A-Za-z_`]/i, relativePath);
      assert.doesNotMatch(untilNextRoute, /DELETE\s+FROM/i, relativePath);
    }
  }
});
