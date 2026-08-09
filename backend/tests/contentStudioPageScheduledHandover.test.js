"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  pagePublishPlan,
} = require("../services/contentStudioPagePublishWorkflow");

const repoRoot = path.resolve(__dirname, "../..");
const workflowSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioPagePublishWorkflow.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioCoreRoutes.js"),
  "utf8"
);
const schedulerSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicContentPublishingScheduler.js"),
  "utf8"
);
const publicResolverSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/publicContentService.js"),
  "utf8"
);


test("scheduled first publication keeps the page hidden until due", () => {
  assert.deepEqual(pagePublishPlan({ scheduled: true, hasPublishedVersion: false }), {
    targetVersionStatus: "scheduled",
    targetPageStatus: "scheduled",
    preservePageWindow: false,
    supersedePublished: false,
    supersedeScheduled: true,
    executeApprovalNow: false,
  });
});


test("scheduled replacement preserves the current published page window", () => {
  assert.deepEqual(pagePublishPlan({ scheduled: true, hasPublishedVersion: true }), {
    targetVersionStatus: "scheduled",
    targetPageStatus: "published",
    preservePageWindow: true,
    supersedePublished: false,
    supersedeScheduled: true,
    executeApprovalNow: false,
  });
});


test("immediate publication supersedes old published and scheduled candidates", () => {
  assert.deepEqual(pagePublishPlan({ scheduled: false, hasPublishedVersion: true }), {
    targetVersionStatus: "published",
    targetPageStatus: "published",
    preservePageWindow: false,
    supersedePublished: true,
    supersedeScheduled: true,
    executeApprovalNow: true,
  });
});


test("publish route uses the isolated atomic Page workflow", () => {
  assert.match(routeSource, /contentStudioPagePublishWorkflow/);
  assert.match(routeSource, /publishPageVersion/);
  assert.match(routeSource, /public_content\.publish/);
  assert.match(workflowSource, /version_status = 'scheduled'/);
  assert.match(workflowSource, /preservePageWindow/);
  assert.match(workflowSource, /scheduled_replacement/);
  assert.match(workflowSource, /preserved_published_version_id/);
  assert.match(workflowSource, /Only an approved page version may be published or scheduled/);
  assert.match(workflowSource, /APPROVED_REVIEW_REQUIRED/);
});


test("due scheduler promotes replacement atomically and copies the candidate window", () => {
  assert.match(schedulerSource, /p\.publication_status IN \('scheduled', 'published', 'expired'\)/);
  assert.match(schedulerSource, /v\.version_status = 'scheduled'/);
  assert.match(schedulerSource, /SET version_status = 'superseded'[\s\S]*?version_status = 'published'/);
  assert.match(schedulerSource, /publish_at = \?,[\s\S]*?expires_at = \?,[\s\S]*?published_at = UTC_TIMESTAMP\(\)/);
  assert.match(schedulerSource, /handover_mode:[\s\S]*?scheduled_replacement/);
  assert.match(schedulerSource, /executed_at = COALESCE\(executed_at, UTC_TIMESTAMP\(\)\)/);
});


test("expiry archives only the live version and preserves a future replacement", () => {
  assert.match(schedulerSource, /WHERE publication_status = 'published'[\s\S]*?expires_at <= UTC_TIMESTAMP\(\)/);
  assert.match(schedulerSource, /SET version_status = 'archived'[\s\S]*?version_status = 'published'/);
  assert.doesNotMatch(
    schedulerSource.match(/async function expireDuePages[\s\S]*?async function publishDueSimpleRecords/)?.[0] || "",
    /version_status IN \('published', 'scheduled'\)/
  );
  assert.match(schedulerSource, /scheduled_replacements_preserved: true/);
});


test("public resolver still serves only the currently published Page and version", () => {
  assert.match(publicResolverSource, /publication_status = 'published'/);
  assert.match(publicResolverSource, /version_status = 'published'/);
  assert.match(publicResolverSource, /publish_at IS NULL OR/);
  assert.match(publicResolverSource, /expires_at IS NULL OR/);
});
