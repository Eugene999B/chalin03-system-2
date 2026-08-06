import { useMemo, useState } from "react";
import ContentStudioGovernedManager, {
  GovernedField,
  cleanId,
} from "./ContentStudioGovernedManager";
import {
  archiveCompanyInfoEntity,
  createCompanyInfoEntity,
  createCompanyInfoVersion,
  decideCompanyInfoApproval,
  getCompanyInfoEntity,
  listCompanyInfoEntities,
  publishCompanyInfoVersion,
  restoreCompanyInfoVersion,
  submitCompanyInfoVersion,
  updateCompanyInfoDraft,
} from "./contentStudioCompanyInfoApi";

const TABS = Object.freeze([
  ["division", "Divisions"],
  ["location", "Locations"],
  ["statistic", "Statistics"],
  ["testimonial", "Testimonials"],
  ["faq", "FAQs"],
  ["vacancy", "Vacancies"],
  ["tender", "Tenders"],
]);

function structuredText(value) {
  const original = value && typeof value === "object" ? value : {};
  if (typeof original.text === "string") {
    return { text: original.text, original, advanced: false };
  }
  return { text: "", original, advanced: Object.keys(original).length > 0 };
}

function structuredForSave(text, original, advanced) {
  if (advanced && text === "") return original || {};
  if (typeof original?.text === "string" && text === original.text) return original;
  return { text };
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return Number.isInteger(number) ? number : null;
}

function dateTimeForInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function dateTimeForSave(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const COMMON_SORT = Object.freeze({
  key: "sort_order",
  label: "Display order",
  type: "integer",
  defaultValue: 0,
});

const COMPANY_CONFIGS = Object.freeze({
  division: Object.freeze({
    noun: "Business division",
    plural: "business divisions",
    badge: "DV",
    description: "Manage public business divisions, contact details, approved media and structured company descriptions.",
    searchPlaceholder: "Search division name or description",
    keyField: "division_key",
    titleField: "name",
    secondary: (item) => `/${item.slug || ""}`,
    fields: [
      { key: "division_key", label: "Internal division key", required: true, identity: true },
      { key: "slug", label: "Public URL slug", required: true },
      { key: "name", label: "Division name", required: true },
      { key: "short_description", label: "Short description", type: "textarea" },
      { key: "body", label: "Division story", type: "structured", hint: "Advanced structured content is preserved while blank." },
      { key: "featured_media_asset_id", label: "Featured media asset ID", type: "id", hint: "Publication requires active public-ready media." },
      { key: "contact_phone", label: "Contact phone", type: "tel" },
      { key: "contact_email", label: "Contact email", type: "email" },
      COMMON_SORT,
    ],
  }),
  location: Object.freeze({
    noun: "Location",
    plural: "locations",
    badge: "LC",
    description: "Manage public offices, branches and sites with validated coordinates, contacts, maps and business hours.",
    searchPlaceholder: "Search location, city or region",
    keyField: "location_key",
    titleField: "name",
    secondary: (item) => [item.city, item.region, item.country].filter(Boolean).join(" · "),
    fields: [
      { key: "location_key", label: "Internal location key", required: true, identity: true },
      { key: "slug", label: "Public URL slug", required: true },
      { key: "division_id", label: "Public division ID", type: "id" },
      { key: "name", label: "Location name", required: true },
      { key: "location_type", label: "Location type", defaultValue: "office", placeholder: "office, branch, site…" },
      { key: "address_line", label: "Address", type: "textarea" },
      { key: "city", label: "City" },
      { key: "region", label: "Region" },
      { key: "country", label: "Country", defaultValue: "Ghana" },
      { key: "latitude", label: "Latitude", type: "number", min: -90, max: 90, step: "any" },
      { key: "longitude", label: "Longitude", type: "number", min: -180, max: 180, step: "any" },
      { key: "phone", label: "Phone", type: "tel" },
      { key: "email", label: "Email", type: "email" },
      { key: "business_hours", label: "Business hours", type: "structured", hint: "Enter a simple explanation, or leave blank to preserve advanced schedule data." },
      { key: "map_url", label: "Map URL", type: "url", hint: "Relative path or HTTPS URL without credentials." },
      { key: "featured_media_asset_id", label: "Featured media asset ID", type: "id" },
      COMMON_SORT,
    ],
  }),
  statistic: Object.freeze({
    noun: "Company statistic",
    plural: "company statistics",
    badge: "ST",
    description: "Publish clear company facts with display values, optional numeric values, source notes and as-of dates.",
    searchPlaceholder: "Search statistic label or value",
    keyField: "statistic_key",
    titleField: "label",
    secondary: (item) => item.display_value || "No display value",
    fields: [
      { key: "statistic_key", label: "Internal statistic key", required: true, identity: true },
      { key: "label", label: "Statistic label", required: true },
      { key: "display_value", label: "Public display value", required: true, placeholder: "10+ years" },
      { key: "numeric_value", label: "Numeric value", type: "number", step: "any" },
      { key: "prefix_text", label: "Prefix" },
      { key: "suffix_text", label: "Suffix" },
      { key: "source_note", label: "Source note", type: "textarea" },
      { key: "as_of_date", label: "As-of date", type: "date" },
      COMMON_SORT,
    ],
  }),
  testimonial: Object.freeze({
    noun: "Testimonial",
    plural: "testimonials",
    badge: "TM",
    description: "Manage approved public customer testimonials with attribution, optional ratings and portraits.",
    searchPlaceholder: "Search customer, company or quote",
    keyField: "testimonial_key",
    titleField: "customer_display_name",
    secondary: (item) => item.company_name || item.customer_title || "Customer testimonial",
    fields: [
      { key: "testimonial_key", label: "Internal testimonial key", required: true, identity: true },
      { key: "customer_display_name", label: "Customer display name", required: true },
      { key: "customer_title", label: "Customer title" },
      { key: "company_name", label: "Company name" },
      { key: "quote_text", label: "Testimonial quote", type: "textarea", required: true },
      { key: "rating", label: "Rating", type: "integer", min: 1, max: 5 },
      { key: "portrait_media_asset_id", label: "Portrait media asset ID", type: "id" },
      COMMON_SORT,
    ],
  }),
  faq: Object.freeze({
    noun: "FAQ",
    plural: "FAQs",
    badge: "FQ",
    description: "Manage frequently asked questions with categories and safely preserved structured answers.",
    searchPlaceholder: "Search question or category",
    keyField: "faq_key",
    titleField: "question",
    secondary: (item) => item.category_label || "General",
    fields: [
      { key: "faq_key", label: "Internal FAQ key", required: true, identity: true },
      { key: "category_label", label: "Category" },
      { key: "question", label: "Question", type: "textarea", required: true },
      { key: "answer", label: "Answer", type: "structured", required: true, hint: "Enter a simple answer, or leave unchanged to preserve advanced structured content." },
      COMMON_SORT,
    ],
  }),
  vacancy: Object.freeze({
    noun: "Vacancy",
    plural: "vacancies",
    badge: "JB",
    description: "Publish controlled job vacancies with division/location links, application windows and structured requirements.",
    searchPlaceholder: "Search job title, employment type or summary",
    keyField: "vacancy_key",
    titleField: "title",
    secondary: (item) => item.employment_type || item.closes_at || `/${item.slug || ""}`,
    fields: [
      { key: "vacancy_key", label: "Internal vacancy key", required: true, identity: true },
      { key: "slug", label: "Public URL slug", required: true },
      { key: "division_id", label: "Public division ID", type: "id" },
      { key: "location_id", label: "Public location ID", type: "id" },
      { key: "title", label: "Job title", required: true },
      { key: "employment_type", label: "Employment type", placeholder: "Full-time, contract…" },
      { key: "summary", label: "Job summary", type: "textarea" },
      { key: "description", label: "Job description", type: "structured" },
      { key: "requirements", label: "Requirements", type: "structured" },
      { key: "application_instructions", label: "Application instructions", type: "structured" },
      { key: "application_url", label: "Application URL", type: "url" },
      { key: "vacancies_count", label: "Number of positions", type: "integer", defaultValue: 1, min: 1, max: 10000 },
      { key: "opens_at", label: "Applications open", type: "datetime" },
      { key: "closes_at", label: "Applications close", type: "datetime" },
      { key: "featured_media_asset_id", label: "Featured media asset ID", type: "id" },
      COMMON_SORT,
    ],
  }),
  tender: Object.freeze({
    noun: "Tender",
    plural: "tenders",
    badge: "TN",
    description: "Publish tender notices with references, controlled windows, structured instructions and approved documents.",
    searchPlaceholder: "Search tender title, reference or summary",
    keyField: "tender_key",
    titleField: "title",
    secondary: (item) => item.reference_number || item.closes_at || `/${item.slug || ""}`,
    fields: [
      { key: "tender_key", label: "Internal tender key", required: true, identity: true },
      { key: "slug", label: "Public URL slug", required: true },
      { key: "division_id", label: "Public division ID", type: "id" },
      { key: "reference_number", label: "Reference number" },
      { key: "title", label: "Tender title", required: true },
      { key: "summary", label: "Tender summary", type: "textarea" },
      { key: "details", label: "Tender details", type: "structured" },
      { key: "submission_instructions", label: "Submission instructions", type: "structured" },
      { key: "opens_at", label: "Tender opens", type: "datetime" },
      { key: "closes_at", label: "Tender closes", type: "datetime" },
      { key: "document_media_asset_id", label: "Tender document media asset ID", type: "id", hint: "Publication requires an active public-ready document." },
      COMMON_SORT,
    ],
  }),
});

function emptyForm(config) {
  const form = { change_summary: "" };
  for (const field of config.fields) {
    form[field.key] = field.defaultValue ?? (field.type === "structured" ? "" : "");
    if (field.type === "structured") {
      form[`__original_${field.key}`] = {};
      form[`__advanced_${field.key}`] = false;
    }
  }
  return form;
}

function formFromDetails(config, details, version = null) {
  const selectedVersion = version || details?.versions?.[0] || null;
  const snapshot = selectedVersion?.snapshot || details?.current_snapshot || {};
  const form = { change_summary: selectedVersion?.change_summary || "" };

  for (const field of config.fields) {
    if (field.type === "structured") {
      const structure = structuredText(
        snapshot[field.key] ?? snapshot[`${field.key}_json`]
      );
      form[field.key] = structure.text;
      form[`__original_${field.key}`] = structure.original;
      form[`__advanced_${field.key}`] = structure.advanced;
    } else if (field.type === "datetime") {
      form[field.key] = dateTimeForInput(snapshot[field.key]);
    } else if (field.type === "checkbox") {
      form[field.key] = snapshot[field.key] === true;
    } else {
      form[field.key] = snapshot[field.key] ?? field.defaultValue ?? "";
    }
  }
  return form;
}

function payloadFromForm(config, form) {
  const payload = { change_summary: form.change_summary };
  for (const field of config.fields) {
    const value = form[field.key];
    if (field.type === "structured") {
      payload[field.key] = structuredForSave(
        value,
        form[`__original_${field.key}`],
        form[`__advanced_${field.key}`]
      );
    } else if (field.type === "id") {
      payload[field.key] = cleanId(value);
    } else if (field.type === "number") {
      payload[field.key] = numberOrNull(value);
    } else if (field.type === "integer") {
      payload[field.key] = integerOrNull(value);
    } else if (field.type === "datetime") {
      payload[field.key] = dateTimeForSave(value);
    } else {
      payload[field.key] = value;
    }
  }
  return payload;
}

function renderField(field, form, updateField, editable, mode) {
  const disabled = !editable || (field.identity && mode !== "create");
  const common = {
    value: form[field.key] ?? "",
    onChange: (event) => updateField(field.key, event.target.value),
    disabled,
    required: Boolean(field.required),
    placeholder: field.placeholder,
  };

  let input;
  if (field.type === "textarea" || field.type === "structured") {
    input = <textarea rows={field.type === "structured" ? 6 : 4} {...common} />;
  } else if (field.type === "date") {
    input = <input type="date" {...common} />;
  } else if (field.type === "datetime") {
    input = <input type="datetime-local" {...common} />;
  } else if (field.type === "email") {
    input = <input type="email" {...common} />;
  } else if (field.type === "tel") {
    input = <input type="tel" {...common} />;
  } else if (field.type === "url") {
    input = <input type="text" {...common} />;
  } else if (["number", "integer", "id"].includes(field.type)) {
    input = (
      <input
        type="number"
        inputMode="numeric"
        min={field.type === "id" ? 1 : field.min}
        max={field.max}
        step={field.type === "integer" || field.type === "id" ? 1 : field.step || "any"}
        {...common}
      />
    );
  } else {
    input = <input type="text" {...common} />;
  }

  const structuredHint =
    field.type === "structured" && form[`__advanced_${field.key}`]
      ? "Advanced structured content is preserved while this field stays blank. Entering text deliberately replaces it with simple content."
      : field.hint;

  return (
    <GovernedField key={field.key} label={field.label} hint={structuredHint}>
      {input}
    </GovernedField>
  );
}

function renderFields(config, context) {
  const { form, updateField, editable, mode } = context;
  return (
    <div className="cs-form-grid cs-company-fields">
      {config.fields.map((field) =>
        renderField(field, form, updateField, editable, mode)
      )}
    </div>
  );
}

function apiFor(kind) {
  return Object.freeze({
    list: (params, options) => listCompanyInfoEntities(kind, params, options),
    get: (id, options) => getCompanyInfoEntity(kind, id, options),
    create: (payload) => createCompanyInfoEntity(kind, payload),
    createVersion: (id, payload) => createCompanyInfoVersion(kind, id, payload),
    update: (id, versionId, payload) =>
      updateCompanyInfoDraft(kind, id, versionId, payload),
    submit: (id, versionId, payload) =>
      submitCompanyInfoVersion(kind, id, versionId, payload),
    decide: (approvalId, payload) =>
      decideCompanyInfoApproval(kind, approvalId, payload),
    publish: (id, versionId, payload) =>
      publishCompanyInfoVersion(kind, id, versionId, payload),
    restore: (id, versionId, payload) =>
      restoreCompanyInfoVersion(kind, id, versionId, payload),
    archive: (id, payload) => archiveCompanyInfoEntity(kind, id, payload),
  });
}

const API_BY_KIND = Object.freeze(
  Object.fromEntries(TABS.map(([kind]) => [kind, apiFor(kind)]))
);

function managerConfig(kind) {
  const source = COMPANY_CONFIGS[kind];
  return Object.freeze({
    noun: source.noun,
    plural: source.plural,
    title: source.plural.replace(/^./, (character) => character.toUpperCase()),
    badge: source.badge,
    description: source.description,
    libraryLabel: "Company information",
    searchPlaceholder: source.searchPlaceholder,
    archivePrompt: `Archive this ${source.noun.toLowerCase()}? It will no longer be public.`,
    emptyForm: emptyForm(source),
    formFromDetails: (details, version) => formFromDetails(source, details, version),
    payloadFromForm: (form) => payloadFromForm(source, form),
    formTitle: (form) => form[source.titleField] || `Untitled ${source.noun.toLowerCase()}`,
    listPrimary: (item) => item[source.titleField] || item.slug || `${source.noun} #${item.id}`,
    listSecondary: source.secondary,
    renderFields: (context) => renderFields(source, context),
  });
}

const MANAGER_CONFIGS = Object.freeze(
  Object.fromEntries(TABS.map(([kind]) => [kind, managerConfig(kind)]))
);

export default function ContentStudioCompanyInfoManager() {
  const [activeKind, setActiveKind] = useState("division");
  const config = useMemo(() => MANAGER_CONFIGS[activeKind], [activeKind]);
  const api = API_BY_KIND[activeKind];

  return (
    <div className="cs-company-info-manager">
      <div className="cs-manager-tabs" role="tablist" aria-label="Company information managers">
        {TABS.map(([kind, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeKind === kind}
            className={activeKind === kind ? "is-active" : ""}
            key={kind}
            onClick={() => setActiveKind(kind)}
          >
            {label}
          </button>
        ))}
      </div>
      <ContentStudioGovernedManager
        key={activeKind}
        config={config}
        api={api}
      />
    </div>
  );
}

export { COMPANY_CONFIGS, TABS };
