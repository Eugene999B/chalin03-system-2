import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import EquipmentDivisionStaffManager from "../components/EquipmentDivisionStaffManager";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinanceProfessional.css";

const API = "/equipment-catalogue/sales";
const MACHINE_API = `${API}/professional/machine-register`;
const SETTINGS_API = `${API}/professional/settings`;
const DOCUMENT_API = `${API}/professional/documents`;
const LIFECYCLE_API = `${API}/finance-lifecycle`;

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function currency(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function label(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

async function imageToProtectedDataUrl(file, { signature = false } = {}) {
  if (!file?.type?.startsWith("image/")) throw new Error("Choose a valid image.");
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const item = new Image();
    item.onload = () => resolve(item);
    item.onerror = () => reject(new Error("Could not prepare the selected image."));
    item.src = source;
  });

  let maximumWidth = signature ? 900 : 1280;
  let maximumHeight = signature ? 360 : 960;
  let quality = signature ? 0.78 : 0.72;
  let output = "";

  for (let pass = 0; pass < 12; pass += 1) {
    const scale = Math.min(maximumWidth / image.width, maximumHeight / image.height, 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    output = canvas.toDataURL("image/webp", quality);
    const bytes = Math.ceil((output.length - output.indexOf(",") - 1) * 0.75);
    if (bytes <= 47 * 1024) return output;
    quality = Math.max(0.35, quality - 0.06);
    maximumWidth = Math.round(maximumWidth * 0.88);
    maximumHeight = Math.round(maximumHeight * 0.88);
  }

  throw new Error("The image is still too large after safe resizing. Choose a clearer, smaller picture.");
}

const EMPTY_MACHINE = {
  asset_code: "",
  asset_name: "",
  asset_type: "Excavator",
  equipment_category: "Earthmoving Equipment",
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
  operational_purpose: "sale_only",
  meter_type: "hour_meter",
  current_meter: "0",
  fuel_type: "Diesel",
  acquisition_date: "",
  acquisition_cost: "0",
  target_selling_price: "",
  minimum_selling_price: "0",
  supplier_name: "",
  acquisition_reference: "",
  customs_reference: "",
  title_document_reference: "",
  insurance_reference: "",
  insurance_expiry: "",
  registration_expiry: "",
  equipment_origin_location_id: "",
  notes: "",
};

const PHOTO_TYPES = [
  "main",
  "front",
  "rear",
  "left_side",
  "right_side",
  "cabin",
  "engine",
  "serial_plate",
  "chassis_plate",
  "attachment",
  "inspection",
  "damage",
  "registration",
  "ownership",
];

function PageHeader({ eyebrow, title, description, actions = null }) {
  return (
    <header className="finance-pro__header">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {actions ? <div className="finance-pro__header-actions">{actions}</div> : null}
    </header>
  );
}

function StatusMessage({ problem, notice }) {
  if (!problem && !notice) return null;
  return (
    <div className={`finance-pro__message ${problem ? "is-error" : "is-success"}`} role={problem ? "alert" : "status"}>
      {problem || notice}
    </div>
  );
}

function Field({ label: title, required = false, children, wide = false, hint = "" }) {
  return (
    <label className={wide ? "finance-pro__field is-wide" : "finance-pro__field"}>
      <span>
        {title} {required ? <b>*</b> : null}
      </span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function MachineRegister() {
  const [machines, setMachines] = useState([]);
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState(EMPTY_MACHINE);
  const [photos, setPhotos] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const [machineResponse, locationResponse] = await Promise.all([
        axiosClient.get(MACHINE_API),
        axiosClient.get(`${MACHINE_API}/locations`),
      ]);
      setMachines(machineResponse.data?.machines || []);
      setLocations(locationResponse.data?.locations || []);
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the Finance Machine Register."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visibleMachines = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return machines;
    return machines.filter((machine) =>
      [
        machine.asset_code,
        machine.asset_name,
        machine.make,
        machine.model,
        machine.serial_number,
        machine.chassis_number,
        machine.registration_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [machines, search]);

  function setValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function addPhotos(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    setProblem("");
    try {
      const prepared = [];
      for (let index = 0; index < files.length; index += 1) {
        const dataUrl = await imageToProtectedDataUrl(files[index]);
        const position = photos.length + index;
        prepared.push({
          data_url: dataUrl,
          file_name: files[index].name,
          evidence_type: position === 0 ? "main" : "other",
          is_primary: position === 0,
          caption: "",
        });
      }
      setPhotos((current) => [...current, ...prepared].slice(0, 20));
    } catch (error) {
      setProblem(error.message);
    }
  }

  function updatePhoto(index, key, value) {
    setPhotos((current) =>
      current.map((photo, photoIndex) => {
        if (photoIndex !== index) {
          return key === "is_primary" && value ? { ...photo, is_primary: false } : photo;
        }
        return { ...photo, [key]: value };
      })
    );
  }

  async function save(event) {
    event.preventDefault();
    if (!photos.some((photo) => photo.is_primary)) {
      setProblem("Capture and select one full main excavator photo.");
      return;
    }
    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(MACHINE_API, {
        ...form,
        photos,
      });
      setNotice(response.data?.message || "Excavator registered.");
      setForm(EMPTY_MACHINE);
      setPhotos([]);
      setShowForm(false);
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not register the excavator."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-pro">
      <PageHeader
        eyebrow="Exact-machine control"
        title="Excavator Register"
        description="Register every machine once with its legal identity, commercial value, physical yard and uncropped photo evidence before it can enter an installment application."
        actions={
          <button type="button" className="finance-pro__primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? "Close Registration" : "+ Register Excavator"}
          </button>
        }
      />
      <StatusMessage problem={problem} notice={notice} />

      <section className="finance-pro__metrics">
        <article><strong>{machines.length}</strong><span>Registered machines</span></article>
        <article><strong>{machines.filter((item) => item.readiness?.ready).length}</strong><span>Finance-ready</span></article>
        <article><strong>{machines.filter((item) => item.sale_status === "available").length}</strong><span>Available for sale</span></article>
        <article><strong>{machines.reduce((sum, item) => sum + Number(item.media?.length || 0), 0)}</strong><span>Protected photos</span></article>
      </section>

      {showForm ? (
        <form className="finance-pro__form-card" onSubmit={save}>
          <div className="finance-pro__section-title">
            <div><p>New machine file</p><h2>Identity, pricing and evidence</h2></div>
            <span>Fields marked * block Finance readiness when missing.</span>
          </div>
          <div className="finance-pro__form-grid">
            <Field label="Equipment code" required><input value={form.asset_code} onChange={(event) => setValue("asset_code", event.target.value)} placeholder="EXC-001" /></Field>
            <Field label="Machine name" required><input value={form.asset_name} onChange={(event) => setValue("asset_name", event.target.value)} placeholder="LiuGong 922E Excavator" /></Field>
            <Field label="Type" required><input value={form.asset_type} onChange={(event) => setValue("asset_type", event.target.value)} /></Field>
            <Field label="Category"><input value={form.equipment_category} onChange={(event) => setValue("equipment_category", event.target.value)} /></Field>
            <Field label="Make" required><input value={form.make} onChange={(event) => setValue("make", event.target.value)} placeholder="LiuGong" /></Field>
            <Field label="Model" required><input value={form.model} onChange={(event) => setValue("model", event.target.value)} placeholder="922E" /></Field>
            <Field label="Model year"><input type="number" value={form.model_year} onChange={(event) => setValue("model_year", event.target.value)} /></Field>
            <Field label="Colour"><input value={form.colour} onChange={(event) => setValue("colour", event.target.value)} /></Field>
            <Field label="Serial number"><input value={form.serial_number} onChange={(event) => setValue("serial_number", event.target.value)} /></Field>
            <Field label="Chassis number"><input value={form.chassis_number} onChange={(event) => setValue("chassis_number", event.target.value)} /></Field>
            <Field label="Engine number"><input value={form.engine_number} onChange={(event) => setValue("engine_number", event.target.value)} /></Field>
            <Field label="Registration / number plate"><input value={form.registration_number} onChange={(event) => setValue("registration_number", event.target.value)} /></Field>
            <Field label="Capacity / specification"><input value={form.capacity_description} onChange={(event) => setValue("capacity_description", event.target.value)} placeholder="22-ton class" /></Field>
            <Field label="Condition"><select value={form.condition_status} onChange={(event) => setValue("condition_status", event.target.value)}><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="under_inspection">Under inspection</option><option value="damaged">Damaged</option></select></Field>
            <Field label="Sale purpose"><select value={form.operational_purpose} onChange={(event) => setValue("operational_purpose", event.target.value)}><option value="sale_only">Sale only</option><option value="sale_or_hire">Sale or Hire</option></select></Field>
            <Field label="Ownership"><select value={form.ownership_type} onChange={(event) => setValue("ownership_type", event.target.value)}><option value="company_owned">Company owned</option><option value="consignment">Consignment</option><option value="leased">Leased</option><option value="customer_owned">Customer owned</option></select></Field>
            <Field label="Meter type"><select value={form.meter_type} onChange={(event) => setValue("meter_type", event.target.value)}><option value="hour_meter">Hour meter</option><option value="odometer">Odometer</option></select></Field>
            <Field label="Current meter"><input type="number" min="0" step="0.01" value={form.current_meter} onChange={(event) => setValue("current_meter", event.target.value)} /></Field>
            <Field label="Physical yard / location"><select value={form.equipment_origin_location_id} onChange={(event) => setValue("equipment_origin_location_id", event.target.value)}><option value="">Company-wide / not assigned</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <Field label="Target selling price" required><input type="number" min="0" step="0.01" value={form.target_selling_price} onChange={(event) => setValue("target_selling_price", event.target.value)} placeholder="2500000" /></Field>
            <Field label="Minimum approved price"><input type="number" min="0" step="0.01" value={form.minimum_selling_price} onChange={(event) => setValue("minimum_selling_price", event.target.value)} /></Field>
            <Field label="Acquisition cost"><input type="number" min="0" step="0.01" value={form.acquisition_cost} onChange={(event) => setValue("acquisition_cost", event.target.value)} /></Field>
            <Field label="Acquisition date"><input type="date" value={form.acquisition_date} onChange={(event) => setValue("acquisition_date", event.target.value)} /></Field>
            <Field label="Supplier"><input value={form.supplier_name} onChange={(event) => setValue("supplier_name", event.target.value)} /></Field>
            <Field label="Acquisition reference"><input value={form.acquisition_reference} onChange={(event) => setValue("acquisition_reference", event.target.value)} /></Field>
            <Field label="Customs reference"><input value={form.customs_reference} onChange={(event) => setValue("customs_reference", event.target.value)} /></Field>
            <Field label="Title document reference"><input value={form.title_document_reference} onChange={(event) => setValue("title_document_reference", event.target.value)} /></Field>
            <Field label="Insurance reference"><input value={form.insurance_reference} onChange={(event) => setValue("insurance_reference", event.target.value)} /></Field>
            <Field label="Fuel type"><input value={form.fuel_type} onChange={(event) => setValue("fuel_type", event.target.value)} /></Field>
            <Field label="Notes" wide><textarea rows="3" value={form.notes} onChange={(event) => setValue("notes", event.target.value)} /></Field>
          </div>

          <div className="finance-pro__photo-capture">
            <div><p>Machine evidence</p><h3>Capture full excavator and identity plates</h3><span>Pictures are resized for safe storage but displayed with the whole image visible—never cropped.</span></div>
            <label className="finance-pro__upload"><input type="file" accept="image/*" capture="environment" multiple onChange={addPhotos} />+ Add pictures</label>
          </div>
          <div className="finance-pro__photo-grid">
            {photos.map((photo, index) => (
              <article key={`${photo.file_name}-${index}`}>
                <img src={photo.data_url} alt={photo.evidence_type} />
                <select value={photo.evidence_type} onChange={(event) => updatePhoto(index, "evidence_type", event.target.value)}>{PHOTO_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select>
                <label className="finance-pro__check"><input type="radio" name="primary-photo" checked={photo.is_primary} onChange={() => updatePhoto(index, "is_primary", true)} />Main document photo</label>
                <input value={photo.caption} onChange={(event) => updatePhoto(index, "caption", event.target.value)} placeholder="Caption" />
                <button type="button" onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}>Remove</button>
              </article>
            ))}
          </div>
          <div className="finance-pro__form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="finance-pro__primary" type="submit" disabled={saving}>{saving ? "Saving machine…" : "Save Excavator File"}</button></div>
        </form>
      ) : null}

      <section className="finance-pro__register">
        <div className="finance-pro__toolbar"><div><h2>Registered excavators</h2><span>Select the exact machine later in the credit application.</span></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, make, model, serial…" /></div>
        {loading ? <div className="finance-pro__empty">Loading machine files…</div> : null}
        {!loading && visibleMachines.length === 0 ? <div className="finance-pro__empty">No matching excavators are registered.</div> : null}
        <div className="finance-pro__machine-grid">
          {visibleMachines.map((machine) => {
            const primary = machine.media?.find((item) => item.is_primary)?.file_url || machine.main_image_url;
            return (
              <article key={machine.id} className="finance-pro__machine-card">
                <div className="finance-pro__machine-image">{primary ? <img src={primary} alt={machine.asset_name} /> : <span>No photo</span>}<b className={machine.readiness?.ready ? "is-ready" : "is-review"}>{machine.readiness?.ready ? "Finance ready" : "Needs evidence"}</b></div>
                <div className="finance-pro__machine-body"><p>{machine.asset_code}</p><h3>{machine.asset_name}</h3><span>{[machine.make, machine.model, machine.model_year].filter(Boolean).join(" · ")}</span><dl><div><dt>Serial / chassis</dt><dd>{machine.serial_number || machine.chassis_number || "Missing"}</dd></div><div><dt>Selling price</dt><dd>{currency(machine.target_selling_price)}</dd></div><div><dt>Photos</dt><dd>{machine.media?.length || 0}</dd></div><div><dt>Yard</dt><dd>{machine.location_name || "Company-wide"}</dd></div></dl>{!machine.readiness?.ready ? <small>Missing: {(machine.readiness?.missing || []).join(", ")}</small> : null}</div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function SettingsWorkspace() {
  const [settings, setSettings] = useState(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(SETTINGS_API);
      setSettings(response.data?.settings || null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not load Finance settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setValue(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.put(SETTINGS_API, { settings, reason });
      setNotice(response.data?.message || "Finance settings saved.");
      setReason("");
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not save Finance settings."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="finance-pro"><div className="finance-pro__empty">Loading Professional Finance settings…</div></main>;

  return (
    <main className="finance-pro">
      <PageHeader eyebrow="Audited company policy" title="Finance Settings" description="Control agreement identity, deposits, schedules, late-payment treatment, delivery thresholds, boss alerts, customer reminders, signatures and legally reviewed terms from one protected page." />
      <StatusMessage problem={problem} notice={notice} />
      {!settings ? null : (
        <form className="finance-pro__settings" onSubmit={save}>
          <section><div className="finance-pro__section-title"><div><p>Company and document identity</p><h2>Chalin 03 agreement header</h2></div></div><div className="finance-pro__form-grid">
            <Field label="Company name"><input value={settings.company_name || ""} onChange={(event) => setValue("company_name", event.target.value)} /></Field>
            <Field label="Business phone"><input value={settings.company_phone || ""} onChange={(event) => setValue("company_phone", event.target.value)} /></Field>
            <Field label="Email"><input value={settings.company_email || ""} onChange={(event) => setValue("company_email", event.target.value)} /></Field>
            <Field label="Postal address"><input value={settings.company_postal_address || ""} onChange={(event) => setValue("company_postal_address", event.target.value)} /></Field>
            <Field label="Physical address" wide><input value={settings.company_address || ""} onChange={(event) => setValue("company_address", event.target.value)} /></Field>
            <Field label="Authorised seller / boss"><input value={settings.authorised_seller_name || ""} onChange={(event) => setValue("authorised_seller_name", event.target.value)} /></Field>
            <Field label="Seller title"><input value={settings.authorised_seller_title || ""} onChange={(event) => setValue("authorised_seller_title", event.target.value)} /></Field>
          </div></section>

          <section><div className="finance-pro__section-title"><div><p>Money and schedule</p><h2>Installment defaults</h2></div></div><div className="finance-pro__form-grid">
            <Field label="Minimum deposit %"><input type="number" min="0" max="100" step="0.01" value={settings.minimum_deposit_percent ?? 20} onChange={(event) => setValue("minimum_deposit_percent", event.target.value)} /></Field>
            <Field label="Maximum term months"><input type="number" min="1" value={settings.maximum_term_months ?? 36} onChange={(event) => setValue("maximum_term_months", event.target.value)} /></Field>
            <Field label="Maximum installments"><input type="number" min="1" value={settings.maximum_installment_count ?? 156} onChange={(event) => setValue("maximum_installment_count", event.target.value)} /></Field>
            <Field label="Default frequency"><select value={settings.default_payment_frequency || "monthly"} onChange={(event) => setValue("default_payment_frequency", event.target.value)}><option value="weekly">Weekly</option><option value="fortnightly">Every two weeks</option><option value="monthly">Monthly</option><option value="custom">Custom dates</option></select></Field>
            <Field label="First due after days"><input type="number" min="0" value={settings.default_first_due_days ?? 30} onChange={(event) => setValue("default_first_due_days", event.target.value)} /></Field>
            <Field label="Grace days"><input type="number" min="0" value={settings.default_grace_days ?? 3} onChange={(event) => setValue("default_grace_days", event.target.value)} /></Field>
            <Field label="Late charge type"><select value={settings.late_charge_type || "none"} onChange={(event) => setValue("late_charge_type", event.target.value)}><option value="none">No automatic charge</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select></Field>
            <Field label="Late charge value"><input type="number" min="0" step="0.01" value={settings.late_charge_value ?? 0} onChange={(event) => setValue("late_charge_value", event.target.value)} /></Field>
            <Field label="Late charge cap"><input type="number" min="0" step="0.01" value={settings.late_charge_cap ?? 0} onChange={(event) => setValue("late_charge_cap", event.target.value)} /></Field>
            <Field label="Delivery policy"><select value={settings.delivery_policy || "after_deposit"} onChange={(event) => setValue("delivery_policy", event.target.value)}><option value="immediate">Immediate after approval</option><option value="after_deposit">After full deposit</option><option value="after_percentage">After payment percentage</option><option value="after_full_payment">After full payment</option></select></Field>
            <Field label="Delivery threshold %"><input type="number" min="0" max="100" step="0.01" value={settings.delivery_threshold_percent ?? 20} onChange={(event) => setValue("delivery_threshold_percent", event.target.value)} /></Field>
            <Field label="Default review after missed installments"><input type="number" min="1" value={settings.default_review_missed_installments ?? 3} onChange={(event) => setValue("default_review_missed_installments", event.target.value)} /></Field>
            <Field label="Notice / cure days"><input type="number" min="1" value={settings.notice_cure_days ?? 14} onChange={(event) => setValue("notice_cure_days", event.target.value)} /></Field>
            <Field label="Complimentary services"><input type="number" min="0" value={settings.complimentary_service_count ?? 1} onChange={(event) => setValue("complimentary_service_count", event.target.value)} /></Field>
          </div><div className="finance-pro__toggles"><label><input type="checkbox" checked={Boolean(settings.allow_partial_payments)} onChange={(event) => setValue("allow_partial_payments", event.target.checked)} />Allow partial payments</label><label><input type="checkbox" checked={Boolean(settings.advance_excess_to_future)} onChange={(event) => setValue("advance_excess_to_future", event.target.checked)} />Advance payment above the period into future schedule lines</label></div></section>

          <section><div className="finance-pro__section-title"><div><p>Notifications</p><h2>Boss payment alerts and customer reminders</h2></div></div><div className="finance-pro__form-grid">
            <Field label="Boss payment-alert phone"><input value={settings.boss_payment_alert_phone || ""} onChange={(event) => setValue("boss_payment_alert_phone", event.target.value)} placeholder="024... or +233..." /></Field>
            <Field label="Reminder time"><input type="time" value={String(settings.reminder_time || "09:00").slice(0, 5)} onChange={(event) => setValue("reminder_time", event.target.value)} /></Field>
            <Field label="Due-soon days"><input value={settings.due_soon_days || "7,3,1"} onChange={(event) => setValue("due_soon_days", event.target.value)} /></Field>
            <Field label="Overdue repeat days"><input type="number" min="1" value={settings.overdue_repeat_days ?? 3} onChange={(event) => setValue("overdue_repeat_days", event.target.value)} /></Field>
            <Field label="Maximum SMS in 7 days"><input type="number" min="1" value={settings.max_sms_7_days ?? 3} onChange={(event) => setValue("max_sms_7_days", event.target.value)} /></Field>
            <Field label="Maximum SMS in 30 days"><input type="number" min="1" value={settings.max_sms_30_days ?? 8} onChange={(event) => setValue("max_sms_30_days", event.target.value)} /></Field>
            <Field label="Minimum hours between SMS"><input type="number" min="1" value={settings.minimum_hours_between_sms ?? 24} onChange={(event) => setValue("minimum_hours_between_sms", event.target.value)} /></Field>
            <Field label="Boss alert message" wide><textarea rows="3" value={settings.payment_alert_template || ""} onChange={(event) => setValue("payment_alert_template", event.target.value)} /></Field>
            <Field label="Customer reminder message" wide><textarea rows="3" value={settings.reminder_template || ""} onChange={(event) => setValue("reminder_template", event.target.value)} /></Field>
          </div><div className="finance-pro__toggles"><label><input type="checkbox" checked={Boolean(settings.boss_payment_alert_enabled)} onChange={(event) => setValue("boss_payment_alert_enabled", event.target.checked)} />Alert boss after every committed payment</label><label><input type="checkbox" checked={Boolean(settings.automatic_reminders_enabled)} onChange={(event) => setValue("automatic_reminders_enabled", event.target.checked)} />Enable automatic due and overdue reminders</label><label><input type="checkbox" checked={Boolean(settings.skip_weekends)} onChange={(event) => setValue("skip_weekends", event.target.checked)} />Skip weekends</label></div></section>

          <section><div className="finance-pro__section-title"><div><p>Legal document control</p><h2>Versioned agreement terms</h2></div><span>Official documents cannot be issued until the terms are marked approved with reviewer evidence.</span></div><div className="finance-pro__form-grid">
            <Field label="Terms version"><input value={settings.terms_version || ""} onChange={(event) => setValue("terms_version", event.target.value)} /></Field>
            <Field label="Legal review status"><select value={settings.legal_review_status || "draft"} onChange={(event) => setValue("legal_review_status", event.target.value)}><option value="draft">Draft</option><option value="reviewed">Reviewed</option><option value="approved">Approved for issue</option></select></Field>
            <Field label="Reviewed by"><input value={settings.legal_reviewed_by || ""} onChange={(event) => setValue("legal_reviewed_by", event.target.value)} /></Field>
            <Field label="Review date"><input type="date" value={settings.legal_review_date ? String(settings.legal_review_date).slice(0, 10) : ""} onChange={(event) => setValue("legal_review_date", event.target.value)} /></Field>
            <Field label="Agreement terms" wide><textarea rows="24" value={settings.agreement_terms || ""} onChange={(event) => setValue("agreement_terms", event.target.value)} /></Field>
          </div></section>

          <section className="finance-pro__save-strip"><Field label="Reason for this settings change" required wide><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Approved fortnightly schedule and boss payment alert policy" /></Field><button className="finance-pro__primary" disabled={saving} type="submit">{saving ? "Saving audited settings…" : "Save Finance Settings"}</button></section>
        </form>
      )}
    </main>
  );
}

function DocumentStudio() {
  const [accounts, setAccounts] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [agreementId, setAgreementId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [signature, setSignature] = useState({ signer_role: "buyer", signer_name: "", signer_phone: "", signature_data_url: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const [accountResponse, documentResponse] = await Promise.all([
        axiosClient.get(`${LIFECYCLE_API}/accounts`),
        axiosClient.get(DOCUMENT_API),
      ]);
      const nextAccounts = accountResponse.data?.accounts || [];
      setAccounts(nextAccounts);
      setDocuments(documentResponse.data?.documents || []);
      setAgreementId((current) => current || String(nextAccounts[0]?.agreement_id || ""));
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the Finance Document Studio."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!agreementId) {
      setSnapshot(null);
      return;
    }
    let active = true;
    axiosClient.get(`${API}/professional/agreements/${agreementId}/preview`)
      .then((response) => { if (active) setSnapshot(response.data?.snapshot || null); })
      .catch((error) => { if (active) setProblem(errorMessage(error, "Could not preview this agreement.")); });
    return () => { active = false; };
  }, [agreementId]);

  const selectedAccount = accounts.find((item) => String(item.agreement_id) === String(agreementId));
  const primaryPhoto = snapshot?.media?.find((item) => item.is_primary)?.file_url || snapshot?.agreement?.main_image_url;

  async function prepareSignature(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await imageToProtectedDataUrl(file, { signature: true });
      setSignature((current) => ({ ...current, signature_data_url: dataUrl }));
    } catch (error) {
      setProblem(error.message);
    }
  }

  async function saveSignature(event) {
    event.preventDefault();
    setWorking("signature");
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${API}/professional/agreements/${agreementId}/signatures`, signature);
      setNotice(response.data?.message || "Signature saved.");
      setSignature((current) => ({ ...current, signature_data_url: "" }));
      const preview = await axiosClient.get(`${API}/professional/agreements/${agreementId}/preview`);
      setSnapshot(preview.data?.snapshot || null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not save the signature."));
    } finally {
      setWorking("");
    }
  }

  async function issue(format) {
    setWorking(format);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${DOCUMENT_API}/issue`, {
        agreement_id: Number(agreementId),
        document_type: "installment_agreement",
        format,
      });
      const document = response.data?.document;
      setNotice(`Issued ${document?.document_number || "Finance document"}.`);
      await load();
      if (document?.id) await download(document.id, format);
    } catch (error) {
      setProblem(errorMessage(error, "Could not issue the agreement document."));
    } finally {
      setWorking("");
    }
  }

  async function download(documentId, format) {
    try {
      const response = await axiosClient.get(`${DOCUMENT_API}/${documentId}/download`, {
        params: { format },
        responseType: "blob",
      });
      const type = format === "word" ? "application/msword" : "application/pdf";
      const extension = format === "word" ? "doc" : "pdf";
      const blob = new Blob([response.data], { type });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Chalin-03-Installment-Agreement-${documentId}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setProblem(errorMessage(error, "Could not download the document."));
    }
  }

  return (
    <main className="finance-pro">
      <PageHeader eyebrow="Automatic agreement pack" title="Finance Document Studio" description="Select an approved agreement, review the complete buyer, machine, schedule and photo evidence, capture signatures, then issue a checksum-protected PDF or editable Word-compatible document." />
      <StatusMessage problem={problem} notice={notice} />
      {loading ? <div className="finance-pro__empty">Loading agreement files…</div> : null}
      {!loading ? (
        <div className="finance-pro__document-layout">
          <section className="finance-pro__document-control">
            <Field label="Agreement file"><select value={agreementId} onChange={(event) => setAgreementId(event.target.value)}><option value="">Choose agreement</option>{accounts.map((account) => <option key={account.agreement_id} value={account.agreement_id}>{account.agreement_number} — {account.customer_name} — {account.asset_name}</option>)}</select></Field>
            {selectedAccount ? <div className="finance-pro__document-summary"><strong>{selectedAccount.agreement_number}</strong><span>{selectedAccount.customer_name}</span><span>{selectedAccount.asset_code} · {selectedAccount.asset_name}</span><span>{currency(selectedAccount.total_amount)} purchase · {currency(selectedAccount.outstanding_balance)} outstanding</span></div> : null}
            <div className="finance-pro__document-actions"><button type="button" className="finance-pro__primary" disabled={!agreementId || Boolean(working)} onClick={() => issue("pdf")}>{working === "pdf" ? "Generating PDF…" : "Issue & Download PDF"}</button><button type="button" disabled={!agreementId || Boolean(working)} onClick={() => issue("word")}>{working === "word" ? "Generating Word…" : "Issue & Download Word"}</button></div>
            <form className="finance-pro__signature-form" onSubmit={saveSignature}><h3>Capture document signature</h3><Field label="Signer role"><select value={signature.signer_role} onChange={(event) => setSignature((current) => ({ ...current, signer_role: event.target.value }))}><option value="seller">Seller</option><option value="buyer">Buyer</option><option value="buyer_witness">Buyer witness</option><option value="seller_witness">Seller witness</option><option value="guarantor">Guarantor</option></select></Field><Field label="Signer name"><input value={signature.signer_name} onChange={(event) => setSignature((current) => ({ ...current, signer_name: event.target.value }))} /></Field><Field label="Phone"><input value={signature.signer_phone} onChange={(event) => setSignature((current) => ({ ...current, signer_phone: event.target.value }))} /></Field><label className="finance-pro__upload"><input type="file" accept="image/*" capture="environment" onChange={prepareSignature} />Capture / upload signature</label>{signature.signature_data_url ? <img className="finance-pro__signature-preview" src={signature.signature_data_url} alt="Prepared signature" /> : null}<button className="finance-pro__primary" disabled={!agreementId || working === "signature"} type="submit">{working === "signature" ? "Saving signature…" : "Save Signature Evidence"}</button></form>
          </section>

          <section className="finance-pro__preview">
            <div className="finance-pro__preview-brand"><strong>{snapshot?.company?.name || "CHALIN 03 COMPANY LIMITED"}</strong><span>Excavator Sale & Installment Agreement</span></div>
            {primaryPhoto ? <img className="finance-pro__preview-machine" src={primaryPhoto} alt={snapshot?.agreement?.asset_name || "Excavator"} /> : <div className="finance-pro__preview-placeholder">Machine photo will appear here.</div>}
            {snapshot ? <><div className="finance-pro__preview-grid"><div><span>Buyer</span><strong>{snapshot.agreement.kyc_customer_name || snapshot.agreement.customer_name_snapshot}</strong></div><div><span>Machine</span><strong>{snapshot.agreement.asset_code} · {snapshot.agreement.asset_name}</strong></div><div><span>Purchase price</span><strong>{currency(snapshot.agreement.total_amount)}</strong></div><div><span>Deposit</span><strong>{currency(snapshot.agreement.deposit_required)}</strong></div><div><span>Financed balance</span><strong>{currency(snapshot.agreement.financed_amount)}</strong></div><div><span>Schedule</span><strong>{snapshot.agreement.installment_count} · {label(snapshot.agreement.payment_frequency)}</strong></div></div><h3>Payment schedule</h3><div className="finance-pro__schedule-preview">{snapshot.schedule.slice(0, 8).map((row) => <div key={row.id}><span>#{row.sequence_number}</span><span>{dateLabel(row.due_date)}</span><strong>{currency(row.scheduled_amount)}</strong><em>{label(row.schedule_status)}</em></div>)}{snapshot.schedule.length > 8 ? <small>+ {snapshot.schedule.length - 8} more schedule lines in the issued document</small> : null}</div><h3>Signatures captured</h3><div className="finance-pro__signature-list">{snapshot.signatures.length ? snapshot.signatures.map((item) => <span key={item.signer_role}>{label(item.signer_role)} · {item.signer_name}</span>) : <span>No customer signatures captured yet.</span>}</div></> : null}
          </section>
        </div>
      ) : null}

      <section className="finance-pro__issued"><div className="finance-pro__section-title"><div><p>Immutable evidence</p><h2>Issued documents</h2></div></div><div className="finance-pro__issued-list">{documents.map((item) => <article key={item.id}><div><strong>{item.document_number}</strong><span>{label(item.document_type)} · {dateLabel(item.issued_at)}</span><small>{item.agreement_number} · {item.customer_name_snapshot} · {item.asset_name_snapshot}</small></div><div><button type="button" onClick={() => download(item.id, "pdf")}>PDF</button><button type="button" onClick={() => download(item.id, "word")}>Word</button></div></article>)}{!documents.length ? <div className="finance-pro__empty">No official Finance documents have been issued yet.</div> : null}</div></section>
    </main>
  );
}

function StaffWorkspace() {
  const { user } = useAuth();
  return (
    <main className="finance-pro">
      <PageHeader eyebrow="One Equipment Business login" title="Equipment Staff & Access" description="Create staff accounts in the existing worker/user administration, then assign Hire-only, Finance-only or approved dual-business roles here. Dual roles never bypass exact action permissions." actions={<EquipmentDivisionStaffManager user={user} />} />
      <section className="finance-pro__role-grid"><article><h2>Equipment Business Manager</h2><p>Works across Hire and Finance, manages the shared machine register, approves controlled commercial work and supervises staff.</p></article><article><h2>Equipment Business Accountant</h2><p>Handles authorised Hire finance and installment deposits, collections, reconciliation, statements and ownership readiness.</p></article><article><h2>Equipment Business Auditor</h2><p>Reads evidence across both divisions without creating, approving, collecting, dispatching or transferring ownership.</p></article><article><h2>Division-only staff</h2><p>Hire Officer, Dispatcher, Fleet Officer, Credit Officer, Collections Officer and other specialised roles stay inside their assigned workflow.</p></article></section>
      <section className="finance-pro__workflow-note"><strong>Security rule</strong><p>Changing a staff assignment revokes existing sessions. The employee signs in again before the new role applies, and the audit log records the previous role, new role and administrator.</p></section>
    </main>
  );
}

export default function EquipmentFinanceProfessionalPage({ mode = "machines" }) {
  if (mode === "settings") return <SettingsWorkspace />;
  if (mode === "documents") return <DocumentStudio />;
  if (mode === "staff") return <StaffWorkspace />;
  return <MachineRegister />;
}
