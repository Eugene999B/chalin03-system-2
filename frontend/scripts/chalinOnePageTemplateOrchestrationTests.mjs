import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");

const model = read("src/chalin-one/content-studio/contentStudioPageTemplateModel.js");
const pro = read("src/chalin-one/content-studio/ContentStudioVisualBuilderPro.jsx");
const css = read("src/chalin-one/content-studio/contentStudioVisualBuilderPro.css");
const workspace = read("src/chalin-one/content-studio/ContentStudioWorkspace.jsx");
const packageJson = read("package.json");

for (const templateKey of [
  "homepage-orchestration",
  "corporate-profile",
  "business-story",
  "field-showcase",
  "information-hub",
]) {
  assert.match(model, new RegExp(`key: "${templateKey}"`), `${templateKey} template missing`);
}

assert.match(model, /VISUAL_PAGE_TEMPLATES/);
assert.match(model, /VISUAL_PAGE_TEMPLATE_CATEGORIES/);
assert.match(model, /getVisualPageTemplate/);
assert.match(model, /visualTemplatesForContext/);
assert.match(model, /visualSectionsFromTemplate/);
assert.match(model, /visualTemplateSectionLabels/);
assert.match(model, /createVisualSection/);
assert.match(model, /getVisualSectionDefinition/);

const homepageStart = model.indexOf('key: "homepage-orchestration"');
const nextTemplate = model.indexOf('key: "corporate-profile"');
const homepageTemplate = model.slice(homepageStart, nextTemplate);
assert.match(homepageTemplate, /homepageOnly: true/);
assert.doesNotMatch(homepageTemplate, /blueprint\(\s*"hero"/);
assert.match(homepageTemplate, /blueprint\(\s*"split"/);
assert.match(homepageTemplate, /blueprint\(\s*"statistics"/);
assert.match(homepageTemplate, /blueprint\(\s*"testimonials"/);
assert.match(homepageTemplate, /blueprint\(\s*"faq"/);
assert.match(homepageTemplate, /blueprint\(\s*"contact"/);

assert.match(pro, /ContentStudioVisualBuilder from "\.\/ContentStudioVisualBuilder"/);
assert.match(pro, /CONTENT_STUDIO_PERMISSIONS\.create/);
assert.match(pro, /createPage/);
assert.match(pro, /visualSectionsFromTemplate/);
assert.match(pro, /sections\.map\(visualSectionForSave\)/);
assert.match(pro, /page_type: homepage \? "landing" : "standard"/);
assert.match(pro, /template_key: homepage \? "feature" : "standard"/);
assert.match(pro, /is_homepage: homepage/);
assert.match(pro, /Nothing becomes public until review and publication complete/i);
assert.match(pro, /No duplicate homepage hero/i);
assert.match(pro, /cinematic homepage opening/i);
assert.match(pro, /Permanent public shell/);
assert.match(pro, /Governed builder layer/);
assert.match(pro, /Permanent closing systems/);
assert.match(pro, /TemplateSequence/);
assert.match(pro, /Template library/);
assert.match(pro, /Create from template/);
assert.match(pro, /key=\{builderKey\}/);
assert.doesNotMatch(pro, /dangerouslySetInnerHTML/);
assert.doesNotMatch(pro, /<iframe/i);
assert.doesNotMatch(pro, /eval\s*\(/);
assert.doesNotMatch(pro, /new Function/);

assert.match(workspace, /import ContentStudioVisualBuilder from "\.\/ContentStudioVisualBuilderPro"/);
assert.match(workspace, /"visual-builder": ContentStudioVisualBuilder/);
assert.match(workspace, /"visual-builder": "pages"/);

assert.match(css, /\.cs-vbt-home-orchestration/);
assert.match(css, /\.cs-vbt-grid/);
assert.match(css, /\.cs-vbt-sequence/);
assert.match(css, /\.cs-vbt-create/);
assert.match(css, /@media \(max-width: 1260px\)/);
assert.match(css, /@media \(max-width: 900px\)/);
assert.match(css, /@media \(max-width: 620px\)/);
assert.match(css, /@media \(max-width: 390px\)/);
assert.match(css, /100dvh/);
assert.match(css, /safe-area-inset-top/);
assert.match(css, /scroll-snap-type: x mandatory/);
assert.match(css, /pointer: coarse/);
assert.match(css, /prefers-reduced-motion: reduce/);

assert.match(packageJson, /chalinOnePageTemplateOrchestrationTests\.mjs/);

console.log("✅ CHALIN ONE Phase 2C page-template orchestration contracts passed: governed reusable compositions, homepage no-duplicate-hero semantics, permission-gated draft creation, responsive template preview and existing Visual Builder hand-off remain protected.");
