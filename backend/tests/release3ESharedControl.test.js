const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Release 3E migration is additive and preserves production data", () => {
  const sql = read(
    "database/migrations/20260718_release3e_shared_reports_documents_roles_audit.sql"
  );
  const verify = read(
    "database/migrations/20260718_release3e_shared_reports_documents_roles_audit_verify.sql"
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS shared_control_evidence/i);
  assert.match(sql, /20260718_release3e_shared_reports_documents_roles_audit/);
  assert.match(sql, /mining_site_id/);
  assert.match(sql, /hire_location_id/);
  assert.match(sql, /request_id/);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|DATABASE)\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /^\s*USE\s+/im);

  assert.match(verify, /invalid_branch_scope_count/);
  assert.match(verify, /invalid_mining_scope_count/);
  assert.match(verify, /invalid_hire_scope_count/);
  assert.match(verify, /invalid_action_count/);
  assert.match(verify, /invalid_workspace_scope_count/);
  assert.match(verify, /metadata_json/);
});

test("Shared Control routes require explicit permissions and controlled actions", () => {
  const source = read("backend/routes/sharedControlRoutes.js");
  assert.match(source, /requirePermission\("shared\.control\.view"\)/);
  assert.match(source, /requireAnyPermission\(/);
  assert.match(source, /"shared\.audit\.view"/);
  assert.match(source, /"shared\.documents\.view"/);
  assert.match(source, /"shared\.reports\.view"/);
  assert.match(source, /INVALID_SHARED_EVIDENCE_ACTION/);
  assert.match(source, /allowedActions/);
  assert.match(source, /allowedAreas/);
});

test("Shared evidence preserves workspace, branch, site and location isolation", () => {
  const source = read("backend/services/sharedControlService.js");
  assert.match(source, /workspace_code = \?/);
  assert.match(source, /branch_id = \?/);
  assert.match(source, /mining_site_id = \?/);
  assert.match(source, /hire_location_id = \?/);
  assert.match(source, /user_mining_site_access/);
  assert.match(source, /user_hire_location_access/);
  assert.match(source, /executive\.operations\.view/);
  assert.doesNotMatch(
    source,
    /groupMode[\s\S]{0,500}permissions\.has\("shared\.audit\.view"\)/
  );
  assert.match(source, /read_only: role === "auditor"/);
  assert.match(source, /sanitizeMetadata/);
});

test("Release 3E permissions and UI are registered across all workspaces", () => {
  const permissions = read("backend/security/permissionCatalog.js");
  const frontendPermissions = read("frontend/src/security/permissionRules.js");
  const server = read("backend/server.js");
  const app = read("frontend/src/App.jsx");
  const spare = read("frontend/src/components/Layout.jsx");
  const mining = read("frontend/src/layouts/MiningLayout.jsx");
  const hire = read("frontend/src/layouts/EquipmentHireLayout.jsx");
  const group = read("frontend/src/layouts/GroupExecutiveLayout.jsx");
  const page = read("frontend/src/pages/SharedReportsDocumentsPage.jsx");

  for (const permission of [
    "shared.control.view",
    "shared.documents.view",
    "shared.reports.view",
    "shared.reports.export",
    "shared.audit.view",
  ]) {
    assert.match(permissions, new RegExp(permission.replaceAll(".", "\\.")));
  }

  assert.match(frontendPermissions, /SHARED_CONTROL_PERMISSIONS/);
  assert.match(server, /sharedControlRoutes/);
  assert.match(server, /\/api\/shared-control/);
  assert.match(app, /SharedReportsDocumentsPage/);
  assert.match(app, /path="shared-controls"/);
  assert.match(spare, /\/shared-controls/);
  assert.match(mining, /\/mining\/shared-controls/);
  assert.match(hire, /\/equipment-hire-operations\/shared-controls/);
  assert.match(group, /\/group-executive-control\/shared-controls/);
  assert.match(page, /Authorized document register/);
  assert.match(page, /Role & scope assurance/);
  assert.match(page, /Document, report & export evidence/);
  assert.doesNotMatch(page, /selectedBranch|store_id/);
});

test("Existing document and report downloads write Release 3E evidence", () => {
  const documents = read("backend/routes/operationsDocumentRoutes.js");
  const executive = read("backend/routes/groupExecutiveRoutes.js");
  const activity = read("backend/routes/activityRoutes.js");

  assert.match(documents, /writeSharedControlEvidence/);
  assert.match(
    documents,
    /requireAnyPermission\("operations\.documents\.view", "shared\.documents\.view"\)/
  );
  assert.match(
    documents,
    /requireAnyPermission\("shared\.reports\.export", "exports\.download"\)/
  );
  assert.match(documents, /controlArea: "documents"/);
  assert.match(documents, /evidence_action/);
  assert.match(documents, /actionType: evidenceAction/);
  assert.match(executive, /documentType: "group_executive_workbook"/);
  assert.match(activity, /logAuditExport/);
  for (const format of ["xlsx", "pdf", "doc", "csv"]) {
    assert.match(activity, new RegExp(`logAuditExport\\(req, "${format}"`));
  }
});

test("Professional backups dynamically include Release 3E audit evidence", () => {
  const backup = read("backend/routes/backupRoutes.js");
  const safety = read("backend/services/backupSafetyService.js");
  const professional = read("backend/routes/release2FinalRoutes.js");
  assert.match(professional, /"shared_control_evidence"/);
  assert.match(backup, /getAllBaseTables/);
  assert.match(backup, /classifyDatabaseTables/);
  assert.match(safety, /currentIncludedTables/);
  assert.match(safety, /Backup is missing current required tables/);
  assert.doesNotMatch(backup, /const PREFERRED_TABLE_ORDER/);
});
