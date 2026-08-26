const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

const route = read("../routes/customerStatementRoutes.js");
const editor = read("../../frontend/src/components/CustomerIdentityEditor.jsx");
const navigation = read("../../frontend/src/components/CompactSidebarNavigation.jsx");

test("customer identity editor is branch-scoped and manager/admin protected", () => {
  assert.match(route, /router\.get\("\/identity-editor"/);
  assert.match(route, /router\.put\(\s*"\/identity-editor\/customer\/:id"/s);
  assert.match(route, /router\.put\(\s*"\/identity-editor\/legacy"/s);
  assert.match(route, /requireRole\("admin", "manager"\)/);
  assert.match(route, /WHERE c\.branch_id = \?/);
  assert.match(route, /WHERE id = \? AND branch_id = \?/);
  assert.match(route, /WHERE branch_id = \?/);
});

test("customer identity editor requires a real two-part name and phone number", () => {
  assert.match(route, /nameParts\.length < 2/);
  assert.match(route, /digits\.length < 7 \|\| digits\.length > 15/);
  assert.match(editor, /at least two separate customer names/);
  assert.match(editor, /7 to 15 digits/);
});

test("legacy identity cleanup promotes records into the customer master", () => {
  assert.match(route, /INSERT INTO customers \(branch_id, name, phone, location\)/);
  assert.match(route, /SET customer_id = \?,\s*customer_name = \?,\s*customer_phone = \?/s);
  assert.match(route, /LEGACY_CUSTOMER_NOT_FOUND/);
  assert.match(route, /CUSTOMER_PHONE_ALREADY_ASSIGNED/);
});

test("identity changes preserve financial records and leave an audit trail", () => {
  assert.match(route, /UPDATE customers/);
  assert.match(route, /UPDATE sales/);
  assert.match(route, /UPDATE debts/);
  assert.match(route, /action: "customer_identity\.updated"/);
  assert.match(route, /affected_sales/);
  assert.match(route, /affected_debts/);
  assert.match(route, /legacy_promoted/);
  assert.doesNotMatch(route, /DELETE FROM sales/);
  assert.doesNotMatch(route, /DELETE FROM debts/);
  assert.doesNotMatch(route, /TRUNCATE/);
});

test("both Debts and Customer Statement expose the same identity editor", () => {
  assert.match(editor, /location\.pathname === "\/debts"/);
  assert.match(editor, /location\.pathname === "\/customer-statement"/);
  assert.match(navigation, /CustomerIdentityEditor/);
  assert.match(editor, /Edit customer names/);
  assert.match(editor, /Only the customer name, phone number and location can be changed here/);
});
