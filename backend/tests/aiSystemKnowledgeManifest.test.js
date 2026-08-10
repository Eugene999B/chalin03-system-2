"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SYSTEM_MANIFEST_VERSION,
  TOOL_SOURCE_FILES,
  buildSystemKnowledgeManifest,
  getSystemKnowledgeManifest,
  renderSystemKnowledgeManifest,
} = require("../services/aiSystemKnowledgeManifestService");
const {
  CHALIN_PRODUCT_CONTEXT,
} = require("../services/aiProductKnowledgeService");

test("system knowledge manifest discovers deployed governed AI capabilities", () => {
  const manifest = getSystemKnowledgeManifest({ force: true });
  assert.equal(manifest.version, SYSTEM_MANIFEST_VERSION);
  assert.equal(manifest.generated_from_deployed_source, true);
  assert.ok(manifest.sources_read.length >= TOOL_SOURCE_FILES.length);
  assert.ok(manifest.registered_ai_tool_keys.includes("system.group_intelligence"));
  assert.ok(manifest.registered_ai_tool_keys.includes("spare_parts.operations_snapshot"));
  assert.ok(manifest.registered_ai_tool_keys.includes("mining.operations_snapshot"));
  assert.ok(manifest.registered_ai_tool_keys.includes("equipment_hire.operations_snapshot"));
  assert.ok(manifest.registered_ai_tool_keys.includes("equipment_finance.portfolio_health"));
  assert.ok(manifest.known_application_routes.some((route) => route.includes("intelligence")));
  assert.equal(manifest.privacy.live_records_included, false);
  assert.equal(manifest.privacy.credentials_included, false);
  assert.equal(manifest.privacy.database_rows_included, false);
});

test("manifest extraction fails safely when source files are unavailable", () => {
  const manifest = buildSystemKnowledgeManifest({
    root: "/definitely/not/a/repository",
    readFile() {
      throw new Error("not found");
    },
  });
  assert.deepEqual(manifest.registered_ai_tool_keys, []);
  assert.deepEqual(manifest.known_application_routes, []);
  assert.equal(manifest.privacy.live_records_included, false);
});

test("product reasoning receives the source-synchronized product manifest without live records", () => {
  const rendered = renderSystemKnowledgeManifest();
  assert.match(rendered, /Registered governed AI capabilities/i);
  assert.match(rendered, /spare_parts\.operations_snapshot/i);
  assert.match(CHALIN_PRODUCT_CONTEXT, /CHALIN system manifest source-synchronized-v1/i);
  assert.match(CHALIN_PRODUCT_CONTEXT, /Known application route surfaces/i);
  assert.doesNotMatch(CHALIN_PRODUCT_CONTEXT, /API[_ -]?KEY\s*[:=]|password\s*[:=]|bearer\s+[a-z0-9._-]+/i);
});
