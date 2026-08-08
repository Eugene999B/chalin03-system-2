import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

const completion = read("src/chalin-one/public-site/PublicExperienceCompletion.jsx");
const completionCss = read("src/chalin-one/public-site/publicExperienceCompletion.css");
const accessibilityCss = read("src/chalin-one/public-site/publicExperienceAccessibility.css");
const explorerCss = read("src/chalin-one/public-site/publicCollectionExplorer.css");
const detailCompanion = read("src/chalin-one/public-site/PublicDetailCompanion.jsx");
const detailCss = read("src/chalin-one/public-site/publicDetailCompanion.css");
const standalone = read("src/chalin-one/ChalinOneStandaloneEntry.jsx");

for (const resource of ["divisions", "equipment", "projects", "news", "vacancies", "locations"]) {
  assert.match(completion, new RegExp(`key: \\"${resource}\\"`));
}
assert.match(completion, /Promise\.allSettled/);
assert.match(completion, /Search CHALIN ONE/);
assert.match(completion, /Find anything published/);
assert.match(completion, /event\.key === "\/"/);
assert.match(completion, /chalin_one_recent_public_pages/);
assert.match(completion, /contextualActions/);
assert.match(completion, /c1-mobile-discovery-trigger/);
assert.match(completion, /c1-completion-rail/);

for (const route of ["equipment", "projects", "news", "careers"]) {
  assert.match(completion, new RegExp(`\\"/${route}\\": \\{`));
}
assert.match(completion, /COLLECTION_EXPLORERS/);
assert.match(completion, /CollectionExplorer/);
assert.match(completion, /facetOptions/);
assert.match(completion, /Filters appear only from published metadata/);
assert.match(completion, /item\?\.category\?\.name/);
assert.match(completion, /item\?\.manufacturer/);
assert.match(completion, /item\?\.availability/);
assert.match(completion, /item\?\.division\?\.name/);
assert.match(completion, /item\?\.employment_type/);
assert.match(completion, /item\?\.location\?\.name/);
assert.match(completion, /setFilters/);
assert.match(completion, /Clear filters/);
assert.match(completion, /Search whole CHALIN ONE/);
assert.doesNotMatch(completion, /diesel|excavator|bulldozer|full[- ]time|part[- ]time/i);

assert.match(completion, /link\[rel="canonical"\]/);
assert.match(completion, /og:title/);
assert.match(completion, /og:description/);
assert.match(completion, /og:url/);
assert.match(completion, /twitter:card/);
assert.match(completion, /c1-skip-link/);
assert.match(completion, /c1-route-announcer/);
assert.match(completion, /c1-main-content/);

assert.match(completionCss, /publicExperienceAccessibility\.css/);
assert.match(completionCss, /@media \(max-width: 1240px\)/);
assert.match(completionCss, /@media \(max-width: 760px\)/);
assert.match(completionCss, /max-height: 92dvh/);
assert.match(completionCss, /safe-area-inset-bottom/);
assert.match(accessibilityCss, /publicCollectionExplorer\.css/);
assert.match(accessibilityCss, /\.c1-skip-link:focus/);
assert.match(accessibilityCss, /\.c1-route-announcer/);
assert.match(accessibilityCss, /prefers-reduced-motion/);
assert.match(explorerCss, /\.c1-explorer-facets/);
assert.match(explorerCss, /\.c1-explorer-results/);
assert.match(explorerCss, /\.c1-explorer-summary/);
assert.match(explorerCss, /@media \(max-width: 760px\)/);
assert.match(explorerCss, /@media \(max-width: 390px\)/);
assert.match(explorerCss, /prefers-reduced-motion/);

for (const marker of ["equipment", "projects", "news", "careers"]) {
  assert.match(detailCompanion, new RegExp(`${marker}: \\{`));
}
assert.match(detailCompanion, /getPublicResource/);
assert.match(detailCompanion, /listPublicResource/);
assert.match(detailCompanion, /relatedRecords/);
assert.match(detailCompanion, /comparableValues/);
assert.match(detailCompanion, /score > 0/);
assert.match(detailCompanion, /Connected by published metadata/);
assert.match(detailCompanion, /VERIFIED PUBLIC FIELDS/);
assert.match(detailCompanion, /item\?\.manufacturer/);
assert.match(detailCompanion, /item\?\.model/);
assert.match(detailCompanion, /item\?\.availability/);
assert.match(detailCompanion, /item\?\.category\?\.name/);
assert.match(detailCompanion, /item\?\.division\?\.name/);
assert.match(detailCompanion, /item\?\.employment_type/);
assert.match(detailCompanion, /locationValue/);
assert.doesNotMatch(detailCompanion, /localStorage|sessionStorage|Bearer|Authorization/);
assert.match(detailCss, /\.c1-detail-companion-trigger/);
assert.match(detailCss, /\.c1-detail-facts/);
assert.match(detailCss, /\.c1-detail-related/);
assert.match(detailCss, /@media \(max-width: 800px\)/);
assert.match(detailCss, /safe-area-inset-bottom/);
assert.match(detailCss, /prefers-reduced-motion/);

assert.match(standalone, /PublicExperienceCompletion/);
assert.match(standalone, /PublicDetailCompanion/);
assert.match(standalone, /<PublicDetailCompanion \/>/);
assert.match(standalone, /PublicStandaloneLoading/);
assert.match(standalone, /Loading secure workspace/);
assert.doesNotMatch(standalone, />\s*Opening CHALIN ONE…\s*</);
assert.match(standalone, /feature="publicWebsite"/);
assert.match(standalone, /<PublicExperienceCompletion \/>/);

console.log(
  "✅ CHALIN ONE Phase 1C public completion contracts passed: quiet public boot, governed discovery, derived collection filters, published detail facts, metadata-related records, responsive explorer, route metadata and accessibility helpers remain protected."
);
