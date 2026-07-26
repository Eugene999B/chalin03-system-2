const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  findBlockingDependencies,
} = require("../services/workspaceContextDeletionService");

function read(...parts) {
  return fs.readFileSync(path.join(__dirname, "..", "..", ...parts), "utf8");
}

const miningRoute = read("backend", "routes", "miningRoutes.js");
const workspaceRoute = read("backend", "routes", "workspaceAdminRoutes.js");
const deletionService = read(
  "backend",
  "services",
  "workspaceContextDeletionService.js"
);
const miningPage = read("frontend", "src", "pages", "MiningOperationsPage.jsx");
const workspacePage = read(
  "frontend",
  "src",
  "pages",
  "WorkspaceAdministrationPage.jsx"
);

test("workspace context deletion discovers dependencies without disabling constraints", () => {
  assert.match(deletionService, /information_schema\.KEY_COLUMN_USAGE/);
  assert.match(deletionService, /REFERENTIAL_CONSTRAINTS/);
  assert.match(deletionService, /findBlockingDependencies/);
  assert.doesNotMatch(deletionService, /FOREIGN_KEY_CHECKS/i);
});

test("every linked business record protects its site or location regardless of delete rule", () => {
  const dependencies = [
    { table_name: "staff_access", count: 2, delete_rule: "CASCADE" },
    { table_name: "commercial_records", count: 1, delete_rule: "SET NULL" },
    { table_name: "operational_records", count: 3, delete_rule: "RESTRICT" },
    { table_name: "empty_records", count: 0, delete_rule: "NO ACTION" },
  ];

  assert.deepEqual(
    findBlockingDependencies(dependencies, ["staff_access"]).map(
      (dependency) => dependency.table_name
    ),
    ["commercial_records", "operational_records"]
  );
});

test("only the original System Administrator can remove sites and Hire locations", () => {
  assert.match(miningRoute, /router\.delete\("\/sites\/:id"/);
  assert.match(miningRoute, /isOriginalSystemAdministrator\(req\.user\)/);
  assert.match(workspaceRoute, /router\.delete\("\/locations\/:locationId"/);
  assert.match(workspaceRoute, /isOriginalSystemAdministrator\(req\.user\)/);
});

test("linked business history is archived while empty contexts can be deleted", () => {
  assert.match(miningRoute, /MINING_SITE_ARCHIVED_WITH_HISTORY/);
  assert.match(miningRoute, /EMPTY_MINING_SITE_DELETED/);
  assert.match(workspaceRoute, /HIRE_LOCATION_ARCHIVED_WITH_HISTORY/);
  assert.match(workspaceRoute, /EMPTY_HIRE_LOCATION_DELETED/);
  assert.match(miningRoute, /DELETE FROM user_mining_site_access/);
  assert.match(workspaceRoute, /DELETE FROM user_hire_location_access/);
});

test("administrator interfaces expose audited delete actions", () => {
  assert.match(miningPage, /Delete Site/);
  assert.match(miningPage, /axiosClient\.delete\(`\/mining\/sites\/\$\{site\.id\}`/);
  assert.match(workspacePage, /Delete location/);
  assert.match(
    workspacePage,
    /axiosClient\.delete\([\s\S]*`\/workspace-admin\/locations\/\$\{location\.id\}`/
  );
  assert.match(miningPage, /reason is written to the audit trail/);
  assert.match(workspacePage, /reason is written to the audit trail/);
});
