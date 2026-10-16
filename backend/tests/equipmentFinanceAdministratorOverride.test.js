const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routePath = path.join(
  __dirname,
  "../routes/equipmentFinanceAdministratorOverrideRoutes.js"
);
const source = fs.readFileSync(routePath, "utf8");
const {
  ADMIN_ROLES,
  isAdministrator,
} = require("../routes/equipmentFinanceAdministratorOverrideRoutes");

test("administrator roles receive the direct approval override", () => {
  for (const role of [
    "admin",
    "administrator",
    "system_admin",
    "system_administrator",
    "super_admin",
  ]) {
    assert.equal(ADMIN_ROLES.has(role), true);
    assert.equal(isAdministrator({ user: { role } }), true);
  }
});

test("manager roles continue through the standard review workflow", () => {
  assert.equal(isAdministrator({ user: { role: "manager" } }), false);
  assert.equal(isAdministrator({ user: { role: "finance_manager" } }), false);
});

test("administrator submit route records an audited direct approval", () => {
  assert.match(source, /credit-applications\/:id\/submit/);
  assert.match(source, /application_status = 'approved'/);
  assert.match(source, /administrator_override: true/);
  assert.match(source, /separate_manager_review_required: false/);
  assert.match(source, /if \(!isAdministrator\(req\)\) return next\(\)/);
});
