from pathlib import Path
import re


def replace_exact(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise SystemExit(f"{label} was not found exactly once.")
    return source.replace(old, new, 1)


def replace_pattern(
    source: str, pattern: re.Pattern[str], replacement: str, label: str
) -> str:
    updated, count = pattern.subn(replacement, source, count=1)
    if count != 1:
        raise SystemExit(f"{label} was not found exactly once.")
    return updated


def main() -> None:
    backend_path = Path("backend/routes/auditSignoffRoutes.js")
    frontend_path = Path("frontend/src/pages/AuditSignoffHistoryPage.jsx")
    expense_path = Path("backend/routes/expenseRoutes.js")
    operations_test_path = Path("backend/tests/operationsRouteReleaseContract.test.js")
    test_path = Path("backend/tests/auditSignoffExpenseImmutability.test.js")

    backend = backend_path.read_text(encoding="utf-8")
    frontend = frontend_path.read_text(encoding="utf-8")
    expense = expense_path.read_text(encoding="utf-8")
    operations_test = operations_test_path.read_text(encoding="utf-8")

    backend = replace_exact(
        backend,
        "Only admin or auditor can delete audit sign-offs.",
        "Only admin or auditor can request protected audit sign-off actions.",
        "Audit-signoff role message",
    )

    delete_route_pattern = re.compile(
        r'router\.delete\("/:id", requireAuth, requireAdmin, async \(req, res\) => \{[\s\S]*?\n\}\);\n\nmodule\.exports = router;',
        re.M,
    )
    immutable_route = '''router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const branchId = getBranchId(req);
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res
      .status(400)
      .json({ status: "error", message: "Invalid sign-off ID." });
  }

  await safeLogActivity(
    pool,
    getUserId(req),
    branchId,
    "BLOCK_DELETE_AUDIT_SIGNOFF",
    `Blocked physical deletion request for audit sign-off ID ${id}. Audit sign-offs are permanent compliance evidence and must be corrected through review, unlock and re-approval.`,
    getClientIp(req)
  );

  return res.status(409).json({
    status: "error",
    code: "AUDIT_SIGNOFF_IMMUTABLE",
    message:
      "Audit sign-offs are permanent compliance evidence and cannot be deleted. Create or update the corrected sign-off through the controlled review, unlock and re-approval process.",
  });
});

module.exports = router;'''
    backend = replace_pattern(
        backend,
        delete_route_pattern,
        immutable_route,
        "Audit-signoff physical DELETE route",
    )

    frontend = replace_pattern(
        frontend,
        re.compile(
            r'\n  async function deleteSignoff\(signoff\) \{[\s\S]*?\n  \}\n\n  return \(',
            re.M,
        ),
        "\n  return (",
        "Audit archive delete function",
    )

    frontend = replace_pattern(
        frontend,
        re.compile(
            r'Audit sign-off history, approval certificates, CSV exports and\s+delete actions are filtered to this selected store only\.'
        ),
        "Audit sign-off history, approval certificates and CSV exports are\n             filtered to this selected store. Sign-off records are permanent\n             compliance evidence and cannot be deleted.",
        "Audit archive store notice",
    )
    frontend = replace_pattern(
        frontend,
        re.compile(
            r'Each record below can be printed as a certificate, downloaded as a\s+Word file, or deleted by authorized management\.'
        ),
        "Each record below can be printed or downloaded and remains permanent\n               compliance evidence. Corrections must use the controlled review, unlock\n               and re-approval process.",
        "Audit archive record description",
    )

    immutable_badge = '''

                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        borderRadius: "999px",
                        padding: "10px 13px",
                        background: "#ecfdf5",
                        border: "1px solid #86efac",
                        color: "#166534",
                        fontWeight: "900",
                        fontSize: "12px",
                      }}
                    >
                      Permanent evidence
                    </span>'''
    frontend = replace_pattern(
        frontend,
        re.compile(
            r'\n\s*<button\n\s*type="button"\n\s*style=\{styles\.deleteButton\}\n\s*onClick=\{\(\) => deleteSignoff\(item\)\}\n\s*>\n\s*Delete\n\s*</button>',
            re.M,
        ),
        immutable_badge,
        "Audit archive Delete button",
    )

    expense = replace_pattern(
        expense,
        re.compile(
            r'\n// DELETE /api/expenses/:id[\s\S]*?\n\);\n\nmodule\.exports = router;',
            re.M,
        ),
        "\n\nmodule.exports = router;",
        "Legacy physical expense DELETE route",
    )

    operations_test = replace_exact(
        operations_test,
        '''  const expense = routeSection(
    readRoute("expenseRoutes.js"),
    "// POST /api/expenses\\nrouter.post(",
    "// DELETE /api/expenses/:id"
  );''',
        '''  const expense = routeSection(
    readRoute("expenseRoutes.js"),
    "// POST /api/expenses\\nrouter.post("
  );''',
        "Legacy expense route-boundary contract",
    )

    test_source = r'''const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.join(__dirname, "..");
const repositoryRoot = path.join(backendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

test("audit sign-offs remain immutable compliance evidence", () => {
  const routeSource = read("backend/routes/auditSignoffRoutes.js");
  const archiveSource = read("frontend/src/pages/AuditSignoffHistoryPage.jsx");

  assert.doesNotMatch(routeSource, /DELETE\s+FROM\s+audit_signoffs/i);
  assert.match(routeSource, /AUDIT_SIGNOFF_IMMUTABLE/);
  assert.match(routeSource, /BLOCK_DELETE_AUDIT_SIGNOFF/);
  assert.match(routeSource, /permanent compliance evidence/i);

  assert.doesNotMatch(archiveSource, /deleteSignoff/);
  assert.doesNotMatch(
    archiveSource,
    /axiosClient\.delete\(\s*`\/audit-signoffs\//
  );
  assert.doesNotMatch(
    archiveSource,
    /onClick=\{\(\) => deleteSignoff\(item\)\}/
  );
  assert.match(archiveSource, /Permanent evidence/);
  assert.match(archiveSource, /controlled review, unlock/);
});

test("legacy expense deletion cannot bypass the Phase 1 void ledger", () => {
  const expenseRouteSource = read("backend/routes/expenseRoutes.js");
  const reversalRouteSource = read("backend/routes/expenseReversalRoutes.js");
  const operationsContractSource = read(
    "backend/tests/operationsRouteReleaseContract.test.js"
  );

  assert.doesNotMatch(expenseRouteSource, /DELETE\s+FROM\s+expenses/i);
  assert.doesNotMatch(expenseRouteSource, /DELETE_EXPENSE/);
  assert.doesNotMatch(
    operationsContractSource,
    /\/\/ DELETE \/api\/expenses\/:id/
  );
  assert.match(reversalRouteSource, /EXPENSE_VOIDED/);
  assert.match(reversalRouteSource, /is_reversal/);
  assert.match(reversalRouteSource, /reversal_of_expense_id/);
  assert.match(reversalRouteSource, /INDEPENDENT_APPROVER_REQUIRED/);
});
'''

    backend_path.write_text(backend, encoding="utf-8")
    frontend_path.write_text(frontend, encoding="utf-8")
    expense_path.write_text(expense, encoding="utf-8")
    operations_test_path.write_text(operations_test, encoding="utf-8")
    test_path.write_text(test_source, encoding="utf-8")


if __name__ == "__main__":
    main()
