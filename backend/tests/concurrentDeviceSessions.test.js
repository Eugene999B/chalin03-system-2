const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const source = readFileSync(
  join(__dirname, "..", "services", "accountSessionService.js"),
  "utf8"
);

test("new phone and desktop logins are not unconditionally revoked", () => {
  assert.match(source, /MAX_ACTIVE_SESSIONS_PER_USER/);
  assert.match(source, /Math\.max\(2, Math\.min\(configuredSessionLimit, 10\)\)/);
  assert.match(source, /activeSessions\.slice\(MAX_ACTIVE_SESSIONS_PER_USER\)/);
  assert.match(source, /session_limit_exceeded/);

  const createSessionStart = source.indexOf("async function createSession");
  const richInsert = source.indexOf("await insertRichSession", createSessionStart);
  const retireExcess = source.indexOf(
    "await retireExcessActiveSessions",
    createSessionStart
  );

  assert.ok(createSessionStart >= 0, "createSession must exist");
  assert.ok(richInsert > createSessionStart, "the new session must be inserted");
  assert.ok(
    retireExcess > richInsert,
    "session-limit cleanup must happen only after the new session exists"
  );

  const createSessionBody = source.slice(
    createSessionStart,
    source.indexOf("async function validateSession", createSessionStart)
  );
  assert.doesNotMatch(
    createSessionBody,
    /revocation_reason\s*=\s*'replaced_by_new_login'/,
    "a normal new login must not revoke the phone or another desktop session"
  );
});

test("security controls can still revoke one or all sessions", () => {
  assert.match(source, /async function revokeSession/);
  assert.match(source, /async function revokeAllUserSessions/);
  assert.match(source, /reason = "security_revoke"/);
  assert.match(source, /SESSION_REPLACED/);
  assert.match(source, /SESSION_LIMIT_EXCEEDED/);
});
