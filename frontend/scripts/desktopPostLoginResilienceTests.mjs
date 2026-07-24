import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const expiryGuard = read("src/security/sessionExpiryGuard.js");
const axiosClient = read("src/api/axiosClient.js");

assert.match(expiryGuard, /const checkStoredSession = \(\) =>/);
assert.match(expiryGuard, /backend validates the real eight-hour/);
assert.match(expiryGuard, /browser clock is deliberately/);
assert.doesNotMatch(
  expiryGuard,
  /Date\.now\(\)\s*>?=\s*policy\.expiresAtMs/,
  "desktop local time must not clear a server-valid session"
);
assert.doesNotMatch(
  expiryGuard,
  /setTimeout\([\s\S]*policy\.expiresAtMs\s*-\s*Date\.now/,
  "desktop local time must not schedule destructive expiry"
);
assert.match(expiryGuard, /storedToken !== token/);
assert.match(expiryGuard, /clearStoredSession\(\)/);

assert.match(axiosClient, /isTemporaryProfileFailure/);
assert.match(axiosClient, /requestPath === "\/auth\/me"/);
assert.match(axiosClient, /statusCode === 400 \|\| statusCode >= 500/);
assert.match(axiosClient, /buildCachedProfileResponse\(error, cachedUser\)/);
assert.match(axiosClient, /Real 401\/403\/404/);
assert.match(axiosClient, /if \(statusCode === 401/);
assert.doesNotMatch(
  axiosClient,
  /isTemporaryProfileFailure[\s\S]{0,500}statusCode === 401/,
  "401 must never use the cached-profile fallback"
);
assert.doesNotMatch(
  axiosClient,
  /isTemporaryProfileFailure[\s\S]{0,500}statusCode === 403/,
  "403 must never use the cached-profile fallback"
);

console.log("Desktop post-login resilience contracts passed.");
