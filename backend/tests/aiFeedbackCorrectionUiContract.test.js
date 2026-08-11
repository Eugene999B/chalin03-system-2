"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const capture = fs.readFileSync(
  path.join(root, "frontend/src/chalin-one/ai/AiFeedbackCorrectionCapture.jsx"),
  "utf8"
);
const protectedEntry = fs.readFileSync(
  path.join(root, "frontend/src/chalin-one/ProtectedChalinOneEntry.jsx"),
  "utf8"
);
const feedbackService = fs.readFileSync(
  path.join(root, "backend/services/aiFeedbackService.js"),
  "utf8"
);

test("negative AI feedback can capture a reviewed correction without auto-learning", () => {
  assert.match(capture, /NEGATIVE_RATINGS = new Set\(\["not_helpful", "incorrect"\]\)/);
  assert.match(capture, /axiosClient\.interceptors\.request\.use/);
  assert.match(capture, /url\.endsWith\("\/ai\/feedback"\)/);
  assert.match(capture, /comment:/);
  assert.match(capture, /correction:/);
  assert.match(capture, /What did CHALIN misunderstand\?/);
  assert.match(capture, /What should the correct answer or behavior be\?/);
  assert.match(capture, /reviewed training candidate/i);
  assert.match(capture, /does not automatically treat a correction as truth/i);
  assert.match(capture, /Submit correction for review/);
  assert.match(capture, /Skip details/);
  assert.doesNotMatch(capture, /window\.prompt|window\.confirm|localStorage|sessionStorage/);
});

test("feedback correction capture is mounted only on protected Intelligence surfaces", () => {
  assert.match(protectedEntry, /AiFeedbackCorrectionCapture/);
  assert.match(protectedEntry, /showProviderControl \? \(/);
  assert.ok(
    protectedEntry.indexOf("<AiFeedbackCorrectionCapture />") >
      protectedEntry.indexOf("{showProviderControl ? (")
  );
});

test("backend corrections remain queued for review rather than automatically accepted", () => {
  assert.match(feedbackService, /comment_text, correction_text, review_status/);
  assert.match(feedbackService, /VALUES \(\?, \?, \?, \?, \?, \?, \?, 'new'\)/);
  assert.match(feedbackService, /"new", "reviewed", "accepted", "rejected"/);
  assert.doesNotMatch(feedbackService, /review_status[^\n]*'accepted'[^\n]*INSERT/i);
});
