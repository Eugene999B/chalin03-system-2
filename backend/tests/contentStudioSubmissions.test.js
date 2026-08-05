"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ContentStudioError,
} = require("../services/contentStudioPageService");
const {
  STATUS_TRANSITIONS,
  SUBMISSION_STATUSES,
  assertStatusTransition,
  normalizeSubmissionStatus,
  redactSubmissionFile,
} = require("../services/contentStudioSubmissionService");

const repoRoot = path.resolve(__dirname, "../..");
const serviceSource = fs.readFileSync(
  path.join(repoRoot, "backend/services/contentStudioSubmissionService.js"),
  "utf8"
);
const routeSource = fs.readFileSync(
  path.join(repoRoot, "backend/routes/contentStudioRoutes.js"),
  "utf8"
);

test("submission statuses and transitions are explicit", () => {
  assert.deepEqual(SUBMISSION_STATUSES, [
    "new",
    "in_review",
    "awaiting_customer",
    "resolved",
    "rejected",
    "spam",
    "archived",
  ]);
  assert.equal(normalizeSubmissionStatus("IN_REVIEW"), "in_review");
  assert.equal(normalizeSubmissionStatus("unknown"), null);
  assert.ok(STATUS_TRANSITIONS.new.includes("in_review"));
  assert.ok(STATUS_TRANSITIONS.resolved.includes("archived"));
  assert.equal(STATUS_TRANSITIONS.archived.includes("resolved"), false);
});

test("invalid enquiry status jumps are rejected", () => {
  assert.doesNotThrow(() => assertStatusTransition("new", "resolved"));
  assert.doesNotThrow(() => assertStatusTransition("resolved", "archived"));
  assert.throws(
    () => assertStatusTransition("archived", "resolved"),
    (error) =>
      error instanceof ContentStudioError &&
      error.code === "INVALID_SUBMISSION_STATUS_TRANSITION"
  );
});

test("ordinary enquiry file responses never expose private storage identifiers", () => {
  const redacted = redactSubmissionFile({
    id: 4,
    field_key: "cv",
    storage_provider: "cloudflare_r2",
    storage_key: "private/forms/cv.pdf",
    original_filename: "cv.pdf",
    mime_type: "application/pdf",
    file_size_bytes: 1500,
    checksum_sha256: "a".repeat(64),
    security_status: "clean",
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-08-05T00:00:00.000Z",
  });

  assert.equal("storage_key" in redacted, false);
  assert.equal("storage_provider" in redacted, false);
  assert.equal(redacted.original_filename, "cv.pdf");
  assert.equal(redacted.security_status, "clean");
});

test("submission reads remove network hash and user-agent data", () => {
  assert.match(serviceSource, /ip_hash: undefined/);
  assert.match(serviceSource, /user_agent: undefined/);
  assert.doesNotMatch(serviceSource, /SELECT[\s\S]*?storage_key[\s\S]*?FROM public_form_submission_files/);
});

test("assignment, review and status changes are transactional and audited", () => {
  assert.match(serviceSource, /beginTransaction\(\)/);
  assert.match(serviceSource, /commit\(\)/);
  assert.match(serviceSource, /rollback\(\)/);
  assert.match(serviceSource, /FOR UPDATE/);
  assert.match(serviceSource, /submission_assigned/);
  assert.match(serviceSource, /submission_review_recorded/);
  assert.match(serviceSource, /submission_status_changed/);
  assert.match(serviceSource, /PUBLIC_SUBMISSION_ASSIGNED/);
  assert.match(serviceSource, /PUBLIC_SUBMISSION_REVIEW_RECORDED/);
  assert.match(serviceSource, /PUBLIC_SUBMISSION_STATUS_CHANGED/);
});

test("enquiry desk routes separate viewing, responding and management authority", () => {
  assert.match(
    routeSource,
    /"\/submissions"[\s\S]*?public_submissions\.view/
  );
  assert.match(
    routeSource,
    /"\/submissions\/:submissionId\/review"[\s\S]*?public_submissions\.respond/
  );
  assert.match(
    routeSource,
    /"\/submissions\/:submissionId\/assign"[\s\S]*?public_submissions\.manage/
  );
  assert.match(
    routeSource,
    /"\/submissions\/:submissionId\/status"[\s\S]*?public_submissions\.manage/
  );
});
