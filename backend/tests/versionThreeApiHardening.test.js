const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const authSource = fs.readFileSync(
  path.join(root, "middleware/authMiddleware.js"),
  "utf8"
);

test("Version Three applies a broad API rate ceiling before route handlers", () => {
  assert.match(serverSource, /require\("express-rate-limit"\)/);
  assert.match(serverSource, /const generalApiLimiter = rateLimit\(/);
  assert.match(serverSource, /app\.use\("\/api", generalApiLimiter\)/);
  assert.match(serverSource, /API_RATE_LIMIT_MAX/);
  assert.match(serverSource, /skip: \(req\) => req\.path === "\/health"/);
});

test("authenticated identity fields are refreshed from server-side state", () => {
  assert.match(authSource, /decoded = jwt\.verify/);
  assert.match(authSource, /return res\.status\(401\)\.json\(\{[\s\S]*?code: "INVALID_TOKEN"/);
  assert.match(authSource, /return res\.status\(503\)\.json\(\{[\s\S]*?code: "AUTH_VERIFICATION_UNAVAILABLE"/);
  assert.match(authSource, /id: state\.id/);
  assert.match(authSource, /username: state\.username/);
  assert.match(authSource, /role: state\.role/);
  assert.match(authSource, /workspace_code: categoryAccess\.workspaceCode/);
  assert.match(
    authSource,
    /workspace_role: categoryAccess\.workspaceRole \|\| state\.role/
  );
});
