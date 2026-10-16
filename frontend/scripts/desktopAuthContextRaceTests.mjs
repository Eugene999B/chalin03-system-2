import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const auth = fs.readFileSync(path.join(root, "src/context/AuthContext.jsx"), "utf8");
const main = fs.readFileSync(path.join(root, "src/main.jsx"), "utf8");
const worker = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");

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
  /APP_SHELL_RELEASE = `browser-cache-integrity-v35-\$\{APP_BUILD_ID\}`/
);
assert.match(
  main,
  /register\([\s\S]*`\/sw\.js\?release=\$\{encodeURIComponent\(APP_SHELL_RELEASE\)\}`[\s\S]*updateViaCache: "none"/
);
assert.match(main, /registration\.update\(\)/);
assert.match(main, /CHALIN03_ASSET_MISMATCH/);
assert.match(worker, /const CACHE_PREFIX = "chalin03-"/);
assert.match(
  worker,
  /new URL\(self\.location\.href\)\.searchParams\.get\("release"\)/
);
assert.match(
  worker,
  /const CACHE_NAME = `\$\{CACHE_PREFIX\}app-shell-\$\{safeRelease\}`/
);
assert.match(worker, /async function cachedShell\(\)/);
assert.match(worker, /async function fetchCurrentShell\(\)/);
assert.match(worker, /name !== CACHE_NAME/);
assert.match(worker, /url\.origin !== self\.location\.origin/);
assert.match(worker, /url\.pathname\.startsWith\("\/api"\)/);
assert.match(worker, /isBuildAssetRequest\(request, url\)/);
assert.match(worker, /networkBuildAsset\(request\)/);
assert.match(worker, /notifyClientsOfAssetMismatch/);
assert.match(worker, /isHtml\(response\)/);
assert.match(worker, /X-Chalin03-Asset-Mismatch/);
assert.match(worker, /fetch\(request, \{ cache: "no-store" \}\)/);
assert.match(worker, /return await fetchCurrentShell\(\)/);
assert.doesNotMatch(worker, /client\.navigate\(/);

console.log("Desktop AuthContext race and deployment-specific cache refresh contract passed.");