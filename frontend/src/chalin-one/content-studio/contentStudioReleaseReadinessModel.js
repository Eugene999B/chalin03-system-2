const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

const CANDIDATE_STATUSES = Object.freeze(["draft", "in_review", "approved", "scheduled"]);
const URL_KEY = /(^|_)(url|href|link)$/i;
const MEDIA_ID_KEY = /(^|_)(media_)?asset_id$/i;

export const RELEASE_READINESS_SEVERITIES = Object.freeze({
  blocker: "blocker",
  warning: "warning",
  info: "info",
});

export const BUILTIN_PUBLIC_ROUTE_ROOTS = Object.freeze(new Set([
  "",
  "about",
  "businesses",
  "projects",
  "equipment",
  "news",
  "leadership",
  "media",
  "careers",
  "locations",
  "contact",
  "faqs",
  "tenders",
  "testimonials",
  "forms",
  "pages",
  "website",
  "vacancies",
  "divisions",
]));

function cleanString(value) {
  return String(value ?? "").trim();
}

function cleanPositiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

export function stableReleaseValue(value) {
  return JSON.stringify(canonicalize(value ?? null));
}

export function selectReleaseVersions(details = {}) {
  const versions = Array.isArray(details?.versions) ? details.versions : [];
  const published = versions.find((version) => version?.version_status === "published") || null;
  let candidate = null;
  for (const status of CANDIDATE_STATUSES) {
    candidate = versions.find((version) => version?.version_status === status) || null;
    if (candidate) break;
  }
  if (!candidate) candidate = versions.find((version) => version?.version_status !== "published" && version?.version_status !== "archived") || versions[0] || null;
  return { candidate, published };
}

export function normalizeReleaseSection(section, index = 0) {
  const content = section?.content_json ?? section?.content ?? {};
  const settings = section?.settings_json ?? section?.settings ?? {};
  return {
    section_key: cleanString(section?.section_key || section?.key || `section_${index + 1}`),
    section_type: cleanString(section?.section_type || section?.type || "custom").toLowerCase(),
    heading: cleanString(section?.heading),
    subheading: cleanString(section?.subheading),
    content: clone(content && typeof content === "object" ? content : { text: String(content ?? "") }),
    settings: clone(settings && typeof settings === "object" ? settings : {}),
    primary_media_asset_id: cleanPositiveId(section?.primary_media_asset_id || section?.primary_media?.id),
    background_media_asset_id: cleanPositiveId(section?.background_media_asset_id || section?.background_media?.id),
    is_enabled: section?.is_enabled !== false,
    sort_order: Number.isInteger(Number(section?.sort_order)) ? Number(section.sort_order) : index,
  };
}

function sectionFingerprint(section) {
  const normalized = normalizeReleaseSection(section, Number(section?.sort_order || 0));
  return stableReleaseValue({
    section_type: normalized.section_type,
    heading: normalized.heading,
    subheading: normalized.subheading,
    content: normalized.content,
    settings: normalized.settings,
    primary_media_asset_id: normalized.primary_media_asset_id,
    background_media_asset_id: normalized.background_media_asset_id,
    is_enabled: normalized.is_enabled,
  });
}

export function compareReleaseSections(candidateVersion, publishedVersion) {
  const candidate = (candidateVersion?.sections || []).map(normalizeReleaseSection);
  const published = (publishedVersion?.sections || []).map(normalizeReleaseSection);
  const candidateMap = new Map(candidate.map((section, index) => [section.section_key, { section, index }]));
  const publishedMap = new Map(published.map((section, index) => [section.section_key, { section, index }]));
  const changes = [];

  for (const [key, current] of candidateMap) {
    const previous = publishedMap.get(key);
    if (!previous) {
      changes.push({ key, type: current.section.section_type, status: "added", beforeIndex: null, afterIndex: current.index });
      continue;
    }
    const contentChanged = sectionFingerprint(current.section) !== sectionFingerprint(previous.section);
    const moved = current.index !== previous.index;
    changes.push({
      key,
      type: current.section.section_type,
      status: contentChanged ? "changed" : moved ? "moved" : "unchanged",
      beforeIndex: previous.index,
      afterIndex: current.index,
      contentChanged,
      moved,
    });
  }

  for (const [key, previous] of publishedMap) {
    if (!candidateMap.has(key)) {
      changes.push({ key, type: previous.section.section_type, status: "removed", beforeIndex: previous.index, afterIndex: null });
    }
  }

  const counts = changes.reduce((result, change) => {
    result[change.status] = (result[change.status] || 0) + 1;
    return result;
  }, { added: 0, removed: 0, changed: 0, moved: 0, unchanged: 0 });

  return { candidate, published, changes, counts };
}

export function compareReleaseMetadata(candidateVersion = {}, publishedVersion = {}) {
  const fields = [
    ["title", "Page title"],
    ["subtitle", "Subtitle"],
    ["summary", "Summary"],
    ["seo_title", "SEO title"],
    ["meta_description", "Meta description"],
    ["canonical_url", "Canonical URL"],
    ["robots_directive", "Robots directive"],
    ["primary_media_asset_id", "Primary media"],
  ];
  return fields.map(([key, label]) => ({
    key,
    label,
    changed: stableReleaseValue(candidateVersion?.[key] ?? "") !== stableReleaseValue(publishedVersion?.[key] ?? ""),
    before: publishedVersion?.[key] ?? "",
    after: candidateVersion?.[key] ?? "",
  }));
}

function walkStructured(value, visitor, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStructured(item, visitor, [...path, index]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child, [...path, key]);
    if (child && typeof child === "object") walkStructured(child, visitor, [...path, key]);
  }
}

export function collectReleaseLinks(version = {}) {
  const links = [];
  const sections = (version?.sections || []).map(normalizeReleaseSection);
  sections.forEach((section, index) => {
    walkStructured(section.content, (key, value, path) => {
      if (URL_KEY.test(key) && typeof value === "string" && cleanString(value)) {
        links.push({ value: cleanString(value), sectionKey: section.section_key, sectionIndex: index, field: path.join(".") });
      }
    });
  });
  if (cleanString(version?.canonical_url)) links.push({ value: cleanString(version.canonical_url), sectionKey: "page", sectionIndex: -1, field: "canonical_url", canonical: true });
  return links;
}

export function inspectPublicLink(value, { canonical = false } = {}) {
  const url = cleanString(value);
  if (!url) return { safe: true, resolved: true, kind: "empty" };
  if (url.startsWith("/") && !url.startsWith("//")) {
    if (canonical) return { safe: false, resolved: false, kind: "canonical", reason: "Canonical URLs must use an absolute HTTPS address." };
    const root = url.split(/[?#]/)[0].split("/").filter(Boolean)[0] || "";
    return {
      safe: true,
      resolved: BUILTIN_PUBLIC_ROUTE_ROOTS.has(root),
      kind: "internal",
      reason: BUILTIN_PUBLIC_ROUTE_ROOTS.has(root) ? "" : "This internal root is not part of the governed public route families.",
    };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return { safe: false, resolved: false, kind: "external", reason: "Public links must use HTTPS." };
    return { safe: true, resolved: true, kind: canonical ? "canonical" : "external" };
  } catch {
    return { safe: false, resolved: false, kind: "invalid", reason: "This is not a valid governed URL." };
  }
}

export function collectReleaseMediaIds(version = {}) {
  const ids = new Set();
  const add = (value) => {
    const id = cleanPositiveId(value);
    if (id) ids.add(id);
  };
  add(version?.primary_media_asset_id);
  for (const raw of version?.sections || []) {
    const section = normalizeReleaseSection(raw);
    add(section.primary_media_asset_id);
    add(section.background_media_asset_id);
    walkStructured(section.content, (key, value) => {
      if (MEDIA_ID_KEY.test(key)) add(value);
    });
  }
  return [...ids];
}

function issue(severity, code, title, detail, sectionKey = "") {
  return { severity, code, title, detail, sectionKey };
}

function duplicateSectionKeys(version = {}) {
  const seen = new Set();
  const duplicates = new Set();
  (version?.sections || []).map(normalizeReleaseSection).forEach((section) => {
    if (seen.has(section.section_key)) duplicates.add(section.section_key);
    seen.add(section.section_key);
  });
  return [...duplicates];
}

function mediaAuditIssues(version, mediaAudit = {}) {
  const issues = [];
  const ids = collectReleaseMediaIds(version);
  const assets = Array.isArray(mediaAudit?.items) ? mediaAudit.items : [];
  const complete = mediaAudit?.complete === true;
  const available = mediaAudit?.available === true;
  if (!ids.length) return issues;
  if (!available) {
    issues.push(issue("warning", "media-unverified", "Media metadata not independently verified", `${ids.length} referenced media asset${ids.length === 1 ? "" : "s"} could not be checked with this Studio role.`));
    return issues;
  }
  const byId = new Map(assets.map((asset) => [Number(asset.id), asset]));
  for (const id of ids) {
    const asset = byId.get(id);
    if (!asset) {
      issues.push(issue(complete ? "blocker" : "warning", "media-missing", `Media asset #${id} was not found`, complete ? "The complete Media Library was checked and this reference cannot be resolved." : "The loaded Media Library result is incomplete, so this reference requires manual verification."));
      continue;
    }
    if (String(asset.visibility || "private") !== "public") {
      issues.push(issue("blocker", "media-private", `Media asset #${id} is not public`, "Referenced media must be public before the page can be safely released."));
    }
    if (String(asset.processing_status || "ready") !== "ready") {
      issues.push(issue("blocker", "media-processing", `Media asset #${id} is not ready`, `Processing status is ${asset.processing_status || "unknown"}.`));
    }
    if (String(asset.media_type || "").toLowerCase() === "image" && !cleanString(asset.alt_text)) {
      issues.push(issue("blocker", "media-alt", `Image #${id} is missing alt text`, "Add meaningful alt text in Media Library before public release."));
    }
  }
  return issues;
}

export function evaluatePageReleaseReadiness({ page = {}, candidate = null, published = null, mediaAudit = {} } = {}) {
  const issues = [];
  if (!candidate) {
    return {
      state: "unavailable",
      issues: [issue("blocker", "candidate-missing", "No release candidate version", "Create or select a draft/review/approved version before running release readiness.")],
      blockers: 1,
      warnings: 0,
      info: 0,
    };
  }

  const title = cleanString(candidate.title);
  const slug = cleanString(page.slug);
  if (!title) issues.push(issue("blocker", "title-missing", "Page title is missing", "Every public page requires a clear title."));
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) issues.push(issue("blocker", "slug-invalid", "Public URL slug is invalid", "Use lowercase letters, numbers and single hyphens only."));

  const enabledSections = (candidate.sections || []).map(normalizeReleaseSection).filter((section) => section.is_enabled);
  if (!enabledSections.length) issues.push(issue("warning", "sections-empty", "No enabled governed sections", "The page can still render its page heading, but it contains no enabled Visual Builder sections."));

  for (const key of duplicateSectionKeys(candidate)) {
    issues.push(issue("blocker", "section-key-duplicate", `Duplicate section key: ${key}`, "Section keys must remain unique so revisions and publication comparisons are deterministic.", key));
  }

  for (const section of enabledSections) {
    const content = section.content || {};
    if (page.is_homepage === true && section.section_type === "hero") {
      issues.push(issue("warning", "homepage-hero", "Homepage contains a governed Hero block", "The public homepage ignores governed Hero blocks because its cinematic opening is permanent.", section.section_key));
    }
    if (["faq", "statistics", "testimonials"].includes(section.section_type) && (!Array.isArray(content.items) || content.items.length === 0)) {
      issues.push(issue("warning", `${section.section_type}-empty`, `${section.section_type} section has no items`, "Add approved structured items or hide/remove this section before release.", section.section_key));
    }
    if (section.section_type === "form" && !cleanString(content.form_key)) {
      issues.push(issue("blocker", "form-key-missing", "Form section has no form key", "Connect the section to a governed published form before release.", section.section_key));
    }
    if (["image", "video"].includes(section.section_type) && !section.primary_media_asset_id && !section.background_media_asset_id) {
      issues.push(issue("warning", "media-section-empty", `${section.section_type} section has no registered media`, "Choose approved media or hide/remove this visual section.", section.section_key));
    }
  }

  for (const link of collectReleaseLinks(candidate)) {
    const result = inspectPublicLink(link.value, { canonical: link.canonical === true });
    if (!result.safe) {
      issues.push(issue("blocker", "link-unsafe", `Unsafe or invalid link: ${link.value}`, result.reason || "Use a governed internal path or HTTPS URL.", link.sectionKey));
    } else if (!result.resolved) {
      issues.push(issue("warning", "link-unresolved", `Internal link needs verification: ${link.value}`, result.reason || "Confirm this route exists before publication.", link.sectionKey));
    }
  }

  if (!cleanString(candidate.seo_title)) issues.push(issue("warning", "seo-title", "SEO title is empty", "The public renderer can fall back to the page title, but a deliberate SEO title is recommended."));
  const meta = cleanString(candidate.meta_description);
  if (!meta) issues.push(issue("warning", "meta-description", "Meta description is empty", "Add a concise public search/social description."));
  else if (meta.length < 70 || meta.length > 170) issues.push(issue("warning", "meta-description-length", "Meta description length needs review", `Current length is ${meta.length} characters; review it for a concise search/social summary.`));
  if (!cleanString(candidate.change_summary)) issues.push(issue("warning", "change-summary", "Change summary is empty", "Explain the intent of this version so Reviewer and Publisher have useful release context."));
  if (page.show_in_search !== false && /noindex/i.test(cleanString(candidate.robots_directive))) {
    issues.push(issue("warning", "robots-search-mismatch", "Search visibility conflicts with robots directive", "The page is marked for site search while robots requests noindex."));
  }
  if (!published) issues.push(issue("info", "first-publication", "No published baseline exists", "This appears to be a first publication, so section comparison is against an empty public baseline."));

  issues.push(...mediaAuditIssues(candidate, mediaAudit));

  const blockers = issues.filter((item) => item.severity === "blocker").length;
  const warnings = issues.filter((item) => item.severity === "warning").length;
  const info = issues.filter((item) => item.severity === "info").length;
  return {
    state: blockers > 0 ? "blocked" : warnings > 0 ? "ready_with_warnings" : "ready",
    issues,
    blockers,
    warnings,
    info,
  };
}
