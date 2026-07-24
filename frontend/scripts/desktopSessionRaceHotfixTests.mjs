import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "src/api/axiosClient.js"), "utf8");

assert.match(source, /REQUEST_TOKEN_KEY = "__chalin03RequestToken"/);
assert.match(source, /config\[REQUEST_TOKEN_KEY\] = requestToken/);
assert.match(source, /requestToken !== activeToken/);
assert.match(source, /isStaleSessionResponse/);
assert.match(source, /restartWithCurrentSession\(\)/);
assert.match(source, /return new Promise\(\(\) => \{\}\)/);
assert.match(source, /if \(!requestToken \|\| requestToken === activeToken\)/);
assert.match(source, /PUBLIC_SESSION_PATHS/);
assert.match(source, /"\/auth\/login"/);
assert.match(source, /delete config\.headers\.Authorization/);

const staleGuardIndex = source.indexOf("if (isStaleSessionResponse)");
const clearSessionIndex = source.indexOf("clearStoredSession();", staleGuardIndex);
assert.ok(staleGuardIndex >= 0, "stale-session response guard must exist");
assert.ok(
  clearSessionIndex > staleGuardIndex,
  "stale-session guard must run before any current-session clearing"
);

console.log("Desktop login stale-session race contract passed.");
