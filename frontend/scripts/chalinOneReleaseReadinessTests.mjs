import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectReleaseLinks,
  collectReleaseMediaIds,
  compareReleaseMetadata,
  compareReleaseSections,
  evaluatePageReleaseReadiness,
  inspectPublicLink,
  selectReleaseVersions,
} from "../src/chalin-one/content-studio/contentStudioReleaseReadinessModel.js";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");

const component = read("src/chalin-one/content-studio/ContentStudioReleaseReadiness.jsx");
const css = read("src/chalin-one/content-studio/contentStudioReleaseReadiness.css");
const suite = read("src/chalin-one/content-studio/ContentStudioVisualBuilderPro.jsx");

const published = {
  id: 10,
  version_number: 2,
  version_status: "published",
  title: "Company profile",
  seo_title: "Company profile",
  meta_description: "A published description that is deliberately long enough to represent a normal public search and social summary for comparison.",
  robots_directive: "index,follow",
  change_summary: "Published baseline",
  sections: [
    { section_key: "story", section_type: "text", heading: "Story", content_json: { text: "Old" }, sort_order: 0, is_enabled: true },
    { section_key: "proof", section_type: "statistics", heading: "Proof", content_json: { items: [{ value: "1", label: "Metric" }] }, sort_order: 1, is_enabled: true },
    { section_key: "closing", section_type: "cta", heading: "Contact", content_json: { primary_label: "Contact", primary_url: "/contact" }, sort_order: 2, is_enabled: true },
  ],
};

const candidate = {
  id: 11,
  version_number: 3,
  version_status: "draft",
  title: "Company profile updated",
  seo_title: "Company profile updated",
  meta_description: "An updated description that remains intentionally long enough to provide a useful search and social summary for public release.",
  robots_directive: "index,follow",
  change_summary: "Refresh company story",
  sections: [
    { section_key: "proof", section_type: "statistics", heading: "Proof", content_json: { items: [{ value: "2", label: "Metric" }] }, sort_order: 0, is_enabled: true },
    { section_key: "story", section_type: "text", heading: "Story", content_json: { text: "New" }, sort_order: 1, is_enabled: true },
    { section_key: "gallery", section_type: "image", heading: "Gallery", content_json: { link_url: "https://example.com/story" }, primary_media_asset_id: 44, sort_order: 2, is_enabled: true },
  ],
};

const selected = selectReleaseVersions({ versions: [candidate, published] });
assert.equal(selected.candidate.id, 11);
assert.equal(selected.published.id, 10);

const sectionDiff = compareReleaseSections(candidate, published);
assert.equal(sectionDiff.counts.added, 1);
assert.equal(sectionDiff.counts.removed, 1);
assert.equal(sectionDiff.counts.changed, 2);
assert.equal(sectionDiff.changes.find((item) => item.key === "gallery")?.status, "added");
assert.equal(sectionDiff.changes.find((item) => item.key === "closing")?.status, "removed");

const metadataDiff = compareReleaseMetadata(candidate, published);
assert.equal(metadataDiff.find((item) => item.key === "title")?.changed, true);
assert.equal(metadataDiff.find((item) => item.key === "robots_directive")?.changed, false);

assert.deepEqual(collectReleaseMediaIds(candidate), [44]);
assert.ok(collectReleaseLinks(candidate).some((item) => item.value === "https://example.com/story"));
assert.equal(inspectPublicLink("/contact").safe, true);
assert.equal(inspectPublicLink("/contact").resolved, true);
assert.equal(inspectPublicLink("/unknown-root").safe, true);
assert.equal(inspectPublicLink("/unknown-root").resolved, false);
assert.equal(inspectPublicLink("http://example.com").safe, false);
assert.equal(inspectPublicLink("javascript:alert(1)").safe, false);
assert.equal(inspectPublicLink("https://example.com/company", { canonical: true }).safe, true);
assert.equal(inspectPublicLink("/company", { canonical: true }).safe, false);

const blocked = evaluatePageReleaseReadiness({
  page: { slug: "company-profile", show_in_search: true, is_homepage: false },
  candidate: {
    ...candidate,
    sections: [
      ...candidate.sections,
      { section_key: "gallery", section_type: "form", content_json: { form_key: "", action_url: "http://unsafe.example" }, sort_order: 3, is_enabled: true },
    ],
  },
  published,
  mediaAudit: {
    available: true,
    complete: true,
    items: [{ id: 44, media_type: "image", visibility: "private", processing_status: "ready", alt_text: "" }],
  },
});
assert.equal(blocked.state, "blocked");
assert.ok(blocked.issues.some((item) => item.code === "section-key-duplicate"));
assert.ok(blocked.issues.some((item) => item.code === "form-key-missing"));
assert.ok(blocked.issues.some((item) => item.code === "link-unsafe"));
assert.ok(blocked.issues.some((item) => item.code === "media-private"));
assert.ok(blocked.issues.some((item) => item.code === "media-alt"));

const partialMedia = evaluatePageReleaseReadiness({
  page: { slug: "company-profile", show_in_search: true },
  candidate,
  published,
  mediaAudit: { available: true, complete: false, items: [] },
});
assert.ok(partialMedia.issues.some((item) => item.code === "media-missing" && item.severity === "warning"));
assert.equal(partialMedia.issues.some((item) => item.code === "media-missing" && item.severity === "blocker"), false);

const firstPublication = evaluatePageReleaseReadiness({
  page: { slug: "new-page", show_in_search: true },
  candidate: {
    version_status: "draft",
    title: "New page",
    seo_title: "New page",
    meta_description: "A deliberately complete meta description for a first public release that gives visitors and search surfaces useful context before they open this page.",
    robots_directive: "index,follow",
    change_summary: "Initial public page",
    sections: [{ section_key: "story", section_type: "text", content_json: { text: "Approved public story" }, sort_order: 0, is_enabled: true }],
  },
  published: null,
  mediaAudit: { available: true, complete: true, items: [] },
});
assert.ok(firstPublication.issues.some((item) => item.code === "first-publication" && item.severity === "info"));
assert.equal(firstPublication.blockers, 0);

const ready = evaluatePageReleaseReadiness({
  page: { slug: "ready-page", show_in_search: true, show_in_sitemap: true },
  candidate: {
    version_status: "approved",
    title: "Ready page",
    seo_title: "Ready page",
    meta_description: "A complete public meta description that provides enough useful context for search and social surfaces while staying concise and deliberate.",
    robots_directive: "index,follow",
    change_summary: "Approved release candidate",
    sections: [{ section_key: "story", section_type: "text", content_json: { text: "Ready" }, sort_order: 0, is_enabled: true }],
  },
  published: {
    version_status: "published",
    title: "Ready page old",
    sections: [{ section_key: "story", section_type: "text", content_json: { text: "Old" }, sort_order: 0, is_enabled: true }],
  },
  mediaAudit: { available: true, complete: true, items: [] },
});
assert.equal(ready.state, "ready");
assert.equal(ready.blockers, 0);
assert.equal(ready.warnings, 0);

for (const contract of [
  /selectReleaseVersions/,
  /compareReleaseSections/,
  /compareReleaseMetadata/,
  /evaluatePageReleaseReadiness/,
  /listPages/,
  /getPage/,
  /listMedia/,
  /READ ONLY/,
  /No approval · no publish/,
  /RELEASE CHECKLIST/,
  /Candidate .* Published/,
  /MEDIA AUDIT/,
]) assert.match(component, contract);

assert.doesNotMatch(component, /publishPageVersion/);
assert.doesNotMatch(component, /submitPageVersion/);
assert.doesNotMatch(component, /decidePageApproval/);
assert.doesNotMatch(component, /updatePageDraft/);
assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
assert.doesNotMatch(component, /<iframe/i);
assert.doesNotMatch(component, /eval\s*\(/);
assert.doesNotMatch(component, /new Function/);

assert.match(suite, /ContentStudioReleaseReadiness/);
assert.match(suite, /<ContentStudioReleaseReadiness \/>/);

for (const contract of [
  /\.cs-rr-comparisons/,
  /\.cs-rr-issues\.is-blocker/,
  /\.cs-rr-change\.is-added/,
  /\.cs-rr-change\.is-removed/,
  /@media \(max-width: 1180px\)/,
  /@media \(max-width: 900px\)/,
  /@media \(max-width: 620px\)/,
  /@media \(max-width: 390px\)/,
  /scroll-snap-type: x mandatory/,
  /pointer: coarse/,
  /prefers-reduced-motion: reduce/,
]) assert.match(css, contract);

console.log("✅ CHALIN ONE Phase 2E Release Readiness contracts passed: published-vs-candidate comparison, section/SEO diffs, safe-link and media readiness checks, responsive release checklist and read-only governance remain protected.");
