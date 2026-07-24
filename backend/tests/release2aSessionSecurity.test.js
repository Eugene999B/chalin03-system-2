const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

test("Release 2A.1 uses an auditable server-side session store", () => {
  const source = read("services/accountSessionService.js");

  assert.match(source, /CREATE|auth_sessions/i);
  assert.match(source, /MAX_ACTIVE_SESSIONS_PER_USER/);
  assert.match(source, /session_limit_exceeded/);
  assert.match(source, /replaced_by_new_login/);
  assert.match(source, /replaced_by_session_id/);
  assert.match(source, /revokeAllUserSessions/);
  assert.match(source, /SESSION_REPLACED/);
  assert.match(
    source,
    /DATE_SUB\((?:UTC_TIMESTAMP\(\)|NOW\(\)), INTERVAL 5 MINUTE\)/
  );
});

test("authentication middleware validates the JWT session ID", () => {
  const source = read("middleware/authMiddleware.js");

  assert.match(source, /validateSession/);
  assert.match(source, /decoded\.session_id/);
  assert.match(source, /sessionState\.session\.session_id/);
});

test("login creates a server-side session and logout revokes the current session", () => {
  const source = read("routes/authRoutes.js");

  assert.match(source, /createSession/);
  assert.match(source, /session\.sessionId/);
  assert.match(source, /LOGIN_SESSION_REPLACED/);
  assert.match(source, /router\.post\("\/logout"/);
  assert.match(source, /revokeSession/);
});

test("migration is additive and does not reset business data", () => {
  const source = read(
    "../database/migrations/20260716_release2a1_one_active_session.sql"
  );

  assert.match(source, /CREATE TABLE IF NOT EXISTS auth_sessions/);
  assert.match(source, /FOREIGN KEY \(user_id\) REFERENCES users\(id\)/);
  assert.doesNotMatch(source, /DROP TABLE/i);
  assert.doesNotMatch(source, /TRUNCATE/i);
  assert.doesNotMatch(source, /DELETE FROM users/i);
});
