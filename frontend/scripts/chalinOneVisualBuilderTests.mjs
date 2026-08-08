import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const builder = read("src/chalin-one/content-studio/ContentStudioVisualBuilder.jsx");
const model = read("src/chalin-one/content-studio/contentStudioVisualBuilderModel.js");
const css = read("src/chalin-one/content-studio/contentStudioVisualBuilder.css");
const workspace = read("src/chalin-one/content-studio/ContentStudioWorkspace.jsx");
const studioModel = read("src/chalin-one/content-studio/contentStudioModel.js");
const operationsApi = read("src/chalin-one/content-studio/contentStudioOperationsApi.js");
const pageApi = read("src/chalin-one/content-studio/contentStudioPageApi.js");

const sectionTypes = [
  "hero",
  "text",
  "split",
  "image",
  "video",
  "gallery",
  "statistics",
  "testimonials",
  "divisions",
  "leadership",
  "projects",
  "equipment",
  "news",
  "faq",
  "contact",
  "form",
  "cta",
  "custom",
];

for (const type of sectionTypes) {
  assert.match(model, new RegExp(`type: "${type}"`), `${type} missing from Visual Builder library`);
}
assert.match(model, /VISUAL_SECTION_LIBRARY/);
assert.match(model, /VISUAL_SECTION_CATEGORIES/);
assert.match(model, /createVisualSection/);
assert.match(model, /reorderVisualSections/);
assert.match(model, /duplicateVisualSection/);
assert.match(model, /visualSectionForSave/);
assert.match(model, /safeVisualActionUrl/);
assert.match(model, /parsed\.protocol === "https:"/);
assert.match(model, /url\.startsWith\("\/"\)/);

assert.match(studioModel, /key: "visual-builder"/);
assert.match(studioModel, /label: "Visual Builder"/);
assert.match(studioModel, /permission: CONTENT_STUDIO_PERMISSIONS\.view/);
assert.match(workspace, /ContentStudioVisualBuilder/);
assert.match(workspace, /"visual-builder": "pages"/);
assert.match(workspace, /"visual-builder": ContentStudioVisualBuilder/);

assert.match(model, /VISUAL_PREVIEW_DEVICES/);
for (const device of ["desktop", "tablet", "mobile"]) {
  assert.match(model, new RegExp(`key: "${device}"`), `${device} preview device missing`);
}
assert.match(builder, /VISUAL_PREVIEW_DEVICES/);
assert.match(builder, /previewDevice/);
assert.match(builder, /setPreviewDevice/);
assert.match(builder, /data-mobile-surface=\{mobileSurface\}/);
assert.match(builder, /LIVE STUDIO PREVIEW/);
assert.match(builder, /governed public renderer remains the final publication surface/i);

assert.match(builder, /draggable=\{editable\}/);
assert.match(builder, /onDragStart/);
assert.match(builder, /onDragOver/);
assert.match(builder, /onDrop/);
assert.match(builder, /Move .* up/);
assert.match(builder, /Move .* down/);
assert.match(builder, /Duplicate/);
assert.match(builder, /Hide/);
assert.match(builder, /Remove/);
assert.match(builder, /SectionLibrary/);
assert.match(builder, /Add section/);

assert.match(builder, /listMedia/);
assert.match(builder, /visibility: "public"/);
assert.match(builder, /processing_status/);
assert.match(builder, /asset\.public_url/);
assert.match(builder, /Only public, ready assets/);
assert.match(operationsApi, /\/content-studio\/media/);

assert.match(builder, /updatePageDraft/);
assert.match(builder, /createPageVersion/);
assert.match(builder, /submitPageVersion/);
assert.match(builder, /Save visual draft/);
assert.match(builder, /Save & send to review/);
assert.match(builder, /public website was not changed until review and publication/i);
assert.match(pageApi, /\/content-studio\/pages/);

assert.match(builder, /Raw HTML and scripts are never accepted here/);
assert.doesNotMatch(builder, /dangerouslySetInnerHTML/);
assert.doesNotMatch(builder, /<iframe/i);
assert.doesNotMatch(builder, /eval\s*\(/);
assert.doesNotMatch(builder, /new Function/);

assert.match(css, /grid-template-columns: minmax\(220px, 265px\)/);
assert.match(css, /@media \(max-width: 1180px\)/);
assert.match(css, /@media \(max-width: 820px\)/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /@media \(max-width: 390px\)/);
assert.match(css, /100dvh/);
assert.match(css, /safe-area-inset-bottom/);
assert.match(css, /scroll-snap-type: x mandatory/);
assert.match(css, /pointer: coarse/);
assert.match(css, /prefers-reduced-motion: reduce/);

console.log(
  "✅ CHALIN ONE Phase 2B Visual Builder contracts passed: no-code section library, drag/reorder controls, approved-media picker, responsive device preview and governed draft/review flow remain protected."
);
