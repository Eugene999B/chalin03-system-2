const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const route = read("routes/backupOwnerStreamingRoutes.js");
const server = read("server.js");

test("owner backup download is mounted between delegated and legacy backup routers", () => {
  assert.match(server, /const backupOwnerStreamingRoutes = require\("\.\/routes\/backupOwnerStreamingRoutes"\)/);
  const delegatedMount = server.indexOf('app.use("/api/backups", delegatedBackupRoutes);');
  const streamingMount = server.indexOf('app.use("/api/backups", backupOwnerStreamingRoutes);');
  const legacyMount = server.indexOf('app.use("/api/backups", backupRoutes);');
  assert.ok(delegatedMount >= 0 && streamingMount > delegatedMount && legacyMount > streamingMount);
});

test("progressive backup authenticates and preserves the signed v2 contract", () => {
  assert.match(route, /requireAuth/);
  assert.match(route, /requireOriginalSystemAdministrator/);
  assert.match(route, /BACKUP_MANIFEST_VERSION/);
  assert.match(route, /checksumBackup\(backup\)/);
  assert.match(route, /signBackup\(backup, signingSecret\)/);
  assert.match(route, /START TRANSACTION WITH CONSISTENT SNAPSHOT/);
  assert.match(route, /CREATE_SIGNED_FULL_SYSTEM_BACKUP/);
  assert.match(route, /sendBackupSecurityAlert\(req, backup\)/);
});

test("progressive backup sends headers and heartbeat before expensive snapshot generation", () => {
  const routeStart = route.indexOf('router.get(\n  "/download"');
  const flush = route.indexOf("flushHeaders", routeStart);
  const heartbeat = route.indexOf('res.write("\\n")', routeStart);
  const connection = route.indexOf("pool.getConnection()", routeStart);
  const build = route.indexOf("buildFullSystemBackup(", connection);
  assert.ok(routeStart >= 0);
  assert.ok(flush > routeStart && flush < connection);
  assert.ok(heartbeat > flush && heartbeat < connection);
  assert.ok(connection > heartbeat && build > connection);
  assert.match(route, /HEARTBEAT_INTERVAL_MS = 15_000/);
  assert.match(route, /X-Chalin03-Backup-Transport/);
});

test("completed backup streams rows with backpressure and never materializes a second full JSON response", () => {
  assert.match(route, /async function writeChunk/);
  assert.match(route, /await once\(res, "drain"\)/);
  assert.match(route, /async function streamBackupJson/);
  assert.match(route, /JSON\.stringify\(rows\[rowIndex\]\)/);
  assert.match(route, /delete backup\.tables\[tableName\]/);
  assert.match(route, /res\.end\("}}"\)/);
  assert.doesNotMatch(route, /res\.json\(backup\)/);
});

test("a failed streamed backup aborts instead of returning valid-looking partial recovery evidence", () => {
  assert.match(route, /if \(!res\.destroyed\) res\.destroy\(error\)/);
  assert.doesNotMatch(route, /BACKUP_CREATION_FAILED/);
});
