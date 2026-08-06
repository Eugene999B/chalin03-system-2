import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(frontendRoot, "src/chalin-one/content-studio");
const api = fs.readFileSync(path.join(root, "contentStudioPortfolioApi.js"), "utf8");
const manager = fs.readFileSync(path.join(root, "ContentStudioLeadershipManager.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "contentStudioLeadershipManager.css"), "utf8");

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`✓ ${name}`); }

check("portfolio API supports only approved manager kinds and all governed actions", () => {
  assert.match(api, /\["leadership", "project", "equipment"\]/);
  assert.match(api, /Unsupported Content Studio portfolio manager/);
  for (const fragment of ["/versions", "/submit", "/approvals/", "/decision", "/publish", "/restore", "/archive"]) {
    assert.match(api, new RegExp(fragment.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(api, /localStorage|Bearer|fetch\(|axiosClient\.delete/);
});

check("Leadership manager exposes every backend leadership field", () => {
  for (const field of [
    "profile_key",
    "slug",
    "full_name",
    "position_title",
    "professional_summary",
    "biography",
    "portrait_media_asset_id",
    "signature_media_asset_id",
    "social_links",
    "sort_order",
  ]) {
    assert.match(manager, new RegExp(field));
  }
});

check("structured biography is preserved until deliberately replaced", () => {
  assert.match(manager, /original_biography/);
  assert.match(manager, /has_structured_biography/);
  assert.match(manager, /return form\.original_biography/);
  assert.doesNotMatch(manager, /dangerouslySetInnerHTML|contentEditable|eval\(/);
});

check("social and contact fields match the backend allowlist", () => {
  for (const key of ["website", "linkedin", "facebook", "instagram", "x", "youtube", "email", "phone"]) {
    assert.match(manager, new RegExp(`\["${key}"`));
  }
  assert.match(manager, /mailto:/);
  assert.match(manager, /tel:\+233/);
});

check("every mutation is controlled by its exact permission", () => {
  for (const permission of ["create", "edit", "submit", "approve", "publish", "restore", "archive"]) {
    assert.match(manager, new RegExp(`CONTENT_STUDIO_PERMISSIONS\\.${permission}`));
  }
});

check("approval evidence is matched to the selected exact generic version", () => {
  assert.match(manager, /content_version_id/);
  assert.match(manager, /selectedVersionId/);
  assert.match(manager, /pendingApproval/);
  assert.match(manager, /approvedApproval/);
  assert.match(manager, /submitPortfolioVersion\(KIND, selectedId, selectedVersionId/);
  assert.match(manager, /publishPortfolioVersion\(KIND, selectedId, selectedVersionId/);
});

check("non-draft profiles remain read-only and can create a fresh draft", () => {
  assert.match(manager, /selectedVersion\?\.version_status === "draft"/);
  assert.match(manager, /Create new draft/);
  assert.match(manager, /disabled=\{!editable\}/);
});

check("media guidance reflects public-ready publication requirements", () => {
  assert.match(manager, /Must be an active image/);
  assert.match(manager, /public and ready status/);
  assert.match(manager, /Signature media asset ID/);
});

check("archive is confirmed and never uses DELETE", () => {
  assert.match(manager, /window\.confirm/);
  assert.match(manager, /Archive this leadership profile/);
  assert.doesNotMatch(api, /axiosClient\.delete/);
});

check("responsive styling includes a one-column link layout on mobile", () => {
  assert.match(css, /grid-template-columns: repeat\(2/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /grid-template-columns: 1fr/);
});

console.log(`\nContent Studio Leadership Manager: ${passed}/10 checks passed.`);
