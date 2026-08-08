const clone = (value) => JSON.parse(JSON.stringify(value));

export const VISUAL_PREVIEW_DEVICES = Object.freeze([
  Object.freeze({ key: "desktop", label: "Desktop", width: 1360 }),
  Object.freeze({ key: "tablet", label: "Tablet", width: 820 }),
  Object.freeze({ key: "mobile", label: "Mobile", width: 390 }),
]);

export const VISUAL_SECTION_LIBRARY = Object.freeze([
  Object.freeze({
    type: "hero",
    label: "Hero stage",
    badge: "HR",
    category: "Story",
    description: "Large opening statement with optional primary and secondary actions.",
    content: Object.freeze({
      eyebrow: "",
      text: "",
      primary_label: "",
      primary_url: "",
      secondary_label: "",
      secondary_url: "",
    }),
    settings: Object.freeze({ theme: "dark", layout: "full" }),
  }),
  Object.freeze({
    type: "text",
    label: "Text story",
    badge: "TX",
    category: "Story",
    description: "A clean editorial block for company information and narrative content.",
    content: Object.freeze({ text: "" }),
    settings: Object.freeze({ theme: "light", layout: "contained" }),
  }),
  Object.freeze({
    type: "split",
    label: "Split story",
    badge: "SP",
    category: "Story",
    description: "Copy and media side by side for a stronger editorial rhythm.",
    content: Object.freeze({ eyebrow: "", text: "", link_label: "", link_url: "" }),
    settings: Object.freeze({ theme: "light", layout: "split", media_position: "right" }),
  }),
  Object.freeze({
    type: "image",
    label: "Image feature",
    badge: "IM",
    category: "Media",
    description: "A governed image-led section with caption text.",
    content: Object.freeze({ text: "", caption: "" }),
    settings: Object.freeze({ theme: "light", layout: "wide" }),
  }),
  Object.freeze({
    type: "video",
    label: "Video feature",
    badge: "VD",
    category: "Media",
    description: "A registered video or visual media section with supporting context.",
    content: Object.freeze({ text: "", caption: "" }),
    settings: Object.freeze({ theme: "dark", layout: "wide" }),
  }),
  Object.freeze({
    type: "gallery",
    label: "Gallery",
    badge: "GL",
    category: "Media",
    description: "A visual gallery section prepared for governed media references.",
    content: Object.freeze({ text: "", items: [] }),
    settings: Object.freeze({ theme: "light", layout: "grid" }),
  }),
  Object.freeze({
    type: "statistics",
    label: "Statistics",
    badge: "ST",
    category: "Proof",
    description: "Numbers, facts and measurable proof displayed as a visual metric band.",
    content: Object.freeze({ text: "", items: [] }),
    settings: Object.freeze({ theme: "dark", layout: "metrics" }),
  }),
  Object.freeze({
    type: "testimonials",
    label: "Testimonials",
    badge: "TS",
    category: "Proof",
    description: "Approved customer or partner voices in a controlled quote section.",
    content: Object.freeze({ text: "", items: [] }),
    settings: Object.freeze({ theme: "light", layout: "cards" }),
  }),
  Object.freeze({
    type: "divisions",
    label: "Business divisions",
    badge: "BD",
    category: "Collections",
    description: "A section reserved for published CHALIN business-division content.",
    content: Object.freeze({ text: "" }),
    settings: Object.freeze({ theme: "light", layout: "cards" }),
  }),
  Object.freeze({
    type: "leadership",
    label: "Leadership",
    badge: "LD",
    category: "Collections",
    description: "A section reserved for approved public leadership profiles.",
    content: Object.freeze({ text: "" }),
    settings: Object.freeze({ theme: "light", layout: "cards" }),
  }),
  Object.freeze({
    type: "projects",
    label: "Projects",
    badge: "PJ",
    category: "Collections",
    description: "A section reserved for approved public project records.",
    content: Object.freeze({ text: "" }),
    settings: Object.freeze({ theme: "light", layout: "cards" }),
  }),
  Object.freeze({
    type: "equipment",
    label: "Equipment",
    badge: "EQ",
    category: "Collections",
    description: "A section reserved for approved public equipment records.",
    content: Object.freeze({ text: "" }),
    settings: Object.freeze({ theme: "dark", layout: "rail" }),
  }),
  Object.freeze({
    type: "news",
    label: "Newsroom",
    badge: "NW",
    category: "Collections",
    description: "A section reserved for governed published newsroom content.",
    content: Object.freeze({ text: "" }),
    settings: Object.freeze({ theme: "light", layout: "cards" }),
  }),
  Object.freeze({
    type: "faq",
    label: "FAQ",
    badge: "FQ",
    category: "Engagement",
    description: "Question-and-answer content for public information and support.",
    content: Object.freeze({ text: "", items: [] }),
    settings: Object.freeze({ theme: "light", layout: "accordion" }),
  }),
  Object.freeze({
    type: "contact",
    label: "Contact block",
    badge: "CT",
    category: "Engagement",
    description: "A clear contact or enquiry hand-off inside a page.",
    content: Object.freeze({ text: "", action_label: "Contact us", action_url: "/contact" }),
    settings: Object.freeze({ theme: "light", layout: "split" }),
  }),
  Object.freeze({
    type: "form",
    label: "Form section",
    badge: "FM",
    category: "Engagement",
    description: "A governed form placement prepared for a published form reference.",
    content: Object.freeze({ text: "", form_key: "" }),
    settings: Object.freeze({ theme: "light", layout: "contained" }),
  }),
  Object.freeze({
    type: "cta",
    label: "Call to action",
    badge: "CA",
    category: "Engagement",
    description: "A strong closing action with one or two controlled destinations.",
    content: Object.freeze({
      text: "",
      primary_label: "",
      primary_url: "",
      secondary_label: "",
      secondary_url: "",
    }),
    settings: Object.freeze({ theme: "dark", layout: "band" }),
  }),
  Object.freeze({
    type: "custom",
    label: "Custom content",
    badge: "CU",
    category: "Advanced",
    description: "A governed custom block that still uses safe structured content rather than raw HTML.",
    content: Object.freeze({ text: "" }),
    settings: Object.freeze({ theme: "light", layout: "contained" }),
  }),
]);

export const VISUAL_SECTION_TYPES = Object.freeze(
  VISUAL_SECTION_LIBRARY.map((section) => section.type)
);

export const VISUAL_SECTION_CATEGORIES = Object.freeze(
  [...new Set(VISUAL_SECTION_LIBRARY.map((section) => section.category))]
);

export function getVisualSectionDefinition(type) {
  return (
    VISUAL_SECTION_LIBRARY.find((section) => section.type === type) ||
    VISUAL_SECTION_LIBRARY.find((section) => section.type === "custom")
  );
}

export function normalizeVisualContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value === undefined || value === null || value === ""
      ? {}
      : { text: String(value) };
  }
  return clone(value);
}

export function normalizeVisualSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return clone(value);
}

function safePositiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : "";
}

function uniqueSectionKey(type, existingSections = []) {
  const used = new Set(existingSections.map((section) => String(section.section_key || "")));
  let suffix = Math.max(
    1,
    existingSections.filter((section) => section.section_type === type).length + 1
  );
  let key = `${type}_${suffix}`;
  while (used.has(key)) {
    suffix += 1;
    key = `${type}_${suffix}`;
  }
  return key;
}

export function createVisualSection(type, existingSections = []) {
  const definition = getVisualSectionDefinition(type);
  return {
    section_key: uniqueSectionKey(definition.type, existingSections),
    section_type: definition.type,
    heading: "",
    subheading: "",
    content_json: clone(definition.content),
    settings_json: clone(definition.settings),
    primary_media_asset_id: "",
    background_media_asset_id: "",
    primary_media_preview_url: "",
    background_media_preview_url: "",
    sort_order: existingSections.length,
    is_enabled: true,
  };
}

export function visualSectionFromRecord(section, index = 0) {
  const content = normalizeVisualContent(section?.content_json ?? section?.content ?? {});
  const settings = normalizeVisualSettings(section?.settings_json ?? section?.settings ?? {});
  return {
    section_key: section?.section_key || section?.key || `section_${index + 1}`,
    section_type: section?.section_type || section?.type || "text",
    heading: section?.heading || "",
    subheading: section?.subheading || "",
    content_json: content,
    settings_json: settings,
    primary_media_asset_id: safePositiveId(
      section?.primary_media_asset_id || section?.primary_media?.id
    ),
    background_media_asset_id: safePositiveId(
      section?.background_media_asset_id || section?.background_media?.id
    ),
    primary_media_preview_url:
      section?.primary_media?.public_url || section?.primary_media?.url || "",
    background_media_preview_url:
      section?.background_media?.public_url || section?.background_media?.url || "",
    sort_order: Number.isInteger(Number(section?.sort_order))
      ? Number(section.sort_order)
      : index,
    is_enabled: section?.is_enabled !== false,
  };
}

export function visualSectionForSave(section, index = 0) {
  return {
    section_key: section.section_key,
    section_type: section.section_type,
    heading: section.heading,
    subheading: section.subheading,
    content: normalizeVisualContent(section.content_json),
    settings: normalizeVisualSettings(section.settings_json),
    primary_media_asset_id: safePositiveId(section.primary_media_asset_id) || null,
    background_media_asset_id: safePositiveId(section.background_media_asset_id) || null,
    sort_order: index,
    is_enabled: section.is_enabled !== false,
  };
}

export function visualSectionSummary(section) {
  const definition = getVisualSectionDefinition(section?.section_type);
  const content = normalizeVisualContent(section?.content_json);
  return (
    section?.heading ||
    section?.subheading ||
    content.text ||
    definition.description
  );
}

export function reorderVisualSections(sections = [], fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= sections.length ||
    toIndex >= sections.length
  ) {
    return sections;
  }
  const next = [...sections];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((section, index) => ({ ...section, sort_order: index }));
}

export function duplicateVisualSection(sections = [], index) {
  const source = sections[index];
  if (!source) return sections;
  const duplicate = clone(source);
  duplicate.section_key = uniqueSectionKey(source.section_type || "custom", sections);
  duplicate.sort_order = index + 1;
  const next = [...sections];
  next.splice(index + 1, 0, duplicate);
  return next.map((section, sectionIndex) => ({ ...section, sort_order: sectionIndex }));
}

export function safeVisualActionUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}
