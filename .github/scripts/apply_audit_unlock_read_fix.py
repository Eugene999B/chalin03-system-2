from pathlib import Path
import re

route_path = Path("backend/routes/auditUnlockRequestRoutes.js")
source = route_path.read_text(encoding="utf-8")

pattern = re.compile(
    r"async function columnExists\(connection, tableName, columnName\) \{[\s\S]*?\nfunction normalizeRequestArea\(value\) \{",
    re.MULTILINE,
)

replacement = '''async function ensureAuditUnlockRequestTable(connection = pool) {
  try {
    await connection.query(
      "SELECT 1 FROM audit_unlock_requests LIMIT 1"
    );
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") {
      const schemaError = new Error(
        "Audit unlock request storage is not ready. Apply the approved database migration before using this feature."
      );
      schemaError.code = "AUDIT_UNLOCK_SCHEMA_NOT_READY";
      throw schemaError;
    }

    throw error;
  }
}

function normalizeRequestArea(value) {'''

updated, count = pattern.subn(replacement, source, count=1)
if count != 1:
    raise SystemExit(f"Expected one audit unlock schema helper block, replaced {count}")

for forbidden in (
    "CREATE TABLE IF NOT EXISTS audit_unlock_requests",
    "ALTER TABLE `audit_unlock_requests`",
    "ALTER TABLE audit_unlock_requests",
    "MODIFY COLUMN request_area",
):
    if forbidden in updated:
        raise SystemExit(f"Request-time DDL remains in route source: {forbidden}")

route_path.write_text(updated, encoding="utf-8")

test_path = Path("backend/tests/auditUnlockRequestReadSafety.test.js")
test_path.write_text(
    '''const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const routePath = path.join(__dirname, "..", "routes", "auditUnlockRequestRoutes.js");
const source = fs.readFileSync(routePath, "utf8");

test("audit unlock request routes never perform request-time schema mutation", () => {
  const forbiddenPatterns = [
    /CREATE\\s+TABLE/i,
    /ALTER\\s+TABLE/i,
    /MODIFY\\s+COLUMN/i,
    /ADD\\s+COLUMN/i,
    /ADD\\s+INDEX/i,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(source), false, `Forbidden request-time DDL found: ${pattern}`);
  }
});

test("audit unlock request storage readiness check is read-only", () => {
  assert.match(
    source,
    /async function ensureAuditUnlockRequestTable\\(connection = pool\\)[\\s\\S]*SELECT 1 FROM audit_unlock_requests LIMIT 1/
  );
  assert.match(source, /AUDIT_UNLOCK_SCHEMA_NOT_READY/);
});

test("audit unlock request list accepts empty optional filters without changing SQL", () => {
  const listRouteStart = source.indexOf("// GET /api/audit-unlock-requests\\n");
  const mineRouteStart = source.indexOf("// GET /api/audit-unlock-requests/mine\\n");

  assert.notEqual(listRouteStart, -1);
  assert.notEqual(mineRouteStart, -1);

  const listRoute = source.slice(listRouteStart, mineRouteStart);
  assert.match(listRoute, /const params = \\[branchId\\]/);
  assert.match(listRoute, /if \\(status\\) \\{/);
  assert.match(listRoute, /if \\(search\\) \\{/);
  assert.match(listRoute, /await ensureAuditUnlockRequestTable\\(pool\\)/);
});
''',
    encoding="utf-8",
)

print("Applied read-only audit unlock request fix and regression test.")
