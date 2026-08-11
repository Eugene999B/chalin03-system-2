import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(frontendRoot, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

const main = read("frontend/src/main.jsx");
const interactionSafety = read(
  "frontend/src/chalin-one/public-site/PublicInteractionSafety.jsx"
);
const publicEntry = read("frontend/src/chalin-one/PublicChalinOneEntry.jsx");
const corporateApp = read(
  "frontend/src/chalin-one/public-site/PublicCorporateWebsiteApp.jsx"
);
const pathModel = read("frontend/src/chalin-one/chalinOnePathModel.js");
const protectedRoute = read("frontend/src/components/ProtectedRoute.jsx");
const login = read("frontend/src/pages/LoginPageGroupOperations.jsx");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("public root boundary treats Staff Portal as a different application shell", () => {
  assert.match(main, /PUBLIC_APP_HANDOFF_PATHS/);
  assert.match(main, /"\/login"/);
  assert.match(main, /"\/staff"/);
  assert.match(main, /target\.pathname === "\/login" \? "\/staff"/);
  assert.match(main, /window\.location\.href = publicApplicationHandoffUrl\(target\)/);
});

check("public interaction safety normalizes legacy login links to staff entry", () => {
  assert.match(interactionSafety, /"\/login"/);
  assert.match(interactionSafety, /"\/staff"/);
  assert.match(interactionSafety, /destination\.pathname !== "\/login"/);
  assert.match(interactionSafety, /target\.pathname = "\/staff"/);
  assert.match(
    interactionSafety,
    /window\.location\.href = secureApplicationDestination\(destination\)/
  );
  assert.doesNotMatch(interactionSafety, /navigate\(/);
});

check("public website mounts secure application click protection", () => {
  assert.match(publicEntry, /PublicInteractionSafety/);
  assert.match(publicEntry, /<PublicInteractionSafety \/>/);
});

check("all current public Staff Portal surfaces remain covered by the secure handoff", () => {
  const staffLabels = corporateApp.match(/Staff portal|>Staff</g) || [];
  const loginTargets = corporateApp.match(/to="\/login"/g) || [];
  assert.ok(staffLabels.length >= 3, "Expected header, mobile and footer Staff surfaces");
  assert.ok(loginTargets.length >= 3, "Expected all current Staff surfaces to target secure access");
});

check("staff route owns authentication instead of the public website", () => {
  assert.match(protectedRoute, /if \(!isLoggedIn \|\| !user\)/);
  assert.match(protectedRoute, /<Navigate to="\/login" replace \/>/);
  assert.match(login, /spare_parts: "\/staff"/);
  assert.match(pathModel, /PUBLIC_TOP_LEVEL_PATHS/);
  assert.doesNotMatch(
    pathModel.match(/PUBLIC_TOP_LEVEL_PATHS[\s\S]*?\]\);/)?.[0] || "",
    /"login"|"staff"/
  );
});

console.log(`\nStaff Portal secure handoff: ${passed}/5 checks passed.`);
