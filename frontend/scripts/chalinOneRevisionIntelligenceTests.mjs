import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(currentFile), "..");
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");

const component = read("src/chalin-one/content-studio/ContentStudioRevisionIntelligence.jsx");
const css = read("src/chalin-one/content-studio/contentStudioRevisionIntelligence.css");
const pro = read("src/chalin-one/content-studio/ContentStudioVisualBuilderPro.jsx");
const revisionModelSource = read("src/chalin-one/content-studio/contentStudioRevisionModel.js");
const templateModelSource = read("src/chalin-one/content-studio/contentStudioPageTemplateModel.js");

const testTemplates = {
  "homepage-orchestration": {
    key: "homepage-orchestration",
    homepageOnly: true,
    sections: [{ type: "split" }, { type: "statistics" }, { type: "faq" }, { type: "contact" }],
  },
  "corporate-profile": {
    key: "corporate-profile",
    homepageOnly: false,
    sections: [{ type: "hero" }, { type: "split" }, { type: "statistics" }, { type: "leadership" }, { type: "projects" }, { type: "cta" }],
  },
};

function getVisualPageTemplate(key) {
  return testTemplates[key] || null;
}

function visualSectionsFromTemplate(templateKey, existingSections = []) {
  const template = getVisualPageTemplate(templateKey);
  if (!template) return [];
  const used = new Set(existingSections.map((section) => String(section.section_key || "")));
  return template.sections.map((section, index) => {
    let suffix = index + 1;
    let key = `${section.type}_${suffix}`;
    while (used.has(key)) {
      suffix += 1;
      key = `${section.type}_${suffix}`;
    }
    used.add(key);
    return { section_key: key, section_type: section.type, sort_order: existingSections.length + index, is_enabled: true };
  });
}

const executableRevisionModel = revisionModelSource
  .replace(/import[\s\S]*?from "\.\/contentStudioPageTemplateModel";\s*/, "")
  .replace(/export const /g, "const ")
  .replace(/export function /g, "function ");

const loadRevisionModel = new Function(
  "getVisualPageTemplate",
  "visualSectionsFromTemplate",
  `${executableRevisionModel}\nreturn { REVISION_APPLICATION_MODES, analyzeTemplateApplication, revisionSequencesEqual, templateMatchesPageContext };`
);

const {
  REVISION_APPLICATION_MODES,
  analyzeTemplateApplication,
  revisionSequencesEqual,
  templateMatchesPageContext,
} = loadRevisionModel(getVisualPageTemplate, visualSectionsFromTemplate);

assert.deepEqual(REVISION_APPLICATION_MODES.map((item) => item.key), ["fill_gaps", "append", "replace"]);
assert.equal(templateMatchesPageContext("homepage-orchestration", true), true);
assert.equal(templateMatchesPageContext("homepage-orchestration", false), false);
assert.equal(templateMatchesPageContext("corporate-profile", true), false);
assert.equal(templateMatchesPageContext("corporate-profile", false), true);

const current = visualSectionsFromTemplate("corporate-profile").slice(0, 2);
const fill = analyzeTemplateApplication({ templateKey: "corporate-profile", sections: current, homepage: false, mode: "fill_gaps" });
assert.equal(fill.allowed, true);
assert.equal(fill.skipped, 2);
assert.equal(fill.planned.length, getVisualPageTemplate("corporate-profile").sections.length);
assert.equal(new Set(fill.planned.map((section) => section.section_key)).size, fill.planned.length);

const append = analyzeTemplateApplication({ templateKey: "corporate-profile", sections: current, homepage: false, mode: "append" });
assert.equal(append.planned.length, current.length + getVisualPageTemplate("corporate-profile").sections.length);
assert.ok(append.overlaps.length >= 2);

const replace = analyzeTemplateApplication({ templateKey: "corporate-profile", sections: current, homepage: false, mode: "replace" });
assert.equal(replace.removed, current.length);
assert.equal(replace.planned.length, getVisualPageTemplate("corporate-profile").sections.length);
assert.equal(revisionSequencesEqual(replace.planned, current), false);

const homepagePlan = analyzeTemplateApplication({ templateKey: "homepage-orchestration", sections: [], homepage: true, mode: "replace" });
assert.equal(homepagePlan.allowed, true);
assert.equal(homepagePlan.planned.some((section) => section.section_type === "hero"), false);

const blockedHomepage = analyzeTemplateApplication({ templateKey: "corporate-profile", sections: [], homepage: true, mode: "append" });
assert.equal(blockedHomepage.allowed, false);
assert.ok(blockedHomepage.warnings.some((warning) => /Homepage drafts may only use/i.test(warning)));

assert.match(templateModelSource, /key: "homepage-orchestration"/);
assert.match(revisionModelSource, /mode === "replace"/);
assert.match(revisionModelSource, /existingTypes\.has/);
assert.match(revisionModelSource, /currentHasHomepageHero/);

for (const contract of [
  /listPages/,
  /getPage/,
  /updatePageDraft/,
  /analyzeTemplateApplication/,
  /revisionSnapshot/,
  /visualSectionForSave/,
  /setHistory/,
  /setHistoryIndex/,
  /function undo\(/,
  /function redo\(/,
  /function reset\(/,
  /Stage template/,
  /Commit to draft/,
  /server draft is still unchanged/i,
  /public website remains unchanged until review and publication/i,
  /window\.confirm/,
]) {
  assert.match(component, contract);
}

assert.doesNotMatch(component, /publishPageVersion/);
assert.doesNotMatch(component, /submitPageVersion/);
assert.doesNotMatch(component, /decidePageApproval/);
assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
assert.doesNotMatch(component, /<iframe/i);
assert.doesNotMatch(component, /eval\s*\(/);
assert.doesNotMatch(component, /new Function/);

assert.match(pro, /ContentStudioRevisionIntelligence/);
assert.match(pro, /onCommitted=\{handleRevisionCommitted\}/);
assert.match(pro, /setBuilderKey\(\(value\) => value \+ 1\)/);

for (const contract of [
  /\.cs-ri-compare/,
  /\.cs-ri-overlaps/,
  /\.cs-ri-history/,
  /@media \(max-width: 1180px\)/,
  /@media \(max-width: 900px\)/,
  /@media \(max-width: 620px\)/,
  /@media \(max-width: 390px\)/,
  /scroll-snap-type: x mandatory/,
  /pointer: coarse/,
  /prefers-reduced-motion: reduce/,
]) {
  assert.match(css, contract);
}

console.log("✅ CHALIN ONE Phase 2D Revision Intelligence contracts passed: existing-draft template planning, homepage boundaries, duplicate analysis, local undo/redo and draft-only commit remain protected.");
