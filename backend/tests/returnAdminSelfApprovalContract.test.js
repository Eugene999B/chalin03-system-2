const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Regression contract for the live Returns approval path.
const source = fs.readFileSync(
  path.resolve(__dirname, "..", "routes", "returnRoutes.js"),
  "utf8"
);

test("System Administrator can approve their own financial return while manager self-approval remains blocked", () => {
  assert.match(source, /const approverRole = String\(approver\.role \|\| ""\)\.toLowerCase\(\)/);
  assert.match(source, /const samePerson = Number\(approver\.id\) === Number\(currentUserId\)/);
  assert.match(source, /if \(samePerson && approverRole !== "admin"\)/);
  assert.match(source, /Only a System Administrator can approve their own financial refund/);
  assert.doesNotMatch(
    source,
    /if \(Number\(approver\.id\) === Number\(currentUserId\)\) \{\s*return \{ error: "The person recording the return cannot approve the same financial refund\." \};/
  );
});

test("Admin self-approval still requires active account, branch access and password verification", () => {
  assert.match(source, /Number\(approver\.is_active\) !== 1/);
  assert.match(source, /user_branch_access/);
  assert.match(source, /bcrypt\.compare\(password, approver\.password_hash\)/);
});
