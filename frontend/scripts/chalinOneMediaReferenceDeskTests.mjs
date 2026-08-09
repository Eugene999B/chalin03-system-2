import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(frontendRoot, "src/chalin-one/content-studio");
const model = await import(
  pathToFileURL(path.join(root, "contentStudioMediaReferenceModel.js")).href
);
const deskSource = fs.readFileSync(path.join(root, "ContentStudioMediaReferenceDesk.jsx"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "contentStudioMediaReferenceDesk.css"), "utf8");
const workspaceSource = fs.readFileSync(path.join(root, "ContentStudioWorkspace.jsx"), "utf8");
const studioModelSource = fs.readFileSync(path.join(root, "contentStudioModel.js"), "utf8");

let passed = 0;
function check(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}

check("duplicate grouping ignores missing checksums and ranks the strongest canonical candidate first", () => {
  const groups = model.groupDuplicates([
    { id: 8, checksum_sha256: "same", visibility: "private", public_ready: true, usage_count: 0 },
    { id: 7, checksum_sha256: "same", visibility: "public", public_ready: true, usage_count: 2 },
    { id: 9, checksum_sha256: "other", visibility: "public", public_ready: true, usage_count: 1 },
    { id: 10, checksum_sha256: "", visibility: "public", public_ready: true },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].checksum, "same");
  assert.deepEqual(groups[0].assets.map((asset) => asset.id), [7, 8]);
});

check("usage routing sends references back to the correct governed manager", () => {
  assert.deepEqual(model.usageDestination("page_section_primary"), { manager: "pages", label: "Pages" });
  assert.deepEqual(model.usageDestination("news_featured"), { manager: "newsroom", label: "Newsroom" });
  assert.deepEqual(model.usageDestination("project_version_snapshot"), { manager: "projects", label: "Projects" });
  assert.deepEqual(model.usageDestination("equipment_featured"), { manager: "equipment", label: "Public Equipment" });
  assert.deepEqual(model.usageDestination("leadership_portrait"), { manager: "leadership", label: "Leadership" });
  assert.deepEqual(model.usageDestination("location_featured"), { manager: "company-info", label: "Company Information" });
  assert.deepEqual(model.usageDestination("unknown_relationship"), { manager: "media", label: "Media Library" });
});

check("resolution planning never marks canonical or referenced copies as removable", () => {
  const group = {
    checksum: "same",
    assets: [{ id: 1 }, { id: 2 }, { id: 3 }],
  };
  const usage = {
    1: [],
    2: [{ type: "news_featured", id: 40, label: "story" }],
    3: [],
  };
  const plan = model.duplicateResolutionPlan(group, 1, usage);
  assert.deepEqual(plan.removable.map((row) => row.asset.id), [3]);
  assert.deepEqual(plan.migrationNeeded.map((row) => row.asset.id), [2]);
  assert.equal(plan.totalReferences, 1);
  assert.equal(plan.rows.find((row) => row.asset.id === 1).isCanonical, true);
});

check("reference desk uses exact per-asset usage before exposing duplicate archive", () => {
  assert.match(deskSource, /getMediaUsage/);
  assert.match(deskSource, /usageLoadedFor/);
  assert.match(deskSource, /exactAuditReady/);
  assert.match(deskSource, /bulkArchiveMediaPro/);
  assert.match(deskSource, /backend will re-check every reference before committing/);
  assert.match(deskSource, /Immutable-history rule/);
  assert.match(deskSource, /Historical content versions were not rewritten/);
  assert.doesNotMatch(deskSource, /updatePageDraft|updateNewsroomDraft|updatePortfolioDraft|JSON_SET|snapshot_json/);
});

check("reference desk guides migrations into governed managers instead of replacing historical IDs", () => {
  assert.match(deskSource, /onOpenSection\?\.\(group\.manager\)/);
  assert.match(deskSource, /create\/edit drafts, choose the canonical asset, then review and publish/);
  assert.doesNotMatch(deskSource, /replace everywhere|replaceAllReferences|bulkReplace|rewrite/i);
});

check("reference desk remains management-only and within the existing media Studio scope", () => {
  assert.match(studioModelSource, /key:\s*"media-reference"/);
  assert.match(studioModelSource, /label:\s*"Media Reference Desk"/);
  assert.match(studioModelSource, /permission:\s*CONTENT_STUDIO_PERMISSIONS\.mediaManage/);
  assert.match(workspaceSource, /ContentStudioMediaReferenceDesk/);
  assert.match(workspaceSource, /"media-reference":\s*"media"/);
  assert.match(workspaceSource, /"media-reference":\s*ContentStudioMediaReferenceDesk/);
});

check("reference desk has deliberate tablet phone and reduced-motion layouts", () => {
  assert.match(cssSource, /@media\(max-width:1100px\)/);
  assert.match(cssSource, /@media\(max-width:760px\)/);
  assert.match(cssSource, /@media\(max-width:480px\)/);
  assert.match(cssSource, /scroll-snap-type:x mandatory/);
  assert.match(cssSource, /prefers-reduced-motion/);
});

console.log(`\nMedia Reference Desk: ${passed}/7 checks passed.`);
