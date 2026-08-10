import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const auth = fs.readFileSync(path.join(root, "src/context/AuthContext.jsx"), "utf8");
const main = fs.readFileSync(path.join(root, "src/main.jsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
const sessionGuard = fs.readFileSync(
  path.join(root, "src/security/sessionExpiryGuard.js"),
  "utf8"
);

assert.match(auth, /function adoptLatestStoredSession\(\)/);
assert.match(auth, /async function logout\(\{ expectedToken = null \} = \{\}\)/);
assert.match(auth, /tokenBeforeLogout !== expectedToken/);
assert.match(auth, /tokenAfterRequest !== expectedToken/);
assert.match(auth, /const refreshToken = localStorage\.getItem\(TOKEN_KEY\)/);
assert.match(auth, /activeToken && activeToken !== refreshToken/);
assert.match(auth, /await logout\(\{ expectedToken: refreshToken \}\)/);
assert.match(auth, /401,[\s\S]*403,[\s\S]*400/);

const responseGuard = auth.indexOf("activeToken && activeToken !== refreshToken");
const logoutCall = auth.indexOf("await logout({ expectedToken: refreshToken })", responseGuard);
assert.ok(responseGuard >= 0, "newer-session guard must exist");
assert.ok(logoutCall > responseGuard, "newer-session guard must run before logout");

assert.match(main, /import\.meta\.env\.VITE_CHALIN03_BUILD_ID/);
assert.match(
  main,
  /APP_SHELL_RELEASE = `browser-cache-integrity-v36-\$\{APP_BUILD_ID\}`/
);
assert.match(main, /installNoAutomaticRefreshPolicy/);
assert.match(main, /removeChalinServiceWorkerCaches/);
assert.doesNotMatch(main, /serviceWorker\.register\(/);
assert.doesNotMatch(main, /registration\.update\(\)/);
assert.doesNotMatch(main, /controllerchange/);
assert.doesNotMatch(main, /CHALIN03_ASSET_MISMATCH/);
assert.doesNotMatch(main, /window\.location\.reload\(/);

assert.match(sessionGuard, /onSessionChanged/);
assert.doesNotMatch(sessionGuard, /window\.location\.reload\(/);
assert.match(sessionGuard, /window\.location\.replace\("\/login"\)/);

// The retired worker file remains safe for browsers that still have a stale
// registration, but current application code unregisters it rather than
// promoting another worker during an active staff session.
assert.match(worker, /const CACHE_PREFIX = "chalin03-"/);
assert.match(
  worker,
  /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
);
assert.match(worker, /url\.origin !== self\.location\.origin/);
assert.match(worker, /url\.pathname\.startsWith\("\/api"\)/);
assert.doesNotMatch(worker, /client\.navigate\(/);

console.log("Desktop AuthContext race and no-automatic-refresh contract passed.");
