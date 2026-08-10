"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const service = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioAiService.js"),
  "utf8"
);
const routes = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioAiRoutes.js"),
  "utf8"
);
const studioRoutes = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);

function finalAsyncFunctionBlock(source, name) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf("\nmodule.exports", start + 1);
  if (start < 0 || end < 0) throw new Error(`Could not isolate ${name}.`);
  return source.slice(start, end);
}

test("Content Studio AI stays under Studio session and Dashboard scope", () => {
  assert.match(studioRoutes, /router\.use\("\/dashboard\/intelligence", contentStudioAiRoutes\)/);
  assert.match(routes, /requireFeature\("aiEnabled"\)/);
  assert.match(routes, /requireFeature\("chalinCopilot"\)/);
  assert.match(routes, /requirePermission\("public_content\.view"\)/);
  assert.doesNotMatch(routes, /workspace\.view|requireAiPermission|requireAiPersona/);
});

test("Content Studio AI evidence is scope-aware and aggregate-only", () => {
  assert.match(service, /hasStudioScope\(user, "dashboard"\)/);
  assert.match(service, /if \(hasStudioScope\(user, "pages"\)\)/);
  assert.match(service, /aggregate_only: true/);
  assert.match(service, /draft_body_content_shared: false/);
  assert.match(service, /form_submission_content_shared: false/);
  assert.match(service, /autonomous_write_authority: false/);
  assert.doesNotMatch(service, /public_form_submissions\s+WHERE|SELECT\s+.*body_json/i);
});

test("Studio status resolves policy without invoking a provider", () => {
  const block = finalAsyncFunctionBlock(service, "getContentStudioAiStatus");
  assert.match(block, /resolveAiProviderSelection/);
  assert.doesNotMatch(block, /generateProviderResponse/);
  assert.match(block, /provider_call_performed: false/);
});

test("Studio service contains no mutation SQL or direct publishing workflow", () => {
  assert.doesNotMatch(service, /INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
  assert.doesNotMatch(service, /publishPageVersion|decidePageApproval|archivePage|updateDraftVersion/);
  assert.match(service, /resolveAiProviderSelection/);
});
