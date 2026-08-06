import ContentStudioGovernedManager, {
  GovernedField,
  cleanId,
} from "./ContentStudioGovernedManager";
import {
  archivePortfolioEntity,
  createPortfolioEntity,
  createPortfolioVersion,
  decidePortfolioApproval,
  getPortfolioEntity,
  listPortfolioEntities,
  publishPortfolioVersion,
  restorePortfolioVersion,
  submitPortfolioVersion,
  updatePortfolioDraft,
} from "./contentStudioPortfolioApi";

const PROJECT_ROLES = Object.freeze([
  "hero",
  "gallery",
  "site",
  "before",
  "after",
  "video",
]);
const PROJECT_STATUSES = Object.freeze([
  "planned",
  "active",
  "paused",
  "completed",
  "cancelled",
]);
const EQUIPMENT_AVAILABILITY = Object.freeze([
  "available",
  "reserved",
  "hired",
  "sold",
  "maintenance",
  "unavailable",
  "coming_soon",
]);
const EQUIPMENT_REFERENCE_TYPES = Object.freeze([
  "",
  "fleet_asset",
  "equipment_catalogue",
  "installment_equipment",
  "external",
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

function commonApi(kind) {
  return Object.freeze({
    list: (params, options) => listPortfolioEntities(kind, params, options),
    get: (id, options) => getPortfolioEntity(kind, id, options),
    create: (payload) => createPortfolioEntity(kind, payload),
    createVersion: (id, payload) => createPortfolioVersion(kind, id, payload),
    update: (id, versionId, payload) =>
      updatePortfolioDraft(kind, id, versionId, payload),
    submit: (id, versionId, payload) =>
      submitPortfolioVersion(kind, id, versionId, payload),
    decide: (approvalId, payload) =>
      decidePortfolioApproval(kind, approvalId, payload),
    publish: (id, versionId, payload) =>
      publishPortfolioVersion(kind, id, versionId, payload),
    restore: (id, versionId, payload) =>
      restorePortfolioVersion(kind, id, versionId, payload),
    archive: (id, payload) => archivePortfolioEntity(kind, id, payload),
  });
}

const PROJECT_API = commonApi("project");
const EQUIPMENT_API = commonApi("equipment");

function projectFormFromDetails(details, version = null) {
  const selectedVersion = version || details?.versions?.[0] || null;
  const snapshot = selectedVersion?.snapshot || details?.current_snapshot || {};
  const body = structuredText(snapshot.body || snapshot.body_json);
  return {
    project_key: snapshot.project_key || "",
    slug: snapshot.slug || "",
    division_id: snapshot.division_id || "",
    title: snapshot.title || "",
    summary: snapshot.summary || "",
    body_text: body.text,
    original_body: body.original,
    has_structured_body: body.advanced,
    location_text: snapshot.location_text || "",
    operational_status: snapshot.operational_status || "planned",
    start_date: snapshot.start_date || "",
    end_date: snapshot.end_date || "",
    featured_media_asset_id: snapshot.featured_media_asset_id || "",
    gallery: Array.isArray(snapshot.gallery)
      ? snapshot.gallery.map((item, index) => ({
          media_asset_id: item.media_asset_id || "",
          media_role: item.media_role || "gallery",
          caption: item.caption || "",
          sort_order: Number.isInteger(Number(item.sort_order))
            ? Number(item.sort_order)
            : index,
        }))
      : [],
    sort_order: Number.isInteger(Number(snapshot.sort_order))
      ? Number(snapshot.sort_order)
      : 0,
    change_summary: selectedVersion?.change_summary || "",
  };
}

function projectPayload(form) {
  return {
    project_key: form.project_key,
    slug: form.slug,
    division_id: cleanId(form.division_id),
    title: form.title,
    summary: form.summary,
    body: structuredForSave(
      form.body_text,
      form.original_body,
      form.has_structured_body
    ),
    location_text: form.location_text,
    operational_status: form.operational_status,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    featured_media_asset_id: cleanId(form.featured_media_asset_id),
    gallery: form.gallery.map((item, index) => ({
      media_asset_id: cleanId(item.media_asset_id),
      media_role: item.media_role,
      caption: item.caption,
      sort_order: index,
    })),
    sort_order: Number(form.sort_order) || 0,
    change_summary: form.change_summary,
  };
}

function renderProjectFields({ form, updateField, updateForm, editable, mode }) {
  function updateGallery(index, key, value) {
    updateForm((current) => ({
      ...current,
      gallery: current.gallery.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item
      ),
    }));
  }

  function addGalleryItem() {
    updateForm((current) => ({
      ...current,
      gallery:
        current.gallery.length >= 60
          ? current.gallery
          : [
              ...current.gallery,
              {
                media_asset_id: "",
                media_role: "gallery",
                caption: "",
                sort_order: current.gallery.length,
              },
            ],
    }));
  }

  function removeGalleryItem(index) {
    updateForm((current) => ({
      ...current,
      gallery: current.gallery.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  return (
    <>
      <div className="cs-form-grid">
        <GovernedField label="Internal project key" hint="Lowercase letters, numbers and underscores.">
          <input value={form.project_key} onChange={(event) => updateField("project_key", event.target.value)} disabled={mode !== "create"} required />
        </GovernedField>
        <GovernedField label="Public URL slug">
          <input value={form.slug} onChange={(event) => updateField("slug", event.target.value)} disabled={!editable} required />
        </GovernedField>
        <GovernedField label="Project title">
          <input value={form.title} onChange={(event) => updateField("title", event.target.value)} disabled={!editable} required />
        </GovernedField>
        <GovernedField label="Public division ID" hint="Optional link to a non-archived public business division.">
          <input inputMode="numeric" value={form.division_id} onChange={(event) => updateField("division_id", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Location">
          <input value={form.location_text} onChange={(event) => updateField("location_text", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Operational status">
          <select value={form.operational_status} onChange={(event) => updateField("operational_status", event.target.value)} disabled={!editable}>
            {PROJECT_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
        </GovernedField>
        <GovernedField label="Start date">
          <input type="date" value={form.start_date} onChange={(event) => updateField("start_date", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="End date" hint="Cannot be before the start date.">
          <input type="date" value={form.end_date} onChange={(event) => updateField("end_date", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Featured media asset ID" hint="Must be active; publication requires public and ready media.">
          <input inputMode="numeric" value={form.featured_media_asset_id} onChange={(event) => updateField("featured_media_asset_id", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Display order">
          <input type="number" value={form.sort_order} onChange={(event) => updateField("sort_order", event.target.value)} disabled={!editable} />
        </GovernedField>
      </div>

      <GovernedField label="Project summary">
        <textarea rows="4" value={form.summary} onChange={(event) => updateField("summary", event.target.value)} disabled={!editable} />
      </GovernedField>
      <GovernedField
        label="Project story"
        hint={form.has_structured_body ? "Advanced structured content is preserved while this field stays blank. Entering text deliberately replaces it with a simple story." : "Plain text project story."}
      >
        <textarea rows="7" value={form.body_text} onChange={(event) => updateField("body_text", event.target.value)} disabled={!editable} />
      </GovernedField>

      <div className="cs-editor-section-heading">
        <div><span className="cs-eyebrow">Media</span><h4>Project gallery ({form.gallery.length}/60)</h4></div>
        {editable ? <button type="button" className="cs-button cs-button-secondary" onClick={addGalleryItem} disabled={form.gallery.length >= 60}>Add gallery item</button> : null}
      </div>
      <div className="cs-repeat-list">
        {form.gallery.map((item, index) => (
          <article className="cs-repeat-card" key={`${item.media_asset_id}-${index}`}>
            <div className="cs-repeat-card-heading">
              <strong>Gallery item {index + 1}</strong>
              {editable ? <button type="button" onClick={() => removeGalleryItem(index)}>Remove</button> : null}
            </div>
            <div className="cs-form-grid cs-form-grid-3">
              <GovernedField label="Media asset ID">
                <input inputMode="numeric" value={item.media_asset_id} onChange={(event) => updateGallery(index, "media_asset_id", event.target.value)} disabled={!editable} required />
              </GovernedField>
              <GovernedField label="Media role">
                <select value={item.media_role} onChange={(event) => updateGallery(index, "media_role", event.target.value)} disabled={!editable}>
                  {PROJECT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </GovernedField>
              <GovernedField label="Caption">
                <input value={item.caption} onChange={(event) => updateGallery(index, "caption", event.target.value)} disabled={!editable} />
              </GovernedField>
            </div>
          </article>
        ))}
        {form.gallery.length === 0 ? <div className="cs-empty-state"><strong>No gallery media</strong><span>Add approved media assets when the project needs a gallery.</span></div> : null}
      </div>
    </>
  );
}

const PROJECT_CONFIG = Object.freeze({
  noun: "Project",
  plural: "projects",
  title: "Projects",
  badge: "PJ",
  description: "Publish project stories, operational status, dates, public divisions and approved media galleries through exact-version governance.",
  libraryLabel: "Portfolio",
  searchPlaceholder: "Search title or location",
  archivePrompt: "Archive this project? It will no longer be public.",
  emptyForm: {
    project_key: "",
    slug: "",
    division_id: "",
    title: "",
    summary: "",
    body_text: "",
    original_body: {},
    has_structured_body: false,
    location_text: "",
    operational_status: "planned",
    start_date: "",
    end_date: "",
    featured_media_asset_id: "",
    gallery: [],
    sort_order: 0,
    change_summary: "",
  },
  formFromDetails: projectFormFromDetails,
  payloadFromForm: projectPayload,
  formTitle: (form) => form.title || "Untitled project",
  listPrimary: (item) => item.title || item.slug || `Project #${item.id}`,
  listSecondary: (item) => item.location_text || item.operational_status || `/${item.slug || ""}`,
  renderFields: renderProjectFields,
});

function specificationRows(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const entries = Object.entries(source);
  const simple = entries.every(([, entryValue]) =>
    ["string", "number", "boolean"].includes(typeof entryValue)
  );
  return {
    rows: simple
      ? entries.map(([key, entryValue]) => ({ key, value: String(entryValue) }))
      : [],
    original: source,
    advanced: !simple && entries.length > 0,
  };
}

function equipmentFormFromDetails(details, version = null) {
  const selectedVersion = version || details?.versions?.[0] || null;
  const snapshot = selectedVersion?.snapshot || details?.current_snapshot || {};
  const specifications = specificationRows(
    snapshot.specifications || snapshot.specifications_json
  );
  return {
    equipment_key: snapshot.equipment_key || "",
    slug: snapshot.slug || "",
    division_id: snapshot.division_id || "",
    internal_reference_type: snapshot.internal_reference_type || "",
    internal_reference_id: snapshot.internal_reference_id || "",
    name: snapshot.name || "",
    manufacturer: snapshot.manufacturer || "",
    model: snapshot.model || "",
    model_year: snapshot.model_year || "",
    equipment_category: snapshot.equipment_category || "",
    condition_label: snapshot.condition_label || "",
    availability_status: snapshot.availability_status || "coming_soon",
    short_description: snapshot.short_description || "",
    specification_rows: specifications.rows,
    original_specifications: specifications.original,
    has_advanced_specifications: specifications.advanced,
    features_text: Array.isArray(snapshot.features) ? snapshot.features.join("\n") : "",
    currency_code: snapshot.currency_code || "GHS",
    display_price: snapshot.display_price ?? "",
    show_price: snapshot.show_price === true,
    hire_available: snapshot.hire_available === true,
    finance_available: snapshot.finance_available === true,
    featured_media_asset_id: snapshot.featured_media_asset_id || "",
    sort_order: Number.isInteger(Number(snapshot.sort_order))
      ? Number(snapshot.sort_order)
      : 0,
    change_summary: selectedVersion?.change_summary || "",
  };
}

function specificationsForSave(form) {
  if (form.has_advanced_specifications && form.specification_rows.length === 0) {
    return form.original_specifications || {};
  }
  return Object.fromEntries(
    form.specification_rows
      .map((row) => [String(row.key || "").trim(), String(row.value || "").trim()])
      .filter(([key]) => key)
  );
}

function equipmentPayload(form) {
  return {
    equipment_key: form.equipment_key,
    slug: form.slug,
    division_id: cleanId(form.division_id),
    internal_reference_type: form.internal_reference_type || null,
    internal_reference_id:
      form.internal_reference_type === "external"
        ? null
        : cleanId(form.internal_reference_id),
    name: form.name,
    manufacturer: form.manufacturer,
    model: form.model,
    model_year: integerOrNull(form.model_year),
    equipment_category: form.equipment_category,
    condition_label: form.condition_label,
    availability_status: form.availability_status,
    short_description: form.short_description,
    specifications: specificationsForSave(form),
    features: String(form.features_text || "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    currency_code: String(form.currency_code || "GHS").toUpperCase(),
    display_price: numberOrNull(form.display_price),
    show_price: form.show_price,
    hire_available: form.hire_available,
    finance_available: form.finance_available,
    featured_media_asset_id: cleanId(form.featured_media_asset_id),
    sort_order: Number(form.sort_order) || 0,
    change_summary: form.change_summary,
  };
}

function renderEquipmentFields({ form, updateField, updateForm, editable, mode }) {
  function updateSpecification(index, key, value) {
    updateForm((current) => ({
      ...current,
      has_advanced_specifications: false,
      specification_rows: current.specification_rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      ),
    }));
  }

  function addSpecification() {
    updateForm((current) => ({
      ...current,
      has_advanced_specifications: false,
      specification_rows: [...current.specification_rows, { key: "", value: "" }],
    }));
  }

  function removeSpecification(index) {
    updateForm((current) => ({
      ...current,
      has_advanced_specifications: false,
      specification_rows: current.specification_rows.filter((_, rowIndex) => rowIndex !== index),
    }));
  }

  const needsReferenceId =
    form.internal_reference_type && form.internal_reference_type !== "external";

  return (
    <>
      <div className="cs-form-grid">
        <GovernedField label="Internal equipment key">
          <input value={form.equipment_key} onChange={(event) => updateField("equipment_key", event.target.value)} disabled={mode !== "create"} required />
        </GovernedField>
        <GovernedField label="Public URL slug">
          <input value={form.slug} onChange={(event) => updateField("slug", event.target.value)} disabled={!editable} required />
        </GovernedField>
        <GovernedField label="Equipment name">
          <input value={form.name} onChange={(event) => updateField("name", event.target.value)} disabled={!editable} required />
        </GovernedField>
        <GovernedField label="Public division ID">
          <input inputMode="numeric" value={form.division_id} onChange={(event) => updateField("division_id", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Manufacturer">
          <input value={form.manufacturer} onChange={(event) => updateField("manufacturer", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Model">
          <input value={form.model} onChange={(event) => updateField("model", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Model year" hint="1900 to 2100.">
          <input type="number" min="1900" max="2100" value={form.model_year} onChange={(event) => updateField("model_year", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Equipment category">
          <input value={form.equipment_category} onChange={(event) => updateField("equipment_category", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Condition label">
          <input value={form.condition_label} onChange={(event) => updateField("condition_label", event.target.value)} disabled={!editable} placeholder="New, used, refurbished…" />
        </GovernedField>
        <GovernedField label="Availability">
          <select value={form.availability_status} onChange={(event) => updateField("availability_status", event.target.value)} disabled={!editable}>
            {EQUIPMENT_AVAILABILITY.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
        </GovernedField>
        <GovernedField label="Internal reference type" hint="Choose external when this catalogue item is not linked to an internal equipment record.">
          <select value={form.internal_reference_type} onChange={(event) => {
            updateField("internal_reference_type", event.target.value);
            if (event.target.value === "external" || event.target.value === "") updateField("internal_reference_id", "");
          }} disabled={!editable}>
            {EQUIPMENT_REFERENCE_TYPES.map((type) => <option key={type || "none"} value={type}>{type ? type.replaceAll("_", " ") : "No internal reference"}</option>)}
          </select>
        </GovernedField>
        <GovernedField label="Internal reference record ID" hint={needsReferenceId ? "Required for the selected internal reference type." : "Not used for external or unlinked equipment."}>
          <input inputMode="numeric" value={form.internal_reference_id} onChange={(event) => updateField("internal_reference_id", event.target.value)} disabled={!editable || !needsReferenceId} required={Boolean(needsReferenceId)} />
        </GovernedField>
        <GovernedField label="Featured media asset ID" hint="Publication requires an active public-ready image.">
          <input inputMode="numeric" value={form.featured_media_asset_id} onChange={(event) => updateField("featured_media_asset_id", event.target.value)} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Display order">
          <input type="number" value={form.sort_order} onChange={(event) => updateField("sort_order", event.target.value)} disabled={!editable} />
        </GovernedField>
      </div>

      <GovernedField label="Short description">
        <textarea rows="5" value={form.short_description} onChange={(event) => updateField("short_description", event.target.value)} disabled={!editable} />
      </GovernedField>

      <div className="cs-editor-section-heading">
        <div><span className="cs-eyebrow">Catalogue data</span><h4>Specifications</h4></div>
        {editable ? <button type="button" className="cs-button cs-button-secondary" onClick={addSpecification}>Add specification</button> : null}
      </div>
      {form.has_advanced_specifications ? (
        <p className="cs-structure-note">Advanced structured specifications are preserved while no simple rows are added.</p>
      ) : null}
      <div className="cs-repeat-list">
        {form.specification_rows.map((row, index) => (
          <article className="cs-repeat-card" key={`${row.key}-${index}`}>
            <div className="cs-form-grid">
              <GovernedField label="Specification name">
                <input value={row.key} onChange={(event) => updateSpecification(index, "key", event.target.value)} disabled={!editable} />
              </GovernedField>
              <GovernedField label="Specification value">
                <input value={row.value} onChange={(event) => updateSpecification(index, "value", event.target.value)} disabled={!editable} />
              </GovernedField>
            </div>
            {editable ? <button type="button" className="cs-inline-remove" onClick={() => removeSpecification(index)}>Remove specification</button> : null}
          </article>
        ))}
      </div>

      <GovernedField label="Features" hint="Enter one public feature per line. Duplicate and blank values are removed by the backend.">
        <textarea rows="6" value={form.features_text} onChange={(event) => updateField("features_text", event.target.value)} disabled={!editable} />
      </GovernedField>

      <div className="cs-form-grid">
        <GovernedField label="Currency code" hint="Three-letter code, normally GHS.">
          <input maxLength="3" value={form.currency_code} onChange={(event) => updateField("currency_code", event.target.value.toUpperCase())} disabled={!editable} />
        </GovernedField>
        <GovernedField label="Display price" hint="Required when public price display is enabled.">
          <input type="number" min="0" step="0.01" value={form.display_price} onChange={(event) => updateField("display_price", event.target.value)} disabled={!editable} />
        </GovernedField>
      </div>
      <div className="cs-checkbox-grid">
        <label><input type="checkbox" checked={form.show_price} onChange={(event) => updateField("show_price", event.target.checked)} disabled={!editable} /> Show public price</label>
        <label><input type="checkbox" checked={form.hire_available} onChange={(event) => updateField("hire_available", event.target.checked)} disabled={!editable} /> Available for hire</label>
        <label><input type="checkbox" checked={form.finance_available} onChange={(event) => updateField("finance_available", event.target.checked)} disabled={!editable} /> Finance available</label>
      </div>
    </>
  );
}

const EQUIPMENT_CONFIG = Object.freeze({
  noun: "Equipment item",
  plural: "equipment items",
  title: "Public Equipment Catalogue",
  badge: "EQ",
  description: "Manage public equipment sales, hire and finance catalogue records while protecting internal references, pricing and media readiness.",
  libraryLabel: "Catalogue",
  searchPlaceholder: "Search name, manufacturer, model or category",
  archivePrompt: "Archive this equipment item? It will no longer be public.",
  emptyForm: {
    equipment_key: "",
    slug: "",
    division_id: "",
    internal_reference_type: "",
    internal_reference_id: "",
    name: "",
    manufacturer: "",
    model: "",
    model_year: "",
    equipment_category: "",
    condition_label: "",
    availability_status: "coming_soon",
    short_description: "",
    specification_rows: [],
    original_specifications: {},
    has_advanced_specifications: false,
    features_text: "",
    currency_code: "GHS",
    display_price: "",
    show_price: false,
    hire_available: false,
    finance_available: false,
    featured_media_asset_id: "",
    sort_order: 0,
    change_summary: "",
  },
  formFromDetails: equipmentFormFromDetails,
  payloadFromForm: equipmentPayload,
  formTitle: (form) => form.name || "Untitled equipment item",
  listPrimary: (item) => item.name || item.slug || `Equipment #${item.id}`,
  listSecondary: (item) => [item.manufacturer, item.model, item.availability_status].filter(Boolean).join(" · "),
  renderFields: renderEquipmentFields,
});

export function ContentStudioProjectManager() {
  return <ContentStudioGovernedManager config={PROJECT_CONFIG} api={PROJECT_API} />;
}

export function ContentStudioEquipmentManager() {
  return <ContentStudioGovernedManager config={EQUIPMENT_CONFIG} api={EQUIPMENT_API} />;
}
