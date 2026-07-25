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
const loginEntry = readFileSync(join(root, "src/pages/LoginPage.jsx"), "utf8");
const loginSource = readFileSync(
  join(root, "src/pages/LoginPageGroupOperations.jsx"),
  "utf8"
);
const loginStyles = readFileSync(
  join(root, "src/styles/commandGateV4.css"),
  "utf8"
);
const manifest = JSON.parse(
  readFileSync(join(root, "public/site.webmanifest"), "utf8")
);
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
assert.equal(manifest.name, "Chalin 03 Group Operations Platform");
assert.equal(manifest.short_name, "Chalin 03");
assert.match(manifest.description, /Spare Parts/);
assert.match(manifest.description, /Mining Operations/);
assert.match(manifest.description, /Equipment Hire/);
assert.match(loginEntry, /LoginPageGroupOperations/);
assert.match(loginSource, /APP_RELEASE_LABEL/);
assert.match(loginSource, /className="gate4__version"/);
assert.match(loginSource, /commandGateV4\.css/);
assert.match(loginStyles, /\.gate4__version/);
assert.match(loginStyles, /@media \(max-width:/);
assert.match(backendVersionSource, /APP_VERSION = "3\.0\.0"/);
assert.match(systemRouteSource, /process\.env\.APP_VERSION \|\| APP_VERSION/);

console.log(
  "PASS - Version Three identity is consistent across the active login, PWA manifest and API health."
);
