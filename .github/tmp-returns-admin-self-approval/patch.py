from pathlib import Path

root = Path(__file__).resolve().parents[2]
return_path = root / "backend/routes/returnRoutes.js"
test_path = root / "backend/tests/cashControlSecurity.test.js"
contract_path = root / "backend/tests/returnAdminSelfApprovalContract.test.js"

source = return_path.read_text(encoding="utf-8")
old = '''  if (!["admin", "manager"].includes(String(approver.role || "").toLowerCase())) {
    return { error: "Refund approver must be an active administrator or manager." };
  }
  if (Number(approver.id) === Number(currentUserId)) {
    return { error: "The person recording the return cannot approve the same financial refund." };
  }
'''
new = '''  const approverRole = String(approver.role || "").toLowerCase();
  if (!["admin", "manager"].includes(approverRole)) {
    return { error: "Refund approver must be an active administrator or manager." };
  }

  const samePerson = Number(approver.id) === Number(currentUserId);
  if (samePerson && approverRole !== "admin") {
    return {
      error: "Only a System Administrator can approve their own financial refund.",
    };
  }
'''
if source.count(old) != 1:
    raise SystemExit(f"returnRoutes target count was {source.count(old)}, expected 1")
return_path.write_text(source.replace(old, new, 1), encoding="utf-8")

tests = test_path.read_text(encoding="utf-8")
old_test = '''test("Financial returns require exact refund channel and independent approval", () => {
  assert.match(returnsSource, /allowedReturnTypes = new Set\\(\\["stock_only", "refund"\\]\\)/);
  assert.match(returnsSource, /Refund approver must be an active administrator or manager/);
  assert.match(returnsSource, /cannot approve the same financial refund/);
  assert.match(returnsSource, /refund_reference/);
  assert.match(returnsSource, /markClosingStale/);
  assert.match(migrationSource, /refund_method.*ENUM\\('none','cash','momo','bank','other'\\)/s);
});
'''
new_test = '''test("Financial returns require exact refund channel and protected approval", () => {
  assert.match(returnsSource, /allowedReturnTypes = new Set\\(\\["stock_only", "refund"\\]\\)/);
  assert.match(returnsSource, /Refund approver must be an active administrator or manager/);
  assert.match(returnsSource, /const samePerson = Number\\(approver\\.id\\) === Number\\(currentUserId\\)/);
  assert.match(returnsSource, /samePerson && approverRole !== "admin"/);
  assert.match(returnsSource, /Only a System Administrator can approve their own financial refund/);
  assert.match(returnsSource, /refund_reference/);
  assert.match(returnsSource, /markClosingStale/);
  assert.match(migrationSource, /refund_method.*ENUM\\('none','cash','momo','bank','other'\\)/s);
});
'''
if tests.count(old_test) != 1:
    raise SystemExit(f"cashControl test target count was {tests.count(old_test)}, expected 1")
test_path.write_text(tests.replace(old_test, new_test, 1), encoding="utf-8")

contract_path.write_text('''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "routes", "returnRoutes.js"),
  "utf8"
);

test("System Administrator can approve their own financial return while manager self-approval remains blocked", () => {
  assert.match(source, /const approverRole = String\\(approver\\.role \\|\\| ""\\)\\.toLowerCase\\(\\)/);
  assert.match(source, /const samePerson = Number\\(approver\\.id\\) === Number\\(currentUserId\\)/);
  assert.match(source, /if \\(samePerson && approverRole !== "admin"\\)/);
  assert.match(source, /Only a System Administrator can approve their own financial refund/);
  assert.doesNotMatch(
    source,
    /if \\(Number\\(approver\\.id\\) === Number\\(currentUserId\\)\\) \\{\\s*return \\{ error: "The person recording the return cannot approve the same financial refund\\." \\};/
  );
});

test("Admin self-approval still requires active account, branch access and password verification", () => {
  assert.match(source, /Number\\(approver\\.is_active\\) !== 1/);
  assert.match(source, /user_branch_access/);
  assert.match(source, /bcrypt\\.compare\\(password, approver\\.password_hash\\)/);
});
''', encoding="utf-8")

print("Admin return self-approval hotfix applied.")
