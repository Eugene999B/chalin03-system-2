const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");

function readBackend(relativePath) {
  return fs.readFileSync(
    path.join(backendRoot, relativePath),
    "utf8"
  );
}

function readProject(relativePath) {
  return fs.readFileSync(
    path.join(projectRoot, relativePath),
    "utf8"
  );
}

test("Release 3 Group Configuration migration is additive", () => {
  const migration = readProject(
    "database/migrations/20260716_release3_group_command_configuration.sql"
  );

  for (const table of [
    "group_configuration",
    "group_configuration_history",
    "document_sequences",
    "document_sequence_history",
  ]) {
    assert.match(
      migration,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`)
    );
  }

  assert.match(
    migration,
    /release3_group_command_configuration/
  );

  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
  assert.doesNotMatch(
    migration,
    /\bDELETE\s+FROM\s+(sales|products|customers|debts|expenses|purchases|users)\b/i
  );
});

test("Group Configuration rejects secrets and records history", () => {
  const service = readBackend(
    "services/groupConfigurationService.js"
  );

  assert.match(service, /SECRET_KEY_PATTERN/);
  assert.match(service, /SECRET_CONFIGURATION_FORBIDDEN/);
  assert.match(service, /group_configuration_history/);
  assert.match(service, /document_sequence_history/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /nextDocumentNumber/);
});

test("Configuration changes require protected actions and ledger evidence", () => {
  const route = readBackend(
    "routes/groupConfigurationRoutes.js"
  );

  assert.match(route, /requireProtectedAction/);
  assert.match(route, /security\.admin/);
  assert.match(route, /GROUP_CONFIGURATION_CHANGED/);
  assert.match(route, /DOCUMENT_SEQUENCE_CHANGED/);
  assert.match(route, /appendLedger/);
  assert.match(route, /writeAuditEvent/);
});

test("Command Centre includes security backup workforce and health", () => {
  const service = readBackend(
    "services/groupCommandCentreService.js"
  );

  for (const marker of [
    "owner_security",
    "locked_accounts",
    "active_sessions",
    "latest_backup_age_hours",
    "expiring_documents",
    "expiring_licenses",
    "overdue_property_returns",
    "failed_owner_logins_24h",
    "application_errors_24h",
  ]) {
    assert.match(service, new RegExp(marker));
  }
});

test("Executive API and page expose Group Command Centre", () => {
  const route = readBackend(
    "routes/groupExecutiveRoutes.js"
  );

  const page = readProject(
    "frontend/src/pages/GroupExecutiveControlPage.jsx"
  );

  assert.match(route, /loadGroupCommandCentreSummary/);
  assert.match(route, /summary\.command_centre/);
  assert.match(page, /Group Command Centre/);
  assert.match(page, /Owner protection/);
  assert.match(page, /Latest backup age/);
});

test("Server, router and navigation register Group Configuration", () => {
  const server = readBackend("server.js");
  const app = readProject("frontend/src/App.jsx");

  const layout = readProject(
    "frontend/src/layouts/GroupExecutiveLayout.jsx"
  );

  const page = readProject(
    "frontend/src/pages/GroupConfigurationPage.jsx"
  );

  assert.match(server, /groupConfigurationRoutes/);
  assert.match(server, /\/api\/group-configuration/);
  assert.match(app, /GroupConfigurationPage/);
  assert.match(app, /path="configuration"/);
  assert.match(layout, /Group Configuration/);
  assert.match(page, /secrets.*never/i);
  assert.match(page, /X-Protected-Action-Token/);
});

test("Professional Backup covers new configuration tables", () => {
  const source = readBackend(
    "routes/release2FinalRoutes.js"
  );

  for (const table of [
    "group_configuration",
    "group_configuration_history",
    "document_sequences",
    "document_sequence_history",
  ]) {
    assert.match(source, new RegExp(table));
  }
});