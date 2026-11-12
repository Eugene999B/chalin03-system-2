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
  "js/incomplete-sanitization",
  "js/insecure-randomness",
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
  "backend/services/operationalApprovalService.js",
]);

// This compatibility service composes reviewed Finance routers onto the
// equipment-sales router. Requests still enter through the global /api limiter
// asserted below, so CodeQL's router-mount finding is the same reviewed API
// surface class as findings emitted directly from backend/routes/.
const reviewedRateLimitCompositionFiles = new Set([
  "backend/services/equipmentSalesReminderService.js",
]);

const counts = new Map();
const violations = [];

function normalizedPhysicalLocation(location) {
  const physical = location?.physicalLocation;
  return {
    uri: String(physical?.artifactLocation?.uri || "").replaceAll("\\", "/"),
    line: Number(physical?.region?.startLine || 0),
  };
}

function locationFor(result) {
  return normalizedPhysicalLocation(result.locations?.[0]);
}

function relatedLocationsFor(result) {
  const direct = (result.relatedLocations || []).map(normalizedPhysicalLocation);
  const flow = (result.codeFlows || []).flatMap((codeFlow) =>
    (codeFlow.threadFlows || []).flatMap((threadFlow) =>
      (threadFlow.locations || []).map((entry) =>
        normalizedPhysicalLocation(entry.location)
      )
    )
  );

  return [...direct, ...flow].filter((location) => location.uri);
}

for (const result of results) {
  const ruleId = String(result.ruleId || "unknown");
  const location = locationFor(result);
  counts.set(ruleId, Number(counts.get(ruleId) || 0) + 1);

  if (!reviewedRules.has(ruleId)) {
    violations.push(`Unreviewed CodeQL rule ${ruleId} at ${location.uri}:${location.line}`);
    continue;
  }

  if (ruleId === "js/incomplete-sanitization") {
    const isStaticContractTest = location.uri.startsWith("backend/tests/");
    if (!isStaticContractTest) {
      violations.push(
        `Incomplete sanitization appeared outside a reviewed static contract test at ${location.uri}:${location.line}`
      );
    }
  }

  if (ruleId === "js/insecure-randomness") {
    const reviewedFallbackSource = relatedLocationsFor(result).some(
      (source) =>
        source.uri === "backend/routes/equipmentCreditApplicationRoutes.js" &&
        source.line >= 150 &&
        source.line <= 170
    );

    if (!reviewedFallbackSource) {
      violations.push(
        `Insecure-randomness result appeared outside the one reviewed non-secret public document reference fallback at ${location.uri}:${location.line}`
      );
    }
  }

  if (ruleId === "js/missing-rate-limiting") {
    const isBackendRoute =
      location.uri === "backend/server.js" ||
      location.uri.startsWith("backend/routes/") ||
      reviewedRateLimitCompositionFiles.has(location.uri);
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
const operationalApprovalServiceSource = fs.readFileSync(
  path.join(root, "backend/services/operationalApprovalService.js"),
  "utf8"
);
const operationalApprovalBootstrapSource = fs.readFileSync(
  path.join(root, "backend/services/operationalApprovalBootstrap.js"),
  "utf8"
);
const equipmentSalesReminderServiceSource = fs.readFileSync(
  path.join(root, "backend/services/equipmentSalesReminderService.js"),
  "utf8"
);
const equipmentCreditApplicationSource = fs.readFileSync(
  path.join(root, "backend/routes/equipmentCreditApplicationRoutes.js"),
  "utf8"
);
const equipmentFinancePhaseOneSource = fs.readFileSync(
  path.join(root, "backend/routes/equipmentFinancePhaseOneRoutes.js"),
  "utf8"
);
const equipmentCreditMigrationSource = fs.readFileSync(
  path.join(
    root,
    "database/migrations/20260729_equipment_credit_application_foundation.sql"
  ),
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

// Operational rejection is not an authorization bypass: the administrator has
// already passed role, branch, self-approval and bcrypt checks. The user-controlled
// value is only the mandatory explanatory note saved with a rejection decision.
assert.match(operationalApprovalServiceSource, /SELF_APPROVAL_FORBIDDEN/);
assert.match(
  operationalApprovalServiceSource,
  /bcrypt\.compare\(String\(password\), reviewer\.password_hash\)/
);
assert.match(operationalApprovalServiceSource, /userCanAccessBranch\(/);
assert.match(
  operationalApprovalServiceSource,
  /if \(!cleanText\(reviewNote, 5000\)\)[\s\S]*A rejection reason is required/
);
assert.match(
  operationalApprovalServiceSource,
  /execution_status = 'executing'/
);
assert.match(
  operationalApprovalBootstrapSource,
  /const approvalRequestLimiter = rateLimit\(/
);
assert.match(
  operationalApprovalBootstrapSource,
  /const approvalDecisionLimiter = rateLimit\(/
);
assert.match(
  operationalApprovalBootstrapSource,
  /buildOperationalApprovalRateLimitRouter\(/
);
assert.match(
  operationalApprovalBootstrapSource,
  /protectedRouteExecutionLimiter[\s\S]*operationalApprovalExecutionMiddleware/
);

// Keep the reviewed service allowlist tied to the specific router composition
// that CodeQL reports. If this service stops being a mount-only compatibility
// layer, the policy should fail rather than silently broadening the exception.
assert.match(
  equipmentSalesReminderServiceSource,
  /equipmentSalesRoutes\.use\(\s*"\/finance-lifecycle",\s*equipmentFinanceFinalLifecycleRoutes\s*\)/
);

// The legacy credit-application fallback creates a public, human-readable
// document reference only. It is never a password, token, authorisation
// decision, ownership proof or payment idempotency key. Database uniqueness is
// authoritative, and duplicate writes fail closed rather than overwriting an
// existing record.
assert.match(
  equipmentCreditApplicationSource,
  /function fallbackApplicationNumber\(\)[\s\S]*return `ECAPP-\$\{stamp\}-\$\{random\}`/
);
assert.match(
  equipmentCreditApplicationSource,
  /nextDocumentNumber\("EQUIPMENT_CREDIT_APPLICATION"[\s\S]*return fallbackApplicationNumber\(\)/
);

// Phase 3 no longer relies on Math.random for the guided Finance fallback.
// It must use Node's cryptographic random integer generator, and any future
// insecure-randomness finding in this route is deliberately not allowlisted.
assert.match(equipmentFinancePhaseOneSource, /const crypto = require\("crypto"\)/);
assert.match(
  equipmentFinancePhaseOneSource,
  /function fallbackNumber\(prefix\)[\s\S]*crypto\.randomInt\(0, 1000000\)[\s\S]*padStart\(6, "0"\)/
);
assert.match(
  equipmentFinancePhaseOneSource,
  /async function documentNumber\(sequence, prefix, actorId\)[\s\S]*nextDocumentNumber\(sequence, \{ userId: actorId \}\)[\s\S]*return fallbackNumber\(prefix\)/
);
assert.match(equipmentFinancePhaseOneSource, /error\?\.code === "ER_DUP_ENTRY"/);
assert.match(
  equipmentCreditMigrationSource,
  /application_number VARCHAR\(80\) NOT NULL UNIQUE/
);

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
