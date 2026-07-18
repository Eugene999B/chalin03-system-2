const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Release 3D migration is additive and complete", () => {
  const sql = read("database/migrations/20260718_release3d_notifications_group_alerts.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_rules/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notifications/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_user_states/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_escalations/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_sync_runs/i);
  assert.match(sql, /20260718_release3d_notifications_group_alerts/);
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
  assert.doesNotMatch(sql, /TRUNCATE\s+TABLE/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
  assert.doesNotMatch(sql, /CREATE\s+DATABASE|DROP\s+DATABASE|USE\s+/i);
  assert.doesNotMatch(sql, /sms_allowed\s*=\s*VALUES\(sms_allowed\)/i);
});

test("Release 3D routes enforce permissions, user state and controlled SMS", () => {
  const source = read("backend/routes/notificationRoutes.js");
  assert.match(source, /requirePermission\("notifications\.view"\)/);
  assert.match(source, /requirePermission\("notifications\.sync"\)/);
  assert.match(source, /requirePermission\("notifications\.manage"\)/);
  assert.match(source, /requirePermission\("notifications\.escalate"\)/);
  assert.match(source, /NOTIFICATION_SMS_ENABLED/);
  assert.match(source, /SEND CRITICAL NOTIFICATION SMS/);
  assert.match(source, /notification_user_states/);
  assert.match(source, /notification_escalations/);
  assert.match(source, /NOTIFICATION_RULE_SCOPE_DENIED/);
  assert.match(source, /NOTIFICATION_SMS_RULE_ADMIN_REQUIRED/);
  assert.match(source, /archived: null/);
});

test("Notification service preserves workspace, site and location isolation", () => {
  const source = read("backend/services/notificationService.js");
  assert.match(source, /user_mining_site_access/);
  assert.match(source, /user_hire_location_access/);
  assert.match(source, /n\.branch_id IS NULL OR n\.branch_id = \?/);
  assert.match(source, /n\.mining_site_id IS NULL OR n\.mining_site_id = \?/);
  assert.match(source, /n\.hire_location_id IS NULL OR n\.hire_location_id = \?/);
  assert.match(source, /GET_LOCK\('chalin03_notification_sync'/);
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /connection\.commit\(\)/);
  assert.match(source, /connection\.rollback\(\)/);
  assert.match(source, /currentKeys = new Set\(\)/);
  assert.match(source, /Condition cleared by notification sync/);
  assert.match(source, /!groupScopeRequested && workspace === "spare_parts"/);
  assert.match(source, /!groupScopeRequested && workspace === "mining"/);
  assert.match(source, /!groupScopeRequested && workspace === "equipment_hire"/);
  assert.match(source, /mining\.incident_open/);
  assert.match(source, /hire\.invoice_overdue/);
  assert.match(source, /spare_parts\.low_stock/);
});

test("Release 3D is registered across API, layouts and route trees", () => {
  const server = read("backend/server.js");
  const app = read("frontend/src/App.jsx");
  const mining = read("frontend/src/layouts/MiningLayout.jsx");
  const hire = read("frontend/src/layouts/EquipmentHireLayout.jsx");
  const group = read("frontend/src/layouts/GroupExecutiveLayout.jsx");
  const spare = read("frontend/src/components/Layout.jsx");

  assert.match(server, /\/api\/notifications/);
  assert.match(server, /notificationRoutes/);
  assert.match(app, /NotificationCentrePage/);
  assert.match(app, /path="notifications"/);
  assert.match(mining, /\/mining\/notifications/);
  assert.match(hire, /\/equipment-hire-operations\/notifications/);
  assert.match(group, /\/group-executive-control\/notifications/);
  assert.match(spare, /path: "\/notifications"/);

  const page = read("frontend/src/pages/NotificationCentrePage.jsx");
  assert.match(page, /const isSystemAdmin = auth\.role === "admin"/);
  assert.match(page, /SMS escalation:/);
});

test("Professional backups and Group Command Centre include Release 3D evidence", () => {
  const backup = read("backend/routes/backupRoutes.js");
  const professional = read("backend/routes/release2FinalRoutes.js");
  const command = read("backend/services/groupCommandCentreService.js");

  for (const table of [
    "notification_rules",
    "notifications",
    "notification_user_states",
    "notification_escalations",
    "notification_sync_runs",
  ]) {
    assert.match(backup, new RegExp(`"${table}"`));
    assert.match(professional, new RegExp(`"${table}"`));
  }

  assert.match(command, /notification_centre/);
  assert.match(command, /critical_notifications/);
  assert.match(command, /\/group-executive-control\/notifications/);
});
