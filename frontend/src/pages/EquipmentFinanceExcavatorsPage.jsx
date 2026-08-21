import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import InstallmentEntityDeleteDialog from "../components/InstallmentEntityDeleteDialog";
import "../styles/equipmentFinancePhaseOne.css";
import "../styles/equipmentFinanceExcavatorRegistration.css";

const MACHINE_API = "/equipment-catalogue/sales/professional/machine-register";
const BOOTSTRAP_API = "/equipment-catalogue/sales/phase-one/bootstrap";
const EMPTY_MACHINE = { asset_code: "", asset_name: "", asset_type: "Excavator", equipment_category: "Earthmoving Equipment", make: "", model: "", model_year: "", serial_number: "", chassis_number: "", engine_number: "", registration_number: "", colour: "", capacity_description: "", condition_status: "good", ownership_type: "company_owned", operational_purpose: "sale_only", meter_type: "hour_meter", current_meter: "0", fuel_type: "Diesel", acquisition_date: "", acquisition_cost: "0", target_selling_price: "", minimum_selling_price: "0", supplier_name: "", acquisition_reference: "", customs_reference: "", title_document_reference: "", insurance_reference: "", insurance_expiry: "", registration_expiry: "", equipment_origin_location_id: "", notes: "" };
const PHOTO_TYPES = ["main", "front", "rear", "left_side", "right_side", "cabin", "engine", "serial_plate", "chassis_plate", "attachment", "inspection", "damage", "registration", "insurance", "ownership", "other"];

function money(value) { return `GHS ${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function label(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function errorMessage(error, fallback) { return error?.response?.data?.message || error?.message || fallback; }
function dateInput(value) { return value ? String(value).slice(0, 10) : ""; }

function ModalField({ title, children, wide = false, hint = "" }) {
  return (
    <label className={`excavator-registration-modal__field${wide ? " excavator-registration-modal__field--wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ExcavatorRegistrationDialog({ editing, form, photos, locations, saving, onClose, onSave, onValue, onAddPhotos, onUpdatePhoto, onRemovePhoto }) {
  useEffect(() => {
    if (!editing) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [editing]);

  if (!editing || typeof document === "undefined") return null;
  const isEdit = Boolean(editing.id);
  return createPortal(
    <div className="excavator-registration-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="excavator-registration-modal" role="dialog" aria-modal="true" aria-labelledby="excavator-registration-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="excavator-registration-modal__header">
          <div className="excavator-registration-modal__header-copy">
            <p className="excavator-registration-modal__eyebrow">Protected machine file</p>
            <h2 id="excavator-registration-title" className="excavator-registration-modal__title">{isEdit ? "Edit Excavator" : "Register New Excavator"}</h2>
            <p className="excavator-registration-modal__subtitle">All fields stay inside the dialog. Scroll the form, not the page. Photos remain contained and uncropped.</p>
          </div>
          <button className="excavator-registration-modal__close" type="button" onClick={onClose}>Close</button>
        </header>

        <form className="excavator-registration-modal__body" onSubmit={onSave}>
          <div className="excavator-registration-modal__grid">
            <ModalField title="Equipment code"><input value={form.asset_code} onChange={(event) => onValue("asset_code", event.target.value)} required autoFocus /></ModalField>
            <ModalField title="Machine name"><input value={form.asset_name} onChange={(event) => onValue("asset_name", event.target.value)} required /></ModalField>
            <ModalField title="Make"><input value={form.make} onChange={(event) => onValue("make", event.target.value)} required /></ModalField>
            <ModalField title="Model"><input value={form.model} onChange={(event) => onValue("model", event.target.value)} required /></ModalField>
            <ModalField title="Model year"><input type="number" min="1950" value={form.model_year} onChange={(event) => onValue("model_year", event.target.value)} /></ModalField>
            <ModalField title="Colour"><input value={form.colour} onChange={(event) => onValue("colour", event.target.value)} /></ModalField>
            <ModalField title="Serial number"><input value={form.serial_number} onChange={(event) => onValue("serial_number", event.target.value)} /></ModalField>
            <ModalField title="Chassis number"><input value={form.chassis_number} onChange={(event) => onValue("chassis_number", event.target.value)} /></ModalField>
            <ModalField title="Engine number"><input value={form.engine_number} onChange={(event) => onValue("engine_number", event.target.value)} /></ModalField>
            <ModalField title="Registration / number plate"><input value={form.registration_number} onChange={(event) => onValue("registration_number", event.target.value)} /></ModalField>
            <ModalField title="Capacity / specification"><input value={form.capacity_description} onChange={(event) => onValue("capacity_description", event.target.value)} /></ModalField>
            <ModalField title="Condition"><select value={form.condition_status} onChange={(event) => onValue("condition_status", event.target.value)}><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="under_inspection">Under inspection</option><option value="damaged">Damaged</option></select></ModalField>
            <ModalField title="Sale purpose"><select value={form.operational_purpose} onChange={(event) => onValue("operational_purpose", event.target.value)}><option value="sale_only">Sale only</option><option value="sale_or_hire">Sale or Hire</option></select></ModalField>
            <ModalField title="Ownership"><select value={form.ownership_type} onChange={(event) => onValue("ownership_type", event.target.value)}><option value="company_owned">Company owned</option><option value="consignment">Consignment</option><option value="leased">Leased</option><option value="customer_owned">Customer owned</option></select></ModalField>
            <ModalField title="Current meter"><input type="number" min="0" step="0.01" value={form.current_meter} onChange={(event) => onValue("current_meter", event.target.value)} /></ModalField>
            <ModalField title="Physical yard / storage"><select value={form.equipment_origin_location_id} onChange={(event) => onValue("equipment_origin_location_id", event.target.value)}><option value="">Company-wide / not assigned</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></ModalField>
            <ModalField title="Target selling price" hint={money(form.target_selling_price)}><input inputMode="decimal" value={form.target_selling_price} onChange={(event) => onValue("target_selling_price", event.target.value.replace(/[^0-9.,]/g, ""))} required /></ModalField>
            <ModalField title="Minimum approved price" hint={money(form.minimum_selling_price)}><input inputMode="decimal" value={form.minimum_selling_price} onChange={(event) => onValue("minimum_selling_price", event.target.value.replace(/[^0-9.,]/g, ""))} /></ModalField>
            <ModalField title="Acquisition cost" hint={money(form.acquisition_cost)}><input inputMode="decimal" value={form.acquisition_cost} onChange={(event) => onValue("acquisition_cost", event.target.value.replace(/[^0-9.,]/g, ""))} /></ModalField>
            <ModalField title="Acquisition date"><input type="date" value={form.acquisition_date} onChange={(event) => onValue("acquisition_date", event.target.value)} /></ModalField>
            <ModalField title="Supplier"><input value={form.supplier_name} onChange={(event) => onValue("supplier_name", event.target.value)} /></ModalField>
            <ModalField title="Acquisition reference"><input value={form.acquisition_reference} onChange={(event) => onValue("acquisition_reference", event.target.value)} /></ModalField>
            <ModalField title="Customs reference"><input value={form.customs_reference} onChange={(event) => onValue("customs_reference", event.target.value)} /></ModalField>
            <ModalField title="Title document reference"><input value={form.title_document_reference} onChange={(event) => onValue("title_document_reference", event.target.value)} /></ModalField>
            <ModalField title="Insurance reference"><input value={form.insurance_reference} onChange={(event) => onValue("insurance_reference", event.target.value)} /></ModalField>
            <ModalField title="Notes" wide><textarea value={form.notes} onChange={(event) => onValue("notes", event.target.value)} /></ModalField>
            <ModalField title={isEdit ? "Add more photos" : "Full machine photos"} wide hint={isEdit ? "Existing photos stay in the protected record. New photos are appended." : "A main full-machine photo is required."}><input type="file" accept="image/*" capture="environment" multiple onChange={onAddPhotos} /></ModalField>
          </div>

          {photos.length ? (
            <div className="excavator-registration-modal__photos">
              {photos.map((photo, index) => (
                <article className="excavator-registration-modal__photo" key={`${photo.file_name}-${index}`}>
                  <div className="excavator-registration-modal__photo-preview"><img src={photo.data_url} alt={photo.evidence_type} /></div>
                  <div className="excavator-registration-modal__photo-controls">
                    <select value={photo.evidence_type} onChange={(event) => onUpdatePhoto(index, "evidence_type", event.target.value)}>{PHOTO_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select>
                    <label className="excavator-registration-modal__check"><input type="radio" name="primary-photo" checked={photo.is_primary} onChange={() => onUpdatePhoto(index, "is_primary", true)} /><span>Main photo</span></label>
                    <button className="excavator-registration-modal__remove" type="button" onClick={() => onRemovePhoto(index)}>Remove</button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </form>

        <footer className="excavator-registration-modal__footer">
          <span className="excavator-registration-modal__footer-copy">{isEdit ? "Editable because no installment has started." : "Create a new protected excavator file."}</span>
          <div className="excavator-registration-modal__footer-actions">
            <button className="excavator-registration-modal__button" type="button" onClick={onClose}>Cancel</button>
            <button className="excavator-registration-modal__button excavator-registration-modal__button--primary" type="submit" form="excavator-registration-form" disabled={saving}> {saving ? "Saving…" : "Save Excavator"} </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}

export default function EquipmentFinanceExcavatorsPage() {
  const { effectivePermissions = [], user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canManage = effectivePermissions.includes("fleet.assets.manage") || ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(role);
  const isOriginalAdmin = Boolean(user?.is_original_system_administrator);
  const [machines, setMachines] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_MACHINE);
  const [photos, setPhotos] = useState([]);
  const [viewerPhoto, setViewerPhoto] = useState(null);

  const load = useCallback(async () => { setLoading(true); setProblem(""); try { const [bootstrapResponse, locationResponse] = await Promise.all([axiosClient.get(BOOTSTRAP_API), axiosClient.get(`${MACHINE_API}/locations`)]); setMachines(bootstrapResponse.data?.machines || []); setLocations(locationResponse.data?.locations || []); } catch (error) { setProblem(errorMessage(error, "Could not load the excavator register.")); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const visibleMachines = useMemo(() => { const term = search.trim().toLowerCase(); if (!term) return machines; return machines.filter((machine) => [machine.asset_code, machine.asset_name, machine.make, machine.model, machine.serial_number, machine.chassis_number, machine.registration_number].filter(Boolean).some((value) => String(value).toLowerCase().includes(term))); }, [machines, search]);
  function setValue(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function openCreate() { setEditing({ id: null }); setForm({ ...EMPTY_MACHINE }); setPhotos([]); setProblem(""); }
  function openEdit(machine) {
    if (!machine.editability?.editable) { setProblem(machine.editability?.reason || "This excavator can no longer be edited from the register."); return; }
    setEditing(machine);
    setForm({ ...EMPTY_MACHINE, asset_code: machine.asset_code || "", asset_name: machine.asset_name || "", asset_type: machine.asset_type || "Excavator", equipment_category: machine.equipment_category || "Earthmoving Equipment", make: machine.make || "", model: machine.model || "", model_year: machine.model_year || "", serial_number: machine.serial_number || "", chassis_number: machine.chassis_number || "", engine_number: machine.engine_number || "", registration_number: machine.registration_number || "", colour: machine.colour || "", capacity_description: machine.capacity_description || "", condition_status: machine.condition_status || "good", ownership_type: machine.ownership_type || "company_owned", operational_purpose: machine.operational_purpose || "sale_only", meter_type: machine.meter_type || "hour_meter", current_meter: machine.current_meter ?? "0", fuel_type: machine.fuel_type || "Diesel", acquisition_date: dateInput(machine.acquisition_date), acquisition_cost: machine.acquisition_cost ?? "0", target_selling_price: machine.target_selling_price ?? "", minimum_selling_price: machine.minimum_selling_price ?? "0", supplier_name: machine.supplier_name || "", acquisition_reference: machine.acquisition_reference || "", customs_reference: machine.customs_reference || "", title_document_reference: machine.title_document_reference || "", insurance_reference: machine.insurance_reference || "", insurance_expiry: dateInput(machine.insurance_expiry), registration_expiry: dateInput(machine.registration_expiry), equipment_origin_location_id: machine.hire_location_id || "", notes: machine.notes || "" });
    setPhotos([]); setProblem("");
  }
  async function addPhotos(event) {
    const files = [...(event.target.files || [])]; event.target.value = ""; if (!files.length) return; setProblem("");
    try {
      const prepared = [];
      for (let index = 0; index < files.length; index += 1) {
        const dataUrl = await imageToProtectedDataUrl(files[index]);
        const position = photos.length + index;
        prepared.push({ data_url: dataUrl, file_name: files[index].name, evidence_type: position === 0 && !editing?.id ? "main" : "other", is_primary: position === 0 && !editing?.id, caption: "" });
      }
      setPhotos((current) => [...current, ...prepared].slice(0, 20));
    } catch (error) { setProblem(error.message); }
  }
  function updatePhoto(index, field, value) { setPhotos((current) => current.map((photo, photoIndex) => { if (field === "is_primary" && value && photoIndex !== index) return { ...photo, is_primary: false }; return photoIndex === index ? { ...photo, [field]: value } : photo; })); }
  async function save(event) {
    event.preventDefault();
    if (!editing?.id && !photos.some((photo) => photo.is_primary)) { setProblem("Add one full main excavator photo before saving."); return; }
    setSaving(true); setProblem(""); setNotice("");
    try {
      const response = editing?.id ? await axiosClient.put(`${MACHINE_API}/${editing.id}`, { ...form, photos }) : await axiosClient.post(MACHINE_API, { ...form, photos });
      setEditing(null); setForm({ ...EMPTY_MACHINE }); setPhotos([]); setNotice(response.data?.message || "Excavator saved."); await load();
    } catch (error) { setProblem(errorMessage(error, "Could not save the excavator.")); } finally { setSaving(false); }
  }
  const totalValue = machines.reduce((sum, machine) => sum + Number(machine.target_selling_price || 0), 0);

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero"><div><p>One source of truth</p><h1>Excavators</h1><span>The old register and Finance Equipment Reference are now one page. View complete photos and values here; edit only before an installment application begins. Delete is available only to the original System Administrator and clears the complete Installment integration first.</span></div><div className="finance-simple__hero-actions"><Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=start">Start New Installment</Link>{canManage ? <button className="is-primary" type="button" onClick={openCreate}>+ Register Excavator</button> : null}</div></header>
      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}
      <section className="finance-simple__metrics"><article className="finance-simple__metric"><span>Registered excavators</span><strong>{machines.length}</strong></article><article className="finance-simple__metric"><span>Finance-ready</span><strong>{machines.filter((item) => item.readiness?.ready).length}</strong></article><article className="finance-simple__metric"><span>Available for installment</span><strong>{machines.filter((item) => item.readiness?.ready && item.sale_status === "available" && Number(item.active_application_count || 0) === 0).length}</strong></article><article className="finance-simple__metric"><span>Total sale value</span><strong>{money(totalValue)}</strong></article></section>
      <section className="finance-simple__section"><div className="finance-simple__toolbar"><div><p className="finance-simple__eyebrow">Machine register</p><h2>{visibleMachines.length} machine(s)</h2></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, make, model, serial or chassis" /></div>
        {loading ? <div className="finance-simple__empty">Loading excavators…</div> : null}
        {!loading && !visibleMachines.length ? <div className="finance-simple__empty">No matching excavator records.</div> : null}
        <div className="finance-simple__machine-grid">{visibleMachines.map((machine) => { const primary = machine.media?.find((item) => item.is_primary)?.file_url || machine.main_image_url; const canEdit = Boolean(machine.editability?.editable); return <article className="finance-simple__machine" key={machine.id}>
          <button className="finance-simple__machine-image" type="button" onClick={() => primary && setViewerPhoto({ url: primary, title: machine.asset_name })} aria-label={`View full photo of ${machine.asset_name}`}>{primary ? <img src={primary} alt={machine.asset_name} /> : <span>🚜</span>}</button>
          <div className="finance-simple__machine-body"><div className="finance-simple__card-head"><div><span className="finance-simple__pill">{machine.asset_code}</span><h3>{machine.asset_name}</h3><p>{[machine.make, machine.model, machine.model_year].filter(Boolean).join(" · ")}</p></div><span className={`finance-simple__pill ${machine.readiness?.ready ? "is-good" : "is-warning"}`}>{machine.readiness?.ready ? "Finance ready" : "Needs evidence"}</span></div>
            <div className="finance-simple__facts"><div><span>Sale value</span><strong>{money(machine.target_selling_price)}</strong></div><div><span>Minimum price</span><strong>{money(machine.minimum_selling_price)}</strong></div><div><span>Serial / chassis</span><strong>{machine.serial_number || machine.chassis_number || "Missing"}</strong></div><div><span>Physical yard</span><strong>{machine.location_name || "Company-wide / not assigned"}</strong></div><div><span>Photos</span><strong>{machine.media?.length || 0}</strong></div><div><span>Sale status</span><strong>{label(machine.sale_status)}</strong></div></div>
            {!machine.readiness?.ready ? <div className="finance-simple__notice is-info">Missing: {(machine.readiness?.missing || []).join(", ")}</div> : null}
            <div className="finance-simple__card-actions">{machine.media?.map((photo) => <button type="button" key={photo.id} onClick={() => setViewerPhoto({ url: photo.file_url, title: `${machine.asset_name} — ${label(photo.evidence_type)}` })}>{label(photo.evidence_type)}</button>).slice(0, 3)}{canManage ? <button type="button" disabled={!canEdit} onClick={() => openEdit(machine)}>{canEdit ? "Edit details" : "Editing locked"}</button> : null}{isOriginalAdmin ? <button className="is-danger" type="button" onClick={() => setDeleteTarget(machine)}>Delete</button> : null}{machine.readiness?.ready && machine.sale_status === "available" && Number(machine.active_application_count || 0) === 0 ? <Link className="finance-simple__button is-primary" to={`/equipment-installment-finance/applications?stage=start&asset=${machine.id}`}>Start Installment</Link> : null}</div>
            {!canEdit ? <small>{machine.editability?.reason}</small> : null}
          </div></article>; })}</div>
      </section>

      {deleteTarget ? <InstallmentEntityDeleteDialog entityType="asset" entityId={deleteTarget.id} name={deleteTarget.asset_name} onClose={() => setDeleteTarget(null)} onDeleted={(result) => { setDeleteTarget(null); setNotice(result?.message || "Installment excavator deleted."); load(); }} /> : null}

      <ExcavatorRegistrationDialog editing={editing} form={form} photos={photos} locations={locations} saving={saving} onClose={() => setEditing(null)} onSave={save} onValue={setValue} onAddPhotos={addPhotos} onUpdatePhoto={updatePhoto} onRemovePhoto={(index) => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))} />

      {viewerPhoto ? <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => setViewerPhoto(null)}><section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label={viewerPhoto.title} onMouseDown={(event) => event.stopPropagation()}><div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Complete uncropped photo</p><h2>{viewerPhoto.title}</h2></div><button type="button" onClick={() => setViewerPhoto(null)}>Close</button></div><div className="finance-simple__photo-viewer"><img src={viewerPhoto.url} alt={viewerPhoto.title} /></div></section></div> : null}
    </main>
  );
}
