import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(frontendRoot, "src/chalin-one/content-studio");
const api = fs.readFileSync(path.join(root, "contentStudioPageApi.js"), "utf8");
const manager = fs.readFileSync(path.join(root, "ContentStudioPageManager.jsx"), "utf8");

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`✓ ${name}`); }

check("page API maps the complete governed backend workflow", () => {
  for (const fragment of [
    "/content-studio/pages",
    "/versions",
    "/submit",
    "/content-studio/approvals/",
    "/decision",
    "/publish",
    "/restore",
    "/archive",
  ]) assert.match(api, new RegExp(fragment.replaceAll("/", "\\/")));
  assert.doesNotMatch(api, /localStorage|Bearer|fetch\(/);
});

check("page manager gates every action by its exact permission", () => {
  for (const permission of ["create", "edit", "submit", "approve", "publish", "restore", "archive"]) {
    assert.match(manager, new RegExp(`CONTENT_STUDIO_PERMISSIONS\\.${permission}`));
  }
});

check("editor supports page identity, content, sections and SEO without raw HTML", () => {
  for (const field of ["page_key", "slug", "title", "summary", "sections", "seo_title", "meta_description"]) {
    assert.match(manager, new RegExp(field));
  }
  assert.match(manager, /Add section/);
  assert.match(manager, /Reusable sections/);
  assert.doesNotMatch(manager, /dangerouslySetInnerHTML|contentEditable|eval\(/);
});

check("existing structured section JSON is preserved until its text is edited", () => {
  assert.match(manager, /original_content/);
  assert.match(manager, /if \(section\.content_text === originalText\)/);
  assert.match(manager, /has_structured_content/);
  assert.match(manager, /return section\.original_content/);
});

check("section types match the backend allowlist", () => {
  for (const type of ["text", "hero", "split", "image", "video", "statistics", "divisions", "leadership", "projects", "equipment", "news", "testimonials", "gallery", "cta", "contact", "faq", "form", "custom"]) {
    assert.match(manager, new RegExp(`value=\\"${type}\\"`));
  }
  assert.doesNotMatch(manager, /value=\"rich_text\"|value=\"feature_grid\"|value=\"call_to_action\"/);
});

check("review and publication target the selected exact version", () => {
  assert.match(manager, /selectedVersionId/);
  assert.match(manager, /page_version_id/);
  assert.match(manager, /pendingApproval/);
  assert.match(manager, /approvedApproval/);
  assert.match(manager, /submitPageVersion\(selectedId, selectedVersionId/);
  assert.match(manager, /publishPageVersion\(selectedId, selectedVersionId/);
});

check("non-draft content cannot be edited in place", () => {
  assert.match(manager, /selectedVersion\?\.version_status === "draft"/);
  assert.match(manager, /Create new draft/);
  assert.match(manager, /disabled=\{!editable\}/);
});

check("archive requires explicit confirmation and history is not deleted", () => {
  assert.match(manager, /window\.confirm/);
  assert.match(manager, /Archive this page/);
  assert.doesNotMatch(api, /axiosClient\.delete/);
});

check("requests are abortable and errors use the shared safe formatter", () => {
  assert.match(manager, /new AbortController\(\)/);
  assert.match(manager, /controller\.abort\(\)/);
  assert.match(manager, /contentStudioErrorMessage/);
});

console.log(`\nContent Studio Page Manager: ${passed}/9 checks passed.`);
