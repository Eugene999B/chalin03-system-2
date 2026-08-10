from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

service_path = ROOT / "backend/services/operationalApprovalService.js"
service = service_path.read_text(encoding="utf-8")
old = '''    if (Number(request.requested_by) === Number(getUserId(req))) {
      const error = new Error("The requester cannot approve their own action.");
      error.statusCode = 403;
      error.code = "SELF_APPROVAL_FORBIDDEN";
      throw error;
    }
'''
new = '''    const selfApproval =
      Number(request.requested_by) === Number(getUserId(req));
    const adminReturnSelfApproval =
      selfApproval &&
      getRole(req) === "admin" &&
      request.approval_kind === "return_refund";

    if (selfApproval && !adminReturnSelfApproval) {
      const error = new Error("The requester cannot approve their own action.");
      error.statusCode = 403;
      error.code = "SELF_APPROVAL_FORBIDDEN";
      throw error;
    }
'''
if service.count(old) != 1:
    raise SystemExit(f"Expected one approval self-guard, found {service.count(old)}")
service = service.replace(old, new, 1)
old_audit = '''      details: `${request.request_code} approved by ${reviewer.username}; protected action execution started.`,
'''
new_audit = '''      details: `${request.request_code} approved by ${reviewer.username}${
        adminReturnSelfApproval ? " (administrator self-approved return/refund)" : ""
      }; protected action execution started.`,
'''
if service.count(old_audit) != 1:
    raise SystemExit("Approval audit detail contract changed unexpectedly")
service = service.replace(old_audit, new_audit, 1)
service_path.write_text(service, encoding="utf-8")

test_path = ROOT / "backend/tests/operationalApprovalCentreContract.test.js"
test = test_path.read_text(encoding="utf-8")
old_test = '''test("only another active administrator may approve and their password is verified", () => {
  const service = read("backend/services/operationalApprovalService.js");

  assert.match(service, /getRole\\(req\\) !== "admin"/);
  assert.match(service, /request\\.requested_by.*getUserId\\(req\\)/s);
  assert.match(service, /bcrypt\\.compare/);
  assert.match(service, /SELF_APPROVAL_FORBIDDEN/);
  assert.match(service, /userCanAccessBranch/);
});
'''
new_test = '''test("administrator may self-approve only return refunds and password verification remains mandatory", () => {
  const service = read("backend/services/operationalApprovalService.js");

  assert.match(service, /getRole\\(req\\) !== "admin"/);
  assert.match(service, /const selfApproval =[\\s\\S]*request\\.requested_by[\\s\\S]*getUserId\\(req\\)/);
  assert.match(service, /const adminReturnSelfApproval =[\\s\\S]*getRole\\(req\\) === "admin"[\\s\\S]*request\\.approval_kind === "return_refund"/);
  assert.match(service, /if \\(selfApproval && !adminReturnSelfApproval\\)/);
  assert.match(service, /SELF_APPROVAL_FORBIDDEN/);
  assert.match(service, /bcrypt\\.compare/);
  assert.match(service, /userCanAccessBranch/);
  assert.match(service, /administrator self-approved return\\/refund/);
});
'''
if test.count(old_test) != 1:
    raise SystemExit(f"Expected old approval contract once, found {test.count(old_test)}")
test = test.replace(old_test, new_test, 1)
test_path.write_text(test, encoding="utf-8")

print("Return admin self-approval hotfix applied")
