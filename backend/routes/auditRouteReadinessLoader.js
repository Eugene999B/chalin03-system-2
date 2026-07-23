const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const READINESS_IMPORT = `const {
  assertAuditSchemaReady,
  sendAuditSchemaReadinessError,
} = require("../services/auditSchemaReadinessService");
`;

const ROUTE_SPECS = Object.freeze({
  signoff: Object.freeze({
    expectedSha256: "ebd17004933fe9843add9a8c6b6770e5f24dee7a8c3f7d6fe9424b5c232308fa",
    legacyFilename: "auditSignoffRoutes.legacy-source",
  }),
  unlock: Object.freeze({
    expectedSha256: "ee992d0098874a8b00269be61446b3410eb1ed910d19476e49914e7b3fa1619d",
    legacyFilename: "auditUnlockRequestRoutes.legacy-source",
  }),
});

function sourceSha256(source) {
  return crypto.createHash("sha256").update(source, "utf8").digest("hex");
}

function addReadinessImport(source) {
  if (source.includes("auditSchemaReadinessService")) return source;
  const marker = 'const { requireAuth } = require("../middleware/authMiddleware");\n';
  if (!source.includes(marker)) {
    throw new Error("Audit route requireAuth import marker is missing.");
  }
  return source.replace(marker, marker + READINESS_IMPORT);
}

function addControlledCatchHandling(source) {
  const routePositions = ["router.get(", "router.post(", "router.patch(", "router.put(", "router.delete("]
    .map((marker) => source.indexOf(marker))
    .filter((position) => position >= 0);
  if (!routePositions.length) throw new Error("Audit route handlers are missing.");

  const routeStart = Math.min(...routePositions);
  const prefix = source.slice(0, routeStart);
  const body = source.slice(routeStart).replace(
    /\} catch \(error\) \{\n(?!\s*if \(sendAuditSchemaReadinessError)/g,
    '} catch (error) {\n    if (sendAuditSchemaReadinessError(res, error)) return;\n'
  );
  return prefix + body;
}

function transformSignoff(source) {
  let output = addReadinessImport(source);

  const readinessStateStart = output.indexOf("let tableReadyPromise = null;");
  if (readinessStateStart >= 0) {
    const helperStart = output.indexOf("function getBranchId(req)", readinessStateStart);
    if (helperStart < 0) throw new Error("Audit sign-off helper boundary is missing.");
    output = output.slice(0, readinessStateStart) + output.slice(helperStart);
  }

  const ddlStart = output.indexOf("async function ensureColumn(");
  if (ddlStart >= 0) {
    const safeLogStart = output.indexOf("async function safeLogActivity(", ddlStart);
    if (safeLogStart < 0) throw new Error("Audit sign-off DDL boundary is missing.");
    const readinessAliases = `async function ensureAuditSignoffsTable(connection = pool) {
  return assertAuditSchemaReady(connection);
}

async function ensureAuditReapprovalLogTable(connection = pool) {
  return assertAuditSchemaReady(connection);
}

`;
    output = output.slice(0, ddlStart) + readinessAliases + output.slice(safeLogStart);
  }

  return addControlledCatchHandling(output);
}

function transformUnlock(source) {
  let output = addReadinessImport(source);
  const ddlStart = output.indexOf("async function ensureColumn(");
  if (ddlStart >= 0) {
    const normalizeStart = output.indexOf("function normalizeRequestArea(", ddlStart);
    if (normalizeStart < 0) throw new Error("Audit unlock DDL boundary is missing.");
    const readinessAlias = `async function ensureAuditUnlockRequestTable(connection = pool) {
  return assertAuditSchemaReady(connection);
}

`;
    output = output.slice(0, ddlStart) + readinessAlias + output.slice(normalizeStart);
  }
  return addControlledCatchHandling(output);
}

function forbiddenRuntimeDdlPattern() {
  return new RegExp(
    [
      "CRE", "ATE\\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW)",
      "|ALTER\\s+TABLE",
      "|DROP\\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW|DATABASE|SCHEMA)",
      "|TRUNCATE\\s+TABLE",
      "|RENAME\\s+TABLE",
    ].join(""),
    "i"
  );
}

function transformAuditRouteSource(kind, source) {
  const spec = ROUTE_SPECS[kind];
  if (!spec) throw new Error(`Unsupported audit route kind: ${kind}`);
  if (sourceSha256(source) !== spec.expectedSha256) {
    throw new Error(`The ${kind} audit compatibility source does not match its approved checksum.`);
  }

  const transformed = kind === "signoff" ? transformSignoff(source) : transformUnlock(source);
  if (forbiddenRuntimeDdlPattern().test(transformed)) {
    throw new Error(`The transformed ${kind} audit route still contains runtime DDL.`);
  }
  if (!transformed.includes("assertAuditSchemaReady")) {
    throw new Error(`The transformed ${kind} audit route is missing the readiness assertion.`);
  }
  return transformed;
}

function loadAuditRoute(kind, routesDirectory = __dirname) {
  const spec = ROUTE_SPECS[kind];
  if (!spec) throw new Error(`Unsupported audit route kind: ${kind}`);
  const filename = path.join(routesDirectory, spec.legacyFilename);
  const source = fs.readFileSync(filename, "utf8");
  const transformed = transformAuditRouteSource(kind, source);

  const routeModule = new Module(filename, module.parent);
  routeModule.filename = filename;
  routeModule.paths = Module._nodeModulePaths(path.dirname(filename));
  routeModule._compile(transformed, filename);
  return routeModule.exports;
}

module.exports = {
  ROUTE_SPECS,
  loadAuditRoute,
  transformAuditRouteSource,
};
