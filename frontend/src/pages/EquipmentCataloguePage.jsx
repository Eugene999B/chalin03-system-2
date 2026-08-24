import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentCatalogue.css";
import "../styles/equipmentCatalogueImageFix.css";

const PURPOSES = [
  ["hire_only", "Hire only"],
  ["sale_only", "Sale only"],
  ["sale_or_hire", "Sale or hire"],
  ["company_operations", "Company operations"],
];
const CONDITIONS = [
  ["new", "New"],
  ["excellent", "Excellent"],
  ["good", "Good"],
  ["fair", "Fair"],
  ["poor", "Poor"],
  ["damaged", "Damaged"],
  ["under_inspection", "Under inspection"],
];
const SALE_STATUSES = [
  ["not_for_sale", "Not for sale"],
  ["available", "Available for sale"],
  ["reserved", "Reserved"],
  ["installment_active", "Installment active"],
  ["sold", "Sold"],
];
const CURRENT_STATUSES = [
  ["available", "Available"],
  ["idle", "Idle"],
  ["assigned_hire", "Assigned to hire"],
  ["mobilizing", "Mobilizing"],
  ["working", "Working"],
  ["maintenance", "Maintenance"],
  ["breakdown", "Breakdown"],
  ["retired", "Retired"],
];
const EVIDENCE_TYPES = [
  ["main", "Main picture"],
  ["front", "Front"],
  ["rear", "Rear"],
  ["left_side", "Left side"],
  ["right_side", "Right side"],
  ["cabin", "Cabin"],
  ["engine", "Engine"],
  ["serial_plate", "Serial plate"],
  ["chassis_plate", "Chassis plate"],
  ["attachment", "Attachment"],
  ["inspection", "Inspection"],
  ["damage", "Damage"],
  ["registration", "Registration"],
  ["insurance", "Insurance"],
  ["ownership", "Ownership"],
  ["other", "Other"],
];

function emptyAsset() {
  return {
    asset_code: "",
    asset_name: "",
    asset_type: "Excavator",
    equipment_category: "Heavy Equipment",
    make: "",
    model: "",
    model_year: "",
    serial_number: "",
    chassis_number: "",
    engine_number: "",
    registration_number: "",
    colour: "",
    capacity_description: "",
    condition_status: "good",
    ownership_type: "company_owned",
    operational_purpose: "sale_or_hire",
    current_status: "available",
    sale_status: "available",
    meter_type: "hour_meter",
    current_meter: "0",
    fuel_type: "diesel",
    acquisition_date: "",
    acquisition_cost: "",
    target_selling_price: "",
    standard_hire_rate: "",
    supplier_name: "",
    acquisition_reference: "",
    insurance_expiry: "",
    registration_expiry: "",
    notes: "",
  };
}

function emptyMedia() {
  return {
    evidence_type: "main",
    file_url: "",
    thumbnail_url: "",
    file_name: "",
    mime_type: "image/jpeg",
    file_size_bytes: "",
    caption: "",
    is_primary: true,
  };
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function apiError(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Field({ label: fieldLabel, children, wide = false, hint = "" }) {
  return (
    <label className={`equipment-catalogue__field ${wide ? "is-wide" : ""}`}>
      <span>{fieldLabel}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Sheet({ title, subtitle, onClose, children }) {
  return (
    <div className="equipment-catalogue__sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="equipment-catalogue__sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p>Equipment Sales &amp; Hire</p>
            <h2>{title}</h2>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="equipment-catalogue__sheet-body">{children}</div>
      </section>
    </div>
  );
}

export default function EquipmentCataloguePage() {
  const { effectivePermissions = [] } = useAuth();
  const { selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const canManage = effectivePermissions.includes("fleet.assets.manage");
  const [assets, setAssets] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    purpose: "",
    sale_status: "",
    current_status: "",
  });
  const [assetSheet, setAssetSheet] = useState(false);
  const [detailSheet, setDetailSheet] = useState(false);
  const [mediaSheet, setMediaSheet] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [assetForm, setAssetForm] = useState(emptyAsset);
  const [mediaForm, setMediaForm] = useState(emptyMedia);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const fileInputRef = useRef(null);

  const selectedLocationName =
    selectedContext?.name ||
    (automaticAccess && !selectedContextId ? "All Equipment Hire locations" : "Choose a Hire location");

  const loadCatalogue = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => String(value || "").trim())
      );
      const [summaryResponse, assetsResponse] = await Promise.all([
        axiosClient.get("/equipment-catalogue/summary"),
        axiosClient.get("/equipment-catalogue/assets", { params }),
      ]);
      setSummary(summaryResponse.data?.summary || {});
      setAssets(assetsResponse.data?.assets || []);
    } catch (requestError) {
      setError(apiError(requestError, "Could not load the equipment catalogue."));
    } finally {
      setLoading(false);
    }
  }, [filters, selectedContextId]);

  useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue]);

  useEffect(() => {
    if (!success) return undefined;
    const timer = window.setTimeout(() => setSuccess(""), 4500);
    return () => window.clearTimeout(timer);
  }, [success]);

  const metrics = useMemo(
    () => [
      ["Equipment", summary.total_assets, "🚜"],
      ["For sale", summary.available_for_sale, "🏷️"],
      ["Reserved", summary.sale_reserved_assets, "🔒"],
      ["Ready", summary.operationally_available, "✅"],
      ["With pictures", summary.assets_with_main_image, "📷"],
      ["Sale value", money(summary.available_sale_value), "💰"],
    ],
    [summary]
  );

  function openCreate() {
    if (!selectedContextId) {
      setError("Choose an Equipment Hire location before adding equipment.");
      return;
    }
    setEditingId(null);
    setAssetForm(emptyAsset());
    setAssetSheet(true);
  }

  function openEdit(asset) {
    setEditingId(asset.id);
    setAssetForm({
      ...emptyAsset(),
      ...asset,
      model_year: asset.model_year || "",
      current_meter: String(asset.current_meter ?? 0),
      acquisition_date: asset.acquisition_date ? String(asset.acquisition_date).slice(0, 10) : "",
      acquisition_cost: asset.acquisition_cost ?? "",
      target_selling_price: asset.target_selling_price ?? "",
      standard_hire_rate: asset.standard_hire_rate ?? "",
      insurance_expiry: asset.insurance_expiry ? String(asset.insurance_expiry).slice(0, 10) : "",
      registration_expiry: asset.registration_expiry
        ? String(asset.registration_expiry).slice(0, 10)
        : "",
    });
    setAssetSheet(true);
  }

  async function openDetail(asset) {
    setDetailSheet(true);
    setDetailLoading(true);
    setSelectedAsset({ asset, media: [], safeguards: {} });
    try {
      const response = await axiosClient.get(`/equipment-catalogue/assets/${asset.id}`);
      setSelectedAsset(response.data);
    } catch (requestError) {
      setError(apiError(requestError, "Could not load equipment details."));
    } finally {
      setDetailLoading(false);
    }
  }

  function updateAsset(field, value) {
    setAssetForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "operational_purpose") {
        if (["hire_only", "company_operations"].includes(value)) {
          next.sale_status = "not_for_sale";
        } else if (next.sale_status === "not_for_sale") {
          next.sale_status = "available";
        }
      }
      return next;
    });
  }

  async function saveAsset(event) {
    event.preventDefault();
    if (!canManage) {
      setError("Your account cannot manage equipment records.");
      return;
    }
    setSaving(true);
    setError("");

    try {
      const payload = {
        ...assetForm,
        model_year: assetForm.model_year || null,
        current_meter: Number(assetForm.current_meter || 0),
        acquisition_cost: Number(assetForm.acquisition_cost || 0),
        target_selling_price: Number(assetForm.target_selling_price || 0),
        standard_hire_rate: Number(assetForm.standard_hire_rate || 0),
      };
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.hire_location_id;
      delete payload.hire_location_name;
      delete payload.hire_location_code;
      delete payload.main_image_url;
      delete payload.active_sale_lock_status;
      delete payload.active_sale_agreement_id;
      delete payload.active_hire_assignment_count;
      delete payload.media_count;

      const response = editingId
        ? await axiosClient.put(`/equipment-catalogue/assets/${editingId}`, payload)
        : await axiosClient.post("/equipment-catalogue/assets", payload);
      setSuccess(response.data?.message || "Equipment record saved.");
      setAssetSheet(false);
      await loadCatalogue();
    } catch (requestError) {
      setError(apiError(requestError, "Could not save the equipment record."));
    } finally {
      setSaving(false);
    }
  }

  function startMedia(asset, type = "main") {
    if (!selectedContextId) {
      setError("Choose an Equipment Hire location before adding pictures.");
      return;
    }
    setSelectedAsset({ asset, media: [], safeguards: {} });
    setMediaForm({ ...emptyMedia(), evidence_type: type, is_primary: type === "main" });
    setMediaSheet(true);
  }

  function handlePickedFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMediaForm((current) => ({
      ...current,
      file_name: file.name,
      mime_type: file.type || "image/jpeg",
      file_size_bytes: String(file.size || ""),
      caption: current.caption || file.name,
    }));
  }

  async function saveMedia(event) {
    event.preventDefault();
    const asset = selectedAsset?.asset;
    if (!asset?.id) return;
    setSaving(true);
    setError("");

    try {
      const response = await axiosClient.post(
        `/equipment-catalogue/assets/${asset.id}/media`,
        {
          ...mediaForm,
          media_category: "photo",
          file_size_bytes: mediaForm.file_size_bytes
            ? Number(mediaForm.file_size_bytes)
            : null,
        }
      );
      setSuccess(response.data?.message || "Equipment picture saved.");
      setMediaSheet(false);
      await loadCatalogue();
      if (detailSheet) await openDetail(asset);
    } catch (requestError) {
      setError(apiError(requestError, "Could not save the equipment picture."));
    } finally {
      setSaving(false);
    }
  }

  async function makePrimary(assetId, mediaId) {
    try {
      await axiosClient.patch(
        `/equipment-catalogue/assets/${assetId}/media/${mediaId}/primary`
      );
      setSuccess("Main equipment picture updated.");
      await openDetail(selectedAsset.asset);
      await loadCatalogue();
    } catch (requestError) {
      setError(apiError(requestError, "Could not change the main picture."));
    }
  }

  async function archiveMedia(assetId, mediaId) {
    const reason = window.prompt("Why are you archiving this picture or document?");
    if (!reason?.trim()) return;
    try {
      await axiosClient.patch(
        `/equipment-catalogue/assets/${assetId}/media/${mediaId}/archive`,
        { reason: reason.trim() }
      );
      setSuccess("Equipment media archived; the audit evidence was retained.");
      await openDetail(selectedAsset.asset);
      await loadCatalogue();
    } catch (requestError) {
      setError(apiError(requestError, "Could not archive the equipment media."));
    }
  }

  return (
    <main className="equipment-catalogue">
      <section className="equipment-catalogue__hero">
        <div className="equipment-catalogue__hero-copy">
          <p>Equipment Sales &amp; Hire • {selectedLocationName}</p>
          <h1>Equipment Catalogue</h1>
          <span>
            One verified record for every excavator and machine—identity, pictures,
            condition, selling price, Hire rate and availability.
          </span>
        </div>
        <div className="equipment-catalogue__hero-actions">
          <button type="button" className="is-secondary" onClick={loadCatalogue}>
            ↻ Refresh
          </button>
          {canManage ? (
            <button type="button" className="is-primary" onClick={openCreate}>
              ＋ Add equipment
            </button>
          ) : null}
        </div>
      </section>

      {error ? <div className="equipment-catalogue__notice is-error">{error}</div> : null}
      {success ? (
        <div className="equipment-catalogue__notice is-success">{success}</div>
      ) : null}
      {!selectedContextId ? (
        <div className="equipment-catalogue__notice is-warning">
          Choose a Hire location in the top bar before creating or changing equipment.
          Administrators may still review all locations.
        </div>
      ) : null}

      <section className="equipment-catalogue__metrics">
        {metrics.map(([title, value, icon]) => (
          <article key={title}>
            <span>{icon}</span>
            <div>
              <p>{title}</p>
              <strong>{value ?? 0}</strong>
            </div>
          </article>
        ))}
      </section>

      <section className="equipment-catalogue__filters">
        <label>
          <span>Search equipment</span>
          <input
            value={filters.search}
            onChange={(event) =>
              setFilters((current) => ({ ...current, search: event.target.value }))
            }
            placeholder="Code, type, make, model, serial or chassis"
          />
        </label>
        <label>
          <span>Purpose</span>
          <select
            value={filters.purpose}
            onChange={(event) =>
              setFilters((current) => ({ ...current, purpose: event.target.value }))
            }
          >
            <option value="">All purposes</option>
            {PURPOSES.map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Sale status</span>
          <select
            value={filters.sale_status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, sale_status: event.target.value }))
            }
          >
            <option value="">All sale statuses</option>
            {SALE_STATUSES.map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Operating status</span>
          <select
            value={filters.current_status}
            onChange={(event) =>
              setFilters((current) => ({ ...current, current_status: event.target.value }))
            }
          >
            <option value="">All operating statuses</option>
            {CURRENT_STATUSES.map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="equipment-catalogue__grid" aria-busy={loading}>
        {loading ? (
          <div className="equipment-catalogue__empty">Loading equipment catalogue…</div>
        ) : assets.length === 0 ? (
          <div className="equipment-catalogue__empty">
            <span>🚜</span>
            <h2>No equipment found</h2>
            <p>Add the first excavator or change the filters.</p>
          </div>
        ) : (
          assets.map((asset) => (
            <article className="equipment-card" key={asset.id}>
              <button
                type="button"
                className="equipment-card__image"
                onClick={() => openDetail(asset)}
                aria-label={`Open ${asset.asset_name}`}
              >
                {asset.main_image_url ? (
                  <img src={asset.main_image_url} alt={asset.asset_name} />
                ) : (
                  <span>🚜</span>
                )}
                <small>{asset.asset_code}</small>
              </button>
              <div className="equipment-card__body">
                <div className="equipment-card__heading">
                  <div>
                    <p>{asset.asset_type}</p>
                    <h2>{asset.asset_name}</h2>
                    <span>
                      {[asset.make, asset.model, asset.model_year].filter(Boolean).join(" • ") ||
                        "Make and model not recorded"}
                    </span>
                  </div>
                  <b className={`is-${asset.sale_status}`}>{label(asset.sale_status)}</b>
                </div>
                <dl>
                  <div><dt>Purpose</dt><dd>{label(asset.operational_purpose)}</dd></div>
                  <div><dt>Condition</dt><dd>{label(asset.condition_status)}</dd></div>
                  <div><dt>Meter</dt><dd>{Number(asset.current_meter || 0).toLocaleString()}</dd></div>
                  <div><dt>Pictures</dt><dd>{asset.media_count || 0}</dd></div>
                </dl>
                <div className="equipment-card__prices">
                  <span><small>Selling price</small><strong>{money(asset.target_selling_price)}</strong></span>
                  <span><small>Hire rate</small><strong>{money(asset.standard_hire_rate)}</strong></span>
                </div>
                {Number(asset.active_hire_assignment_count || 0) > 0 ? (
                  <p className="equipment-card__guard">🔒 Active on Hire</p>
                ) : asset.active_sale_lock_status ? (
                  <p className="equipment-card__guard">🔒 {label(asset.active_sale_lock_status)}</p>
                ) : (
                  <p className="equipment-card__ready">✓ Available for approved work</p>
                )}
              </div>
              <footer>
                <button type="button" onClick={() => openDetail(asset)}>View record</button>
                {canManage ? (
                  <>
                    <button type="button" onClick={() => startMedia(asset)}>＋ Picture</button>
                    <button type="button" onClick={() => openEdit(asset)}>Edit</button>
                  </>
                ) : null}
              </footer>
            </article>
          ))
        )}
      </section>

      {assetSheet ? (
        <Sheet
          title={editingId ? "Edit equipment" : "Add equipment"}
          subtitle="Identity, commercial value and operating availability"
          onClose={() => !saving && setAssetSheet(false)}
        >
          <form className="equipment-catalogue__form" onSubmit={saveAsset}>
            <Field label="Equipment code"><input required value={assetForm.asset_code} onChange={(e) => updateAsset("asset_code", e.target.value)} placeholder="EXC-001" /></Field>
            <Field label="Equipment name"><input required value={assetForm.asset_name} onChange={(e) => updateAsset("asset_name", e.target.value)} placeholder="CAT 320 Excavator" /></Field>
            <Field label="Equipment type"><input required value={assetForm.asset_type} onChange={(e) => updateAsset("asset_type", e.target.value)} placeholder="Excavator" /></Field>
            <Field label="Category"><input value={assetForm.equipment_category} onChange={(e) => updateAsset("equipment_category", e.target.value)} placeholder="Heavy Equipment" /></Field>
            <Field label="Make"><input value={assetForm.make} onChange={(e) => updateAsset("make", e.target.value)} placeholder="Caterpillar" /></Field>
            <Field label="Model"><input value={assetForm.model} onChange={(e) => updateAsset("model", e.target.value)} placeholder="320 GC" /></Field>
            <Field label="Model year"><input type="number" min="1950" value={assetForm.model_year} onChange={(e) => updateAsset("model_year", e.target.value)} /></Field>
            <Field label="Condition"><select value={assetForm.condition_status} onChange={(e) => updateAsset("condition_status", e.target.value)}>{CONDITIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
            <Field label="Serial number"><input value={assetForm.serial_number} onChange={(e) => updateAsset("serial_number", e.target.value)} /></Field>
            <Field label="Chassis number"><input value={assetForm.chassis_number} onChange={(e) => updateAsset("chassis_number", e.target.value)} /></Field>
            <Field label="Engine number"><input value={assetForm.engine_number} onChange={(e) => updateAsset("engine_number", e.target.value)} /></Field>
            <Field label="Registration number"><input value={assetForm.registration_number} onChange={(e) => updateAsset("registration_number", e.target.value)} /></Field>
            <Field label="Operating purpose"><select value={assetForm.operational_purpose} onChange={(e) => updateAsset("operational_purpose", e.target.value)}>{PURPOSES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
            <Field label="Sale status"><select value={assetForm.sale_status} onChange={(e) => updateAsset("sale_status", e.target.value)} disabled={["hire_only", "company_operations"].includes(assetForm.operational_purpose)}>{SALE_STATUSES.filter(([value]) => value !== "sold").map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
            <Field label="Operating status"><select value={assetForm.current_status} onChange={(e) => updateAsset("current_status", e.target.value)}>{CURRENT_STATUSES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
            <Field label="Current meter"><input type="number" min="0" step="0.01" value={assetForm.current_meter} onChange={(e) => updateAsset("current_meter", e.target.value)} /></Field>
            <Field label="Acquisition date"><input type="date" value={assetForm.acquisition_date} onChange={(e) => updateAsset("acquisition_date", e.target.value)} /></Field>
            <Field label="Acquisition cost"><input type="number" min="0" step="0.01" value={assetForm.acquisition_cost} onChange={(e) => updateAsset("acquisition_cost", e.target.value)} /></Field>
            <Field label="Target selling price"><input type="number" min="0" step="0.01" value={assetForm.target_selling_price} onChange={(e) => updateAsset("target_selling_price", e.target.value)} /></Field>
            <Field label="Standard Hire rate"><input type="number" min="0" step="0.01" value={assetForm.standard_hire_rate} onChange={(e) => updateAsset("standard_hire_rate", e.target.value)} /></Field>
            <Field label="Supplier"><input value={assetForm.supplier_name} onChange={(e) => updateAsset("supplier_name", e.target.value)} /></Field>
            <Field label="Supplier reference"><input value={assetForm.acquisition_reference} onChange={(e) => updateAsset("acquisition_reference", e.target.value)} /></Field>
            <Field label="Colour"><input value={assetForm.colour} onChange={(e) => updateAsset("colour", e.target.value)} /></Field>
            <Field label="Capacity / tonnage"><input value={assetForm.capacity_description} onChange={(e) => updateAsset("capacity_description", e.target.value)} /></Field>
            <Field label="Insurance expiry"><input type="date" value={assetForm.insurance_expiry} onChange={(e) => updateAsset("insurance_expiry", e.target.value)} /></Field>
            <Field label="Registration expiry"><input type="date" value={assetForm.registration_expiry} onChange={(e) => updateAsset("registration_expiry", e.target.value)} /></Field>
            <Field label="Notes" wide><textarea rows="4" value={assetForm.notes} onChange={(e) => updateAsset("notes", e.target.value)} placeholder="Condition, attachments, history and other important notes" /></Field>
            <footer className="equipment-catalogue__form-actions">
              <button type="button" onClick={() => setAssetSheet(false)} disabled={saving}>Cancel</button>
              <button type="submit" className="is-primary" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Add equipment"}</button>
            </footer>
          </form>
        </Sheet>
      ) : null}

      {detailSheet ? (
        <Sheet
          title={selectedAsset?.asset?.asset_name || "Equipment record"}
          subtitle={selectedAsset?.asset?.asset_code || ""}
          onClose={() => setDetailSheet(false)}
        >
          {detailLoading ? <div className="equipment-catalogue__empty">Loading verified record…</div> : selectedAsset?.asset ? (
            <div className="equipment-detail">
              <div className="equipment-detail__cover">
                {selectedAsset.asset.main_image_url ? <img src={selectedAsset.asset.main_image_url} alt={selectedAsset.asset.asset_name} /> : <span>🚜</span>}
                <div><p>{selectedAsset.asset.asset_type}</p><h3>{selectedAsset.asset.asset_name}</h3><span>{[selectedAsset.asset.make, selectedAsset.asset.model, selectedAsset.asset.model_year].filter(Boolean).join(" • ")}</span></div>
              </div>
              <section className="equipment-detail__facts">
                {[
                  ["Serial number", selectedAsset.asset.serial_number],
                  ["Chassis number", selectedAsset.asset.chassis_number],
                  ["Engine number", selectedAsset.asset.engine_number],
                  ["Registration", selectedAsset.asset.registration_number],
                  ["Purpose", label(selectedAsset.asset.operational_purpose)],
                  ["Sale status", label(selectedAsset.asset.sale_status)],
                  ["Operating status", label(selectedAsset.asset.current_status)],
                  ["Condition", label(selectedAsset.asset.condition_status)],
                  ["Current meter", Number(selectedAsset.asset.current_meter || 0).toLocaleString()],
                  ["Acquisition cost", money(selectedAsset.asset.acquisition_cost)],
                  ["Selling price", money(selectedAsset.asset.target_selling_price)],
                  ["Hire rate", money(selectedAsset.asset.standard_hire_rate)],
                ].map(([term, value]) => <div key={term}><span>{term}</span><strong>{value || "—"}</strong></div>)}
              </section>
              <section className="equipment-detail__guard">
                <h3>Availability control</h3>
                <p className={selectedAsset.safeguards?.can_enter_sale ? "is-ready" : "is-blocked"}>{selectedAsset.safeguards?.can_enter_sale ? "✓ Available for an approved sale" : "🔒 Not currently available for sale"}</p>
                <p className={selectedAsset.safeguards?.can_enter_hire ? "is-ready" : "is-blocked"}>{selectedAsset.safeguards?.can_enter_hire ? "✓ Available for an approved Hire assignment" : "🔒 Not currently available for Hire"}</p>
              </section>
              <section className="equipment-detail__gallery">
                <header><div><p>Equipment evidence</p><h3>Pictures &amp; documents</h3></div>{canManage ? <button type="button" onClick={() => startMedia(selectedAsset.asset)}>＋ Add picture</button> : null}</header>
                <div>{(selectedAsset.media || []).filter((media) => !media.archived_at).map((media) => <article key={media.id}>{media.media_category === "photo" ? <img src={media.thumbnail_url || media.file_url} alt={media.caption || label(media.evidence_type)} /> : <span>📄</span>}<div><b>{label(media.evidence_type)}</b><small>{media.caption || media.file_name || "Equipment evidence"}</small></div>{media.is_primary ? <em>Main</em> : canManage && media.media_category === "photo" ? <button type="button" onClick={() => makePrimary(selectedAsset.asset.id, media.id)}>Make main</button> : null}{canManage ? <button type="button" className="is-danger" onClick={() => archiveMedia(selectedAsset.asset.id, media.id)}>Archive</button> : null}</article>)}</div>
                {(selectedAsset.media || []).filter((media) => !media.archived_at).length === 0 ? <p className="equipment-detail__no-media">No pictures or documents have been added.</p> : null}
              </section>
            </div>
          ) : null}
        </Sheet>
      ) : null}

      {mediaSheet ? (
        <Sheet title="Add equipment picture" subtitle={selectedAsset?.asset?.asset_name || ""} onClose={() => !saving && setMediaSheet(false)}>
          <form className="equipment-catalogue__form" onSubmit={saveMedia}>
            <Field label="Picture type"><select value={mediaForm.evidence_type} onChange={(e) => setMediaForm((current) => ({ ...current, evidence_type: e.target.value, is_primary: e.target.value === "main" ? true : current.is_primary }))}>{EVIDENCE_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
            <Field label="Choose from phone" hint="The selected file details are prepared here; the secure storage URL is required until the media-volume upload service is enabled."><input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePickedFile} /></Field>
            <Field label="Secure picture URL" wide><input required type="url" value={mediaForm.file_url} onChange={(e) => setMediaForm((current) => ({ ...current, file_url: e.target.value }))} placeholder="https://secure-storage.example/equipment/photo.webp" /></Field>
            <Field label="Caption" wide><input value={mediaForm.caption} onChange={(e) => setMediaForm((current) => ({ ...current, caption: e.target.value }))} placeholder="Front view before delivery" /></Field>
            <Field label="Use as main picture"><select value={mediaForm.is_primary ? "yes" : "no"} onChange={(e) => setMediaForm((current) => ({ ...current, is_primary: e.target.value === "yes" }))}><option value="yes">Yes</option><option value="no">No</option></select></Field>
            <footer className="equipment-catalogue__form-actions"><button type="button" onClick={() => setMediaSheet(false)} disabled={saving}>Cancel</button><button type="submit" className="is-primary" disabled={saving}>{saving ? "Saving…" : "Save picture"}</button></footer>
          </form>
        </Sheet>
      ) : null}
    </main>
  );
}
