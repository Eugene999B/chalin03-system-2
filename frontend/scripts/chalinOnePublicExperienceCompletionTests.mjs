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
assert.match(accessibilityCss, /\.c1-skip-link:focus/);
assert.match(accessibilityCss, /\.c1-route-announcer/);
assert.match(accessibilityCss, /prefers-reduced-motion/);

assert.match(standalone, /PublicExperienceCompletion/);
assert.match(standalone, /PublicStandaloneLoading/);
assert.match(standalone, /Loading secure workspace/);
assert.doesNotMatch(standalone, />\s*Opening CHALIN ONE…\s*</);
assert.match(standalone, /feature="publicWebsite"/);
assert.match(standalone, /<PublicExperienceCompletion \/>/);

console.log(
  "✅ CHALIN ONE Phase 1C public completion contracts passed: quiet public boot, governed discovery, responsive search, route metadata and accessibility helpers remain protected."
);
