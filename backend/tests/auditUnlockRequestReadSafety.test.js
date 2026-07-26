const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// This contract prevents read endpoints from silently reintroducing production DDL.
const routePath = path.join(__dirname, "..", "routes", "auditUnlockRequestRoutes.js");
const source = fs.readFileSync(routePath, "utf8");

test("audit unlock request routes never perform request-time schema mutation", () => {
  const forbiddenPatterns = [
    /CREATE\s+TABLE/i,
    /ALTER\s+TABLE/i,
    /MODIFY\s+COLUMN/i,
    /ADD\s+COLUMN/i,
    /ADD\s+INDEX/i,
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(source), false, `Forbidden request-time DDL found: ${pattern}`);
  }
});

test("audit unlock request storage readiness check is read-only", () => {
  assert.match(
    source,
    /async function ensureAuditUnlockRequestTable\(connection = pool\)[\s\S]*SELECT 1 FROM audit_unlock_requests LIMIT 1/
  );
  assert.match(source, /AUDIT_UNLOCK_SCHEMA_NOT_READY/);
});

test("audit unlock request list accepts empty optional filters without changing SQL", () => {
  const listRouteStart = source.indexOf("// GET /api/audit-unlock-requests\n");
  const mineRouteStart = source.indexOf("// GET /api/audit-unlock-requests/mine\n");

  assert.notEqual(listRouteStart, -1);
  assert.notEqual(mineRouteStart, -1);

  const listRoute = source.slice(listRouteStart, mineRouteStart);
  assert.match(listRoute, /const params = \[branchId\]/);
  assert.match(listRoute, /if \(status\) \{/);
  assert.match(listRoute, /if \(search\) \{/);
  assert.match(listRoute, /await ensureAuditUnlockRequestTable\(pool\)/);
});
