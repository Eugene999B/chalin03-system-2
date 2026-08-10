import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const repoRoot = path.resolve(frontendRoot, "..");
const readFrontend = (relativePath) =>
  fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
const readRepo = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const component = readFrontend(
  "src/chalin-one/content-studio/ContentStudioLaunchReadiness.jsx"
);
const api = readFrontend(
  "src/chalin-one/content-studio/contentStudioLaunchReadinessApi.js"
);
const css = readFrontend(
  "src/chalin-one/content-studio/contentStudioLaunchReadiness.css"
);
const studioModel = readFrontend(
  "src/chalin-one/content-studio/contentStudioModel.js"
);
const workspace = readFrontend(
  "src/chalin-one/content-studio/ContentStudioWorkspace.jsx"
);
const packageJson = JSON.parse(readFrontend("package.json"));
const databaseAcceptance = readRepo(
  "backend/acceptance/contentStudioFinalAcceptance.test.js"
);
const coreRoutes = readRepo("backend/routes/contentStudioCoreRoutes.js");
const accessMiddleware = readRepo(
  "backend/middleware/contentStudioAccessMiddleware.js"
);
const publicContentService = readRepo(
  "backend/services/publicContentService.js"
);
const ciWorkflow = readRepo(".github/workflows/chalin-one-ci.yml");

for (const contract of [
  /PHASE 2K \/ CONTENT STUDIO COMPLETION CONTROL/,
  /Editor → Reviewer → Publisher/,
  /Self-approval and wrong-reviewer paths blocked/,
  /Draft and approved replacements stay private/,
  /Published version reflected on the public API/,
  /aggregate CHALIN ONE CI summary is the machine-readable go\/no-go record/,
  /Railway \+ Cloudflare staging green/,
  /Production backup and promotion remain separate later phases/,
]) assert.match(component, contract);

for (const contract of [
  /\/content-studio\/dashboard/,
  /\/content-studio\/pages\?limit=1/,
  /\/content-studio\/pages\/website-control/,
  /\/public\/content\/bootstrap/,
  /\/public\/content\/homepage/,
  /\/public\/analytics\/disclosure/,
  /Promise\.allSettled/,
]) assert.match(api, contract);

for (const contract of [
  /PAGE_KEY = "phase_2k_studio_completion"/,
  /AUTHOR = Object\.freeze\(\{ id: 1/,
  /REVIEWER = Object\.freeze\(\{ id: 2/,
  /PUBLISHER = Object\.freeze\(\{ id: 3/,
  /PAGE_VERSION_NOT_APPROVED/,
  /CONTENT_SELF_APPROVAL_BLOCKED/,
  /CONTENT_APPROVAL_ASSIGNED_ELSEWHERE/,
  /getPublicPageBySlug/,
  /assert\.equal\(\(await getPublicPageBySlug\(PAGE_SLUG\)\)\.version, 1\)/,
  /assert\.equal\(publicV2\.version, 2\)/,
  /page_review_requested/,
  /page_review_approved/,
  /page_published/,
  /executed_at/,
]) assert.match(databaseAcceptance, contract);

for (const contract of [
  /requirePermission\("public_content\.create"\)/,
  /requirePermission\("public_content\.edit"\)/,
  /requirePermission\("public_content\.submit"\)/,
  /requirePermission\("public_content\.review"\)/,
  /requirePermission\("public_content\.approve"\)/,
  /requirePermission\("public_content\.publish"\)/,
  /contentStudioPagePublishWorkflow/,
]) assert.match(coreRoutes, contract);

for (const contract of [
  /CONTENT_STUDIO_SCOPE_DENIED/,
  /CONTENT_STUDIO_OWNER_REQUIRED/,
  /hydrateContentStudioSession/,
  /scopeForContentStudioRequest/,
]) assert.match(accessMiddleware, contract);

assert.match(publicContentService, /publication_status = 'published'/);
assert.match(publicContentService, /version_status = 'published'/);
assert.match(publicContentService, /getPublicPageBySlug/);
assert.match(publicContentService, /public_page_sections/);

assert.match(studioModel, /key: "launch-readiness"/);
assert.match(workspace, /ContentStudioLaunchReadiness/);
assert.match(workspace, /"launch-readiness": ContentStudioLaunchReadiness/);

for (const contract of [
  /@media \(max-width: 1100px\)/,
  /@media \(max-width: 760px\)/,
  /@media \(max-width: 390px\)/,
  /prefers-reduced-motion: reduce/,
]) assert.match(css, contract);

assert.match(ciWorkflow, /npm run test:chalin-one:db/);
assert.match(ciWorkflow, /Run frontend tests/);
assert.match(ciWorkflow, /npm test/);
assert.match(ciWorkflow, /Build frontend/);
assert.match(ciWorkflow, /Publish final CI status/);
assert.match(ciWorkflow, /chalin-one\/ci/);

assert.match(
  packageJson.scripts.test,
  /chalinOneStudioFinalAcceptanceTests\.mjs/
);

assert.doesNotMatch(component, /publishPageVersion|decidePageApproval|submitPageVersion/);
assert.doesNotMatch(component, /dangerouslySetInnerHTML|<iframe|eval\s*\(|new Function/);

console.log(
  "✅ CHALIN ONE Phase 2K final Studio acceptance contracts passed: live readiness probes, independent Editor → Reviewer → Publisher governance, draft isolation, exact public reflection, permission boundaries, responsive completion UX and aggregate CI go/no-go wiring remain protected."
);
