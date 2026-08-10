import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const context = read("src/context/FeatureFlagContext.jsx");
const featureRoute = read("src/components/FeatureFlagRoute.jsx");
const featureVisible = read("src/components/FeatureFlagVisible.jsx");
const main = read("src/main.jsx");
const publicRoot = read("src/chalin-one/PublicChalinOneEntry.jsx");
const protectedRoot = read("src/chalin-one/ProtectedChalinOneEntry.jsx");
const operationalRoot = read("src/OperationalAppRoot.jsx");

assert.match(context, /CHALIN_ONE_FEATURE_DEFAULTS/);
assert.match(context, /aiEnabled:\s*false/);
assert.match(context, /publicWebsite:\s*false/);
assert.match(context, /contentStudio:\s*false/);
assert.match(context, /chalinCopilot:\s*false/);
assert.match(context, /chalinExecutive:\s*false/);
assert.match(context, /chalinGuide:\s*false/);
assert.match(context, /customerPortal:\s*false/);
assert.match(context, /supplierPortal:\s*false/);
assert.match(context, /applicantPortal:\s*false/);
assert.match(context, /aiActions:\s*false/);
assert.match(context, /aiScheduledJobs:\s*false/);
assert.match(context, /"\/features\/staff"/);
assert.match(context, /"\/features\/public"/);
assert.match(context, /failClosedFlags/);
assert.match(context, /setFlags\(CHALIN_ONE_FEATURE_DEFAULTS\)/);
assert.match(context, /STATUS_REFRESH_INTERVAL_MS\s*=\s*30000/);
assert.match(context, /featureKey in CHALIN_ONE_FEATURE_DEFAULTS/);

assert.match(featureRoute, /useFeatureFlags/);
assert.match(featureRoute, /isFeatureEnabled\(feature\)/);
assert.match(featureRoute, /<Navigate to=\{fallbackPath\} replace/);

assert.match(featureVisible, /useFeatureFlags/);
assert.match(featureVisible, /loading \|\| !isFeatureEnabled\(feature\)/);

// Phase 2J keeps the initial document boot tiny. Feature providers live inside
// the dynamically selected application roots so public visitors do not pull the
// full operational application graph through main.jsx.
assert.doesNotMatch(main, /FeatureFlagProvider|<App \/>/);
assert.match(main, /import\("\.\/chalin-one\/PublicChalinOneEntry\.jsx"\)/);
assert.match(main, /import\("\.\/chalin-one\/ProtectedChalinOneEntry\.jsx"\)/);
assert.match(main, /import\("\.\/OperationalAppRoot\.jsx"\)/);

for (const source of [publicRoot, protectedRoot, operationalRoot]) {
  assert.match(source, /FeatureFlagProvider/);
  assert.match(source, /<FeatureFlagProvider>/);
}
assert.match(operationalRoot, /<App \/>/);

console.log("CHALIN ONE frontend feature-flag foundation tests passed.");
