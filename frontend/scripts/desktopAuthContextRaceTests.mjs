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

assert.match(main, /register\("\/sw\.js", \{ updateViaCache: "none" \}\)/);
assert.match(main, /registration\.update\(\)/);
assert.match(worker, /const CACHE_NAME = "chalin03-[^"]+"/);
assert.match(worker, /async function cachedResponseOrOffline\(/);
assert.match(worker, /cacheName !== CACHE_NAME/);
assert.match(worker, /fetch\(request\)[\s\S]*catch\(\(\) => cachedResponseOrOffline\("\/"\)\)/);
assert.match(worker, /fetch\(request\)[\s\S]*catch\(\(\) => cachedResponseOrOffline\(request\)\)/);
assert.match(worker, /return buildOfflineResponse\(\)/);

console.log("Desktop AuthContext race and cache refresh contract passed.");
