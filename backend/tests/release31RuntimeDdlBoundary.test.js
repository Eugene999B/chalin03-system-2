const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");

function javascriptFiles(relativeDirectory) {
  const root = path.join(backendRoot, relativeDirectory);
  const output = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        output.push(path.relative(backendRoot, absolutePath).replaceAll("\\", "/"));
      }
    }
  };
  walk(root);
  return output.sort();
}

function resolveRelativeModule(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [base, `${base}.js`, path.join(base, "index.js")];
  return (
    candidates.find(
      (candidate) =>
        candidate.startsWith(backendRoot) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
    ) || null
  );
}

function runtimeDependencyGraph() {
  const queue = [path.join(backendRoot, "server.js")];
  const visited = new Set();
  const relativeRequire = /require\(["'](\.{1,2}\/[^"']+)["']\)/g;

  while (queue.length) {
    const absolutePath = queue.shift();
    if (visited.has(absolutePath)) continue;
    visited.add(absolutePath);

    const source = fs.readFileSync(absolutePath, "utf8");
    for (const match of source.matchAll(relativeRequire)) {
      const resolved = resolveRelativeModule(absolutePath, match[1]);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }

  return Array.from(visited)
    .map((absolutePath) =>
      path.relative(backendRoot, absolutePath).replaceAll("\\", "/")
    )
    .sort();
}

const RUNTIME_SCHEMA_SENSITIVE_FILES = Object.freeze(
  Array.from(
    new Set([
      ...runtimeDependencyGraph(),
      ...javascriptFiles("routes"),
      ...javascriptFiles("middleware"),
    ])
  ).sort()
);

function executableSource(relativePath) {
  return fs
    .readFileSync(path.join(backendRoot, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("runtime graph includes critical mounted safety modules", () => {
  for (const relativePath of [
    "server.js",
    "routes/auditSignoffRoutes.js",
    "routes/auditUnlockRequestRoutes.js",
    "routes/branchRoutes.js",
    "routes/delegatedBackupRoutes.js",
    "routes/userRoutes.js",
    "services/fullSystemBackupService.js",
    "services/fullSystemBackupCoreService.js",
    "services/workerIdentityService.js",
  ]) {
    assert.ok(
      RUNTIME_SCHEMA_SENSITIVE_FILES.includes(relativePath),
      `${relativePath} is missing from the runtime DDL boundary`
    );
  }
});

test("mounted runtime dependency graph never performs database definition changes", () => {
  const forbidden = [
    /CREATE\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW)/i,
    /ALTER\s+TABLE/i,
    /DROP\s+(?:TABLE|TRIGGER|PROCEDURE|FUNCTION|EVENT|VIEW|DATABASE|SCHEMA)/i,
    /TRUNCATE\s+TABLE/i,
    /RENAME\s+TABLE/i,
  ];

  for (const relativePath of RUNTIME_SCHEMA_SENSITIVE_FILES) {
    const source = executableSource(relativePath);
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${relativePath} contains runtime DDL`);
    }
  }
});

test("audit routes use read-only schema readiness instead of repair helpers", () => {
  for (const relativePath of [
    "routes/auditSignoffRoutes.js",
    "routes/auditUnlockRequestRoutes.js",
  ]) {
    const source = executableSource(relativePath);
    assert.match(source, /assertAuditSchemaReady/);
    assert.match(source, /sendAuditSchemaReadinessError/);
    assert.doesNotMatch(source, /ensureAudit(?:Signoffs|UnlockRequest|ReapprovalLog)Table/);
  }
});

test("only controlled deployment scripts may reference migration execution", () => {
  const server = executableSource("server.js");
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
  );

  assert.doesNotMatch(server, /runControlledMigrations|runControlledDeployment/);
  assert.match(packageJson.scripts.start, /^node scripts\/runControlledDeployment\.js --deployment/);
  assert.match(packageJson.scripts["migrate:apply"], /runControlledDeployment\.js --apply/);
});

test("ordinary GET routes do not seed database rows", () => {
  for (const relativePath of ["routes/branchRoutes.js", "routes/settingsRoutes.js"]) {
    const source = executableSource(relativePath);
    const getBlocks = source.split(/router\.get\(/).slice(1);
    for (const block of getBlocks) {
      const untilNextRoute = block.split(/router\.(?:get|post|put|patch|delete)\(/)[0];
      assert.doesNotMatch(untilNextRoute, /INSERT\s+INTO/i, relativePath);
      assert.doesNotMatch(untilNextRoute, /UPDATE\s+[A-Za-z_`]/i, relativePath);
      assert.doesNotMatch(untilNextRoute, /DELETE\s+FROM/i, relativePath);
    }
  }
});
