const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sarifPath = process.argv[2];

if (!sarifPath) {
  throw new Error("Usage: node verifyVersionThreeCodeqlSarif.js <javascript.sarif>");
}

const absoluteSarifPath = path.resolve(process.cwd(), sarifPath);
const sarif = JSON.parse(fs.readFileSync(absoluteSarifPath, "utf8"));
const results = sarif.runs?.flatMap((run) => run.results || []) || [];

const reviewedRules = new Set([
  "js/missing-rate-limiting",
  "js/user-controlled-bypass",
  "js/regex/missing-regexp-anchor",
]);

const reviewedBypassFiles = new Set([
  "backend/middleware/authMiddleware.js",
  "backend/routes/authRoutes.js",
  "backend/routes/expenseReversalRoutes.js",
  "backend/routes/returnRoutes.js",
  "backend/routes/saleRoutes.js",
]);

const counts = new Map();
const violations = [];

function locationFor(result) {
  const physical = result.locations?.[0]?.physicalLocation;
  return {
    uri: String(physical?.artifactLocation?.uri || "").replaceAll("\\", "/"),
    line: Number(physical?.region?.startLine || 0),
  };
}

for (const result of results) {
  const ruleId = String(result.ruleId || "unknown");
  const location = locationFor(result);
  counts.set(ruleId, Number(counts.get(ruleId) || 0) + 1);

  if (!reviewedRules.has(ruleId)) {
    violations.push(`Unreviewed CodeQL rule ${ruleId} at ${location.uri}:${location.line}`);
    continue;
  }

  if (ruleId === "js/missing-rate-limiting") {
    const isBackendRoute =
      location.uri === "backend/server.js" ||
      location.uri.startsWith("backend/routes/");
    if (!isBackendRoute) {
      violations.push(
        `Rate-limiting result appeared outside the reviewed API surface at ${location.uri}:${location.line}`
      );
    }
  }

  if (ruleId === "js/user-controlled-bypass" && !reviewedBypassFiles.has(location.uri)) {
    violations.push(
      `Authorization-bypass result appeared in an unreviewed file at ${location.uri}:${location.line}`
    );
  }

  if (ruleId === "js/regex/missing-regexp-anchor") {
    const isTestOnly =
      location.uri.startsWith("backend/tests/") ||
      location.uri.startsWith("frontend/scripts/");
    if (!isTestOnly) {
      violations.push(
        `Runtime URL regular expression requires review at ${location.uri}:${location.line}`
      );
    }
  }
}

const root = path.resolve(__dirname, "../..");
const serverSource = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const authMiddlewareSource = fs.readFileSync(
  path.join(root, "backend/middleware/authMiddleware.js"),
  "utf8"
);
const authRoutesSource = fs.readFileSync(
  path.join(root, "backend/routes/authRoutes.js"),
  "utf8"
);
const expenseReversalSource = fs.readFileSync(
  path.join(root, "backend/routes/expenseReversalRoutes.js"),
  "utf8"
);
const returnRoutesSource = fs.readFileSync(
  path.join(root, "backend/routes/returnRoutes.js"),
  "utf8"
);
const saleRoutesSource = fs.readFileSync(
  path.join(root, "backend/routes/saleRoutes.js"),
  "utf8"
);

assert.match(serverSource, /const generalApiLimiter = rateLimit\(/);
assert.match(serverSource, /app\.use\("\/api", generalApiLimiter\)/);
assert.match(serverSource, /API_RATE_LIMIT_WINDOW_MINUTES/);
assert.match(serverSource, /API_RATE_LIMIT_MAX/);

assert.match(authMiddlewareSource, /const decoded = jwt\.verify/);
assert.match(authMiddlewareSource, /id: state\.id/);
assert.match(authMiddlewareSource, /username: state\.username/);
assert.match(authMiddlewareSource, /role: state\.role/);
assert.match(authMiddlewareSource, /workspace_code: categoryAccess\.workspaceCode/);
assert.match(
  authMiddlewareSource,
  /workspace_role: categoryAccess\.workspaceRole \|\| state\.role/
);
assert.match(authMiddlewareSource, /validateSession\(/);
assert.match(authMiddlewareSource, /resolveEffectivePermissions\(req\.user\)/);

assert.match(authRoutesSource, /normalizeWorkspaceCode\(req\.body\.workspace_code\)/);
assert.match(authRoutesSource, /resolveLoginWorkspace\(user, workspaceCode\)/);
assert.match(authRoutesSource, /bcrypt\.compare\(password, user\.password_hash\)/);
assert.match(authRoutesSource, /createSession\(/);

assert.match(
  expenseReversalSource,
  /router\.delete\("\/:id", requireRole\("admin", "manager"\)/
);
assert.match(expenseReversalSource, /const branchId = Number\(req\.user\.branch_id\)/);
assert.match(
  expenseReversalSource,
  /WHERE id = \? AND branch_id = \? AND is_reversal = 0[\s\S]*FOR UPDATE/
);
assert.match(expenseReversalSource, /approvedAuditLock\(/);
assert.match(expenseReversalSource, /verifyIndependentBranchApprover\(/);
assert.match(expenseReversalSource, /reason\.length < 8/);
assert.match(expenseReversalSource, /void_approved_by = \?/);
assert.match(expenseReversalSource, /reversal_of_expense_id/);
assert.match(expenseReversalSource, /writeAuditEvent\(/);

assert.match(returnRoutesSource, /allowedReturnTypes/);
assert.match(returnRoutesSource, /verifyIndependentReturnApprover\(/);
assert.match(returnRoutesSource, /Refund amount cannot exceed the returned item value/);
assert.match(returnRoutesSource, /FOR UPDATE/);

assert.match(saleRoutesSource, /requireRole\("admin"\)/);
assert.match(saleRoutesSource, /verifyIndependentApprover\(/);
assert.match(saleRoutesSource, /Edit reason is required/);
assert.match(saleRoutesSource, /Void reason is required/);
assert.match(saleRoutesSource, /FOR UPDATE/);

if (violations.length > 0) {
  throw new Error(`CodeQL review policy failed:\n- ${violations.join("\n- ")}`);
}

const summary = [...counts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([ruleId, count]) => `${ruleId}: ${count}`)
  .join(", ");

console.log(
  `PASS - CodeQL SARIF matched the reviewed Version Three security policy (${summary || "no findings"}).`
);
