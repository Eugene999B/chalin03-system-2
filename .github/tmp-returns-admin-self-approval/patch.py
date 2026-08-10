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

tests = test_path.read_text(encoding="utf-8")n