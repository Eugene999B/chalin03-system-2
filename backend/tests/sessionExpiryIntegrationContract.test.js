const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const accountSessions = fs.readFileSync(
  path.resolve(__dirname, "../services/accountSessionService.js"),
  "utf8"
);
const expiryPolicy = fs.readFileSync(
  path.resolve(__dirname, "../services/sessionExpiryPolicy.js"),
  "utf8"
);
const authContext = fs.readFileSync(
  path.resolve(__dirname, "../../frontend/src/context/AuthContext.jsx"),
  "utf8"
);
const expiryGuard = fs.readFileSync(
  path.resolve(__dirname, "../../frontend/src/security/sessionExpiryGuard.js"),
  "utf8"
);
const axiosClient = fs.readFileSync(
  path.resolve(__dirname, "../../frontend/src/api/axiosClient.js"),
  "utf8"
);

test("new and legacy server sessions share the eight-hour or Ghana-midnight policy", () => {
  assert.match(accountSessions, /DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL 8 HOUR\)/);
  assert.match(accountSessions, /DATE_ADD\(UTC_DATE\(\), INTERVAL 1 DAY\)/);
  assert.match(accountSessions, /getEffectiveSessionExpiry/);
  assert.match(accountSessions, /expiryResponse/);
  assert.match(accountSessions, /created_at,/);
  assert.match(expiryPolicy, /SESSION_EXPIRED_GHANA_MIDNIGHT/);
  assert.match(expiryPolicy, /SESSION_EXPIRED_EIGHT_HOURS/);
  assert.doesNotMatch(accountSessions, /AUTH_SESSION_TTL_DAYS/);
});

test("the central auth context installs the browser expiry guard", () => {
  assert.match(authContext, /installSessionExpiryGuard/);
  assert.match(authContext, /useEffect\(\(\) => \{[\s\S]*if \(!token\) return undefined;/);
  assert.match(authContext, /setToken\(null\)/);
  assert.match(authContext, /setUser\(null\)/);
});

test("the browser guard refreshes to login and rechecks suspended tabs", () => {
  assert.match(expiryGuard, /8 \* 60 \* 60 \* 1000/);
  assert.match(expiryGuard, /getUTCDate\(\) \+ 1/);
  assert.match(expiryGuard, /window\.location\.replace\("\/login"\)/);
  assert.match(expiryGuard, /visibilitychange/);
  assert.match(expiryGuard, /pageshow/);
  assert.match(expiryGuard, /storage/);
});

test("server-detected timed expiry produces a login notice", () => {
  assert.match(axiosClient, /errorCode\.startsWith\("SESSION_EXPIRED"\)/);
  assert.match(axiosClient, /12:00 a\.m\. Ghana time/);
});
