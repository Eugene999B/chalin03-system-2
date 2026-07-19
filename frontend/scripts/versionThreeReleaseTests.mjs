import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_RELEASE_LABEL,
  APP_RELEASE_NAME,
  APP_VERSION,
} from "../src/config/appVersion.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const loginSource = readFileSync(join(root, "src/pages/LoginPage.jsx"), "utf8");
const backendVersionSource = readFileSync(
  join(root, "../backend/config/version.js"),
  "utf8"
);
const systemRouteSource = readFileSync(
  join(root, "../backend/routes/systemRoutes.js"),
  "utf8"
);

assert.equal(APP_VERSION, "3.0.0");
assert.equal(APP_RELEASE_NAME, "Version Three");
assert.equal(APP_RELEASE_LABEL, "Version Three · v3.0.0");
assert.match(loginSource, /premium-version-badge/);
assert.match(loginSource, /APP_RELEASE_LABEL/);
assert.match(backendVersionSource, /APP_VERSION = "3\.0\.0"/);
assert.match(systemRouteSource, /process\.env\.APP_VERSION \|\| APP_VERSION/);

console.log("PASS - Version Three identity is consistent across login and API health.");
