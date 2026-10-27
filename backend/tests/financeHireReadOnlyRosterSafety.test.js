"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const route = fs.readFileSync(path.join(__dirname, "../routes/equipmentDivisionAdminRoutes.js"), "utf8");
const frontend = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/EquipmentBusinessWorkforcePage.jsx"), "utf8");

test("read-only workforce list requires a valid permission and live business assignment", () => {
  const publicRead = route.slice(route.indexOf('router.get("/staff/directory"'), route.indexOf("router.use(requireSystemAdministrator);"));
  assert.match(publicRead, /requirePermission\("workers\.view"\)/);
  assert.match(publicRead, /uba\.can_access = TRUE/);
  assert.match(publicRead, /actor\.is_active = TRUE/);
  assert.match(publicRead, /actor\.primary_workspace_code = 'equipment_hire'/);
  assert.match(publicRead, /viewerTemplate\.permissions\.includes\("workers\.view"\)/);
  assert.match(publicRead, /person\.division === division/);
  assert.match(publicRead, /person\.division === EQUIPMENT_DIVISIONS\.BOTH/);
  assert.match(publicRead, /division === EQUIPMENT_DIVISIONS\.BOTH/);
  assert.doesNotMatch(publicRead, /password_hash|temporary_password|phone: person\.phone/);
  assert.match(publicRead, /mutations: "system_administrator_only"/);
});

test("staff mutation endpoints remain behind original System Administrator guard", () => {
  assert.ok(route.indexOf('router.get("/staff/directory"') < route.indexOf("router.use(requireSystemAdministrator);"));
  assert.ok(route.indexOf('router.use(requireSystemAdministrator);') < route.indexOf('router.post("/staff"'));
  assert.ok(route.indexOf('router.use(requireSystemAdministrator);') < route.indexOf('router.put("/staff/:userId"'));
});

test("staff directory UI fetches scoped results and does not enable role changes", () => {
  assert.match(frontend, /\$\{API\}\/staff\/directory/);
  assert.match(frontend, /ReadOnlyStaffRegister/);
  assert.match(frontend, /tab === "staff" && !isSystemAdministrator && canViewStaff/);
  assert.match(frontend, /tab === "staff" && isSystemAdministrator/);
});
