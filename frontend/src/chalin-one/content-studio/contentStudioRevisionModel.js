import {
  getVisualPageTemplate,
  visualSectionsFromTemplate,
} from "./contentStudioPageTemplateModel";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const REVISION_APPLICATION_MODES = Object.freeze([
  Object.freeze({
    key: "fill_gaps",
    label: "Fill gaps",
    description: "Keep every existing block and add only template section types that are not already present.",
  }),
  Object.freeze({
    key: "append",
    label: "Append all",
    description: "Keep every existing block and append the complete template sequence, including repeated section types.",
  }),
  Object.freeze({
    key: "replace",
    label: "Replace canvas",
    description: "Replace the current section canvas with the selected template. Existing draft blocks are removed from the working plan.",
  }),
]);

function sectionType(section) {
  return String(section?.section_type || section?.type || "custom").trim().toLowerCase();
}

function countTypes(sections = []) {
  const counts = {};
  for (const section of sections) {
    const type = sectionType(section);
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function reindex(sections = []) {
  return sections.map((section, index) => ({ ...clone(section), sort_order: index }));
}

export function templateMatchesPageContext(templateKey, homepage) {
  const template = getVisualPageTemplate(templateKey);
  if (!template) return false;
  return homepage ? template.homepageOnly === true : template.homepageOnly !== true;
}

export function analyzeTemplateApplication({
  templateKey,
  sections = [],
  homepage = false,
  mode = "fill_gaps",
} = {}) {
  const template = getVisualPageTemplate(templateKey);
  const current = reindex(Array.isArray(sections) ? sections : []);
  const allowed = templateMatchesPageContext(templateKey, homepage);
  const currentCounts = countTypes(current);
  const templateCounts = countTypes(template?.sections || []);
  const overlaps = Object.keys(templateCounts)
    .filter((type) => currentCounts[type] > 0)
    .map((type) => ({
      type,
      current: currentCounts[type],
      template: templateCounts[type],
    }));
  const currentHasHomepageHero = homepage && currentCounts.hero > 0;

  if (!template || !allowed) {
    return {
      allowed: false,
      template,
      mode,
      current,
      planned: current,
      overlaps,
      added: 0,
      removed: 0,
      skipped: 0,
      currentHasHomepageHero,
      warnings: [
        !template
          ? "The selected template is unavailable."
          : homepage
            ? "Homepage drafts may only use the dedicated Homepage Orchestration template."
            : "Homepage Orchestration can only be applied to the governed homepage page record.",
      ],
    };
  }

  const generated = visualSectionsFromTemplate(templateKey, mode === "replace" ? [] : current);
  let planned = current;
  let skipped = 0;

  if (mode === "replace") {
    planned = generated;
  } else if (mode === "append") {
    planned = [...current, ...generated];
  } else {
    const existingTypes = new Set(current.map(sectionType));
    const additions = generated.filter((section) => {
      const duplicate = existingTypes.has(sectionType(section));
      if (duplicate) skipped += 1;
      return !duplicate;
    });
    planned = [...current, ...additions];
  }

  planned = reindex(planned);
  const added = mode === "replace"
    ? planned.length
    : Math.max(0, planned.length - current.length);
  const removed = mode === "replace" ? current.length : 0;
  const warnings = [];

  if (overlaps.length && mode === "append") {
    warnings.push("Append all will intentionally create repeated section types. Review the overlap list before committing.");
  }
  if (mode === "replace" && current.length) {
    warnings.push(`Replace canvas removes ${current.length} current draft block${current.length === 1 ? "" : "s"} from the working plan.`);
  }
  if (currentHasHomepageHero) {
    warnings.push("This homepage draft contains a Hero block. The public homepage ignores governed Hero blocks because its cinematic opening is permanent.");
  }
  if (mode === "fill_gaps" && skipped) {
    warnings.push(`${skipped} template block${skipped === 1 ? " was" : "s were"} skipped because the same section type already exists.`);
  }

  return {
    allowed: true,
    template,
    mode,
    current,
    planned,
    overlaps,
    added,
    removed,
    skipped,
    currentHasHomepageHero,
    warnings,
  };
}

export function revisionSnapshot(sections = []) {
  return reindex(Array.isArray(sections) ? sections : []);
}

export function revisionSequencesEqual(left = [], right = []) {
  return JSON.stringify(revisionSnapshot(left)) === JSON.stringify(revisionSnapshot(right));
}

export function revisionTypeSummary(sections = []) {
  return Object.entries(countTypes(sections)).map(([type, count]) => ({ type, count }));
}
