import {
  createVisualSection,
  getVisualSectionDefinition,
} from "./contentStudioVisualBuilderModel";

const clone = (value) => JSON.parse(JSON.stringify(value));

function blueprint(type, heading, subheading = "", content = {}, settings = {}) {
  return Object.freeze({
    type,
    heading,
    subheading,
    content: Object.freeze({ ...content }),
    settings: Object.freeze({ ...settings }),
  });
}

export const VISUAL_PAGE_TEMPLATES = Object.freeze([
  Object.freeze({
    key: "homepage-orchestration",
    label: "Homepage orchestration",
    badge: "HP",
    category: "Homepage",
    homepageOnly: true,
    description:
      "A governed sequence for the content below the permanent CHALIN ONE homepage opening experience.",
    note:
      "The public homepage already owns its cinematic opening, visitor-intent system and core operating showcases. This template adds editorial proof and engagement without duplicating that shell.",
    sections: Object.freeze([
      blueprint(
        "split",
        "Company overview",
        "Add approved company context and one strong visual.",
        { eyebrow: "Company", text: "", link_label: "Explore the company", link_url: "/about" },
        { theme: "light", layout: "split", media_position: "right" }
      ),
      blueprint(
        "statistics",
        "Published facts",
        "Use only verified figures approved for public release.",
        { text: "", items: [] },
        { theme: "dark", layout: "metrics" }
      ),
      blueprint(
        "testimonials",
        "Customer and partner voices",
        "Add only approved quotes with a clear source.",
        { text: "", items: [] },
        { theme: "paper", layout: "cards" }
      ),
      blueprint(
        "faq",
        "Common questions",
        "Answer the questions visitors should not have to call to resolve.",
        { text: "", items: [] },
        { theme: "light", layout: "accordion" }
      ),
      blueprint(
        "contact",
        "Start a conversation",
        "Move visitors into the governed enquiry path.",
        { text: "", action_label: "Contact CHALIN ONE", action_url: "/contact" },
        { theme: "accent", layout: "split" }
      ),
    ]),
  }),
  Object.freeze({
    key: "corporate-profile",
    label: "Corporate profile",
    badge: "CP",
    category: "Company",
    homepageOnly: false,
    description:
      "A complete company-story structure with opening statement, proof, leadership and a clear next move.",
    note:
      "Best for company profile, capability, partnership and institutional information pages.",
    sections: Object.freeze([
      blueprint(
        "hero",
        "",
        "",
        { eyebrow: "CHALIN ONE", text: "", primary_label: "Start a conversation", primary_url: "/contact", secondary_label: "Explore businesses", secondary_url: "/businesses" },
        { theme: "dark", layout: "full" }
      ),
      blueprint(
        "split",
        "Company story",
        "Pair approved narrative with a strong company image.",
        { eyebrow: "Company", text: "", link_label: "", link_url: "" },
        { theme: "light", layout: "split", media_position: "right" }
      ),
      blueprint(
        "statistics",
        "Published facts",
        "Verified metrics only.",
        { text: "", items: [] },
        { theme: "dark", layout: "metrics" }
      ),
      blueprint(
        "leadership",
        "Leadership",
        "Approved public profiles are pulled from the governed leadership collection.",
        { text: "" },
        { theme: "light", layout: "cards" }
      ),
      blueprint(
        "projects",
        "Selected projects",
        "Published work is pulled from the governed project collection.",
        { text: "" },
        { theme: "paper", layout: "rail" }
      ),
      blueprint(
        "cta",
        "Continue with CHALIN ONE",
        "Give the visitor one obvious next step.",
        { text: "", primary_label: "Contact CHALIN ONE", primary_url: "/contact", secondary_label: "Explore businesses", secondary_url: "/businesses" },
        { theme: "dark", layout: "band" }
      ),
    ]),
  }),
  Object.freeze({
    key: "business-story",
    label: "Business story",
    badge: "BS",
    category: "Business",
    homepageOnly: false,
    description:
      "A service-led business page with narrative, project proof, equipment context, FAQs and enquiry hand-off.",
    note:
      "Useful for a specialist business landing page without mixing operational business contexts.",
    sections: Object.freeze([
      blueprint(
        "hero",
        "",
        "",
        { eyebrow: "Business", text: "", primary_label: "Make an enquiry", primary_url: "/contact", secondary_label: "View projects", secondary_url: "/projects" },
        { theme: "dark", layout: "full" }
      ),
      blueprint(
        "split",
        "What this business does",
        "Explain the capability clearly and attach approved business media.",
        { eyebrow: "Capabilities", text: "", link_label: "", link_url: "" },
        { theme: "light", layout: "split", media_position: "right" }
      ),
      blueprint(
        "projects",
        "Published project proof",
        "Use governed project records instead of manually copying project claims.",
        { text: "" },
        { theme: "paper", layout: "rail" }
      ),
      blueprint(
        "equipment",
        "Equipment signal",
        "Published equipment records remain controlled by the Equipment manager.",
        { text: "" },
        { theme: "dark", layout: "rail" }
      ),
      blueprint(
        "faq",
        "Business questions",
        "Resolve common service and engagement questions.",
        { text: "", items: [] },
        { theme: "light", layout: "accordion" }
      ),
      blueprint(
        "contact",
        "Open the right conversation",
        "Route the visitor to the governed enquiry desk.",
        { text: "", action_label: "Start an enquiry", action_url: "/contact" },
        { theme: "accent", layout: "split" }
      ),
    ]),
  }),
  Object.freeze({
    key: "field-showcase",
    label: "Field showcase",
    badge: "FS",
    category: "Projects",
    homepageOnly: false,
    description:
      "A visual project or capability story built around approved media, project records and measurable evidence.",
    note:
      "Good for project portfolios, capability campaigns and field-story pages.",
    sections: Object.freeze([
      blueprint(
        "hero",
        "",
        "",
        { eyebrow: "Field story", text: "", primary_label: "Explore projects", primary_url: "/projects", secondary_label: "Contact CHALIN ONE", secondary_url: "/contact" },
        { theme: "dark", layout: "full" }
      ),
      blueprint(
        "image",
        "Visual evidence",
        "Use approved media with useful public context.",
        { text: "", caption: "" },
        { theme: "light", layout: "wide" }
      ),
      blueprint(
        "projects",
        "Related projects",
        "Published project records are pulled automatically.",
        { text: "" },
        { theme: "paper", layout: "rail" }
      ),
      blueprint(
        "statistics",
        "Verified project facts",
        "Use only approved metrics that can be defended publicly.",
        { text: "", items: [] },
        { theme: "dark", layout: "metrics" }
      ),
      blueprint(
        "cta",
        "Discuss the work",
        "Continue into a governed company enquiry.",
        { text: "", primary_label: "Start a conversation", primary_url: "/contact", secondary_label: "Project archive", secondary_url: "/projects" },
        { theme: "dark", layout: "band" }
      ),
    ]),
  }),
  Object.freeze({
    key: "information-hub",
    label: "Information hub",
    badge: "IH",
    category: "Information",
    homepageOnly: false,
    description:
      "A clean structured page for policies, guidance, support information, FAQs and governed forms.",
    note:
      "Useful for tender guidance, supplier information, policies, public notices and support pages.",
    sections: Object.freeze([
      blueprint(
        "hero",
        "",
        "",
        { eyebrow: "Information", text: "", primary_label: "Contact CHALIN ONE", primary_url: "/contact", secondary_label: "", secondary_url: "" },
        { theme: "dark", layout: "full" }
      ),
      blueprint(
        "text",
        "Overview",
        "Explain the information clearly before asking the visitor to act.",
        { text: "" },
        { theme: "light", layout: "contained" }
      ),
      blueprint(
        "faq",
        "Frequently asked questions",
        "Keep approved answers in a scannable disclosure section.",
        { text: "", items: [] },
        { theme: "paper", layout: "accordion" }
      ),
      blueprint(
        "form",
        "Use the governed form",
        "Connect a published form by its form key.",
        { text: "", form_key: "" },
        { theme: "light", layout: "contained" }
      ),
      blueprint(
        "contact",
        "Need more help?",
        "Continue through the official company enquiry path.",
        { text: "", action_label: "Contact CHALIN ONE", action_url: "/contact" },
        { theme: "accent", layout: "split" }
      ),
    ]),
  }),
]);

export const VISUAL_PAGE_TEMPLATE_CATEGORIES = Object.freeze([
  ...new Set(VISUAL_PAGE_TEMPLATES.map((template) => template.category)),
]);

export function getVisualPageTemplate(key) {
  return VISUAL_PAGE_TEMPLATES.find((template) => template.key === key) || null;
}

export function visualTemplatesForContext({ homepage = false } = {}) {
  return VISUAL_PAGE_TEMPLATES.filter((template) =>
    homepage ? template.homepageOnly === true : template.homepageOnly !== true
  );
}

export function visualSectionsFromTemplate(templateKey, existingSections = []) {
  const template = getVisualPageTemplate(templateKey);
  if (!template) return [];
  const created = [];
  for (const item of template.sections) {
    const base = createVisualSection(item.type, [...existingSections, ...created]);
    created.push({
      ...base,
      heading: item.heading || "",
      subheading: item.subheading || "",
      content_json: { ...base.content_json, ...clone(item.content || {}) },
      settings_json: { ...base.settings_json, ...clone(item.settings || {}) },
      sort_order: existingSections.length + created.length,
    });
  }
  return created.map((section, index) => ({
    ...section,
    sort_order: existingSections.length + index,
  }));
}

export function visualTemplateSectionLabels(templateKey) {
  const template = getVisualPageTemplate(templateKey);
  if (!template) return [];
  return template.sections.map((section) => {
    const definition = getVisualSectionDefinition(section.type);
    return {
      type: section.type,
      badge: definition.badge,
      label: definition.label,
    };
  });
}
