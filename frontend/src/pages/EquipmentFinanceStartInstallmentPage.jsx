import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { CustomerPortrait, CustomerPortraitPicker } from "../components/CustomerPortrait";
import "../styles/equipmentFinanceStartInstallment.css";

const API = "/equipment-catalogue/sales/phase-one";
const DRAFT_KEY = "chalin03.finance.start-installment.v2";

const STEPS = [
  ["customer", "Customer", "Buyer & portrait"],
  ["equipment", "Excavator", "Exact machine"],
  ["terms", "Terms", "Price & schedule"],
  ["assessment", "Assessment", "KYC & affordability"],
  ["review", "Review", "Confirm & create"],
];

function todayPlus(days) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function blankState() {
  return {
    customerMode: "existing",
    customer_id: "",
    customer: { customer_name: "", customer_type: "individual", phone: "", whatsapp_phone: "", email: "", address: "", contact_person: "" },
    asset_id: "",
    offer: { selling_price: "", deposit: "", payment_frequency: "monthly", custom_interval_days: "30", installment_count: "12", first_due_date: todayPlus(30), non_working_day_rule: "exact", notes: "" },
    kyc: { id_type: "Ghana Card", id_number: "", date_of_birth: "", nationality: "Ghana", employment_type: "", occupation: "", employer_business_name: "", business_registration_number: "", residential_address: "", work_address: "", years_at_residence: "", years_in_employment_business: "", emergency_contact_name: "", emergency_contact_phone: "", emergency_contact_relationship: "", guarantor_name: "", guarantor_phone: "", guarantor_address: "", guarantor_id_type: "Ghana Card", guarantor_id_number: "", guarantor_relationship: "", customer_consent_confirmed: false, credit_assessment_consent_confirmed: false },
    affordability: { monthly_salary_income: "", monthly_business_income: "", monthly_other_income: "", monthly_business_costs: "", monthly_household_expenses: "", existing_monthly_debt: "", assessment_notes: "" },
  };
}

function mergeDraft(saved = {}) {
  const base = blankState();
  return {
    ...base,
    ...saved,
    customer: { ...base.customer, ...(saved.customer || {}) },
    offer: { ...base.offer, ...(saved.offer || {}) },
    kyc: { ...base.kyc, ...(saved.kyc || {}) },
    affordability: { ...base.affordability, ...(saved.affordability || {}) },
  };
}

function numberValue(value) {
  const number = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateLabel(value) {
  if (!value) return "Not selected";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function readPhotoState(key) {
  try { return JSON.parse(window.sessionStorage.getItem(key) || "null"); } catch { return null; }
}

function writePhotoState(key, value) {
  try {
    if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
    else window.sessionStorage.removeItem(key);
  } catch {}
}

function Field({ label, hint, wide = false, children }) {
  return <label className={`c03-start2-field ${wide ? "is-wide" : ""}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function Card({ eyebrow, title, description, children }) {
  return <section className="c03-start2-card"><header><div><span>{eyebrow}</span><h2>{title}</h2>{description ? <p>{description}</p> : null}</div></header>{children}</section>;
}

function SchedulePreview({ preview, loading, problem }) {
  if (loading) return <div className="c03-start2-schedule c03-start2-info">Calculating exact payment dates…</div>;
  if (problem) return <div className="c03-start2-schedule c03-start2-error">{problem}</div>;
  if (!preview?.schedule?.length) return <div className="c03-start2-schedule"><strong>Live payment schedule</strong><p>Enter the commercial terms to calculate the exact payment dates.</p></div>;
  return <div className="c03-start2-schedule">
    <div className="c03-start2-schedule-head"><div><span>Live payment schedule</span><strong>{preview.schedule.length} payments</strong></div><b>{money(preview.periodic_amount)} / period</b></div>
    <div className="c03-start2-schedule-facts">
      <div><span>Financed</span><strong>{money(preview.financed_amount)}</strong></div>
      <div><span>First due</span><strong>{dateLabel(preview.first_due_date)}</strong></div>
      <div><span>Final due</span><strong>{dateLabel(preview.final_due_date)}</strong></div>
      <div><span>Final payment</span><strong>{money(preview.final_payment_amount)}</strong></div>
    </div>
    <div className="c03-start2-schedule-rows">{preview.schedule.slice(0, 6).map((row) => <div key={`${row.sequence_number}-${row.due_date}`}><span>#{row.sequence_number}</span><strong>{dateLabel(row.due_date)}</strong><b>{money(row.scheduled_amount)}</b></div>)}</div>
    {preview.schedule.length > 6 ? <small>+ {preview.schedule.length - 6} more payment dates are included in the application schedule.</small> : null}
  </div>;
}

export default function EquipmentFinanceStartInstallmentPage() {
  const { effectivePermissions = [], user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const preselectedCustomer = query.get("customer") || "";
  const preselectedAsset = query.get("asset") || "";
  const role = String(user?.role || "").toLowerCase();
  const canCreate = effectivePermissions.includes("fleet.assets.manage") || ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(role);
  const photoKey = `chalin03.finance.start-installment.photo.${preselectedCustomer || "new"}`;

  const [step, setStep] = useState(0);
  const [data, setData] = useState(() => {
    try {
      const saved = window.localStorage.getItem(DRAFT_KEY);
      return mergeDraft(saved ? JSON.parse(saved) : {});
    } catch { return blankState(); }
  });
  const [customers, setCustomers] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [machineSearch, setMachineSearch] = useState("");
  const [schedulePreview, setSchedulePreview] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleProblem, setScheduleProblem] = useState("");
  const [profilePhoto, setProfilePhoto] = useState(() => readPhotoState(photoKey));

  useEffect(() => {
    let active = true;
    axiosClient.get(`${API}/bootstrap`).then((response) => {
      if (!active) return;
      setCustomers(response.data?.customers || []);
      setMachines(response.data?.machines || []);
    }).catch((error) => { if (active) setProblem(errorMessage(error, "Could not load customers and excavators.")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const next = mergeDraft(data);
    if (preselectedCustomer) { next.customerMode = "existing"; next.customer_id = preselectedCustomer; }
    if (preselectedAsset) next.asset_id = preselectedAsset;
    setData(next);
    setProfilePhoto(readPhotoState(`chalin03.finance.start-installment.photo.${preselectedCustomer || "new"}`));
  }, [preselectedCustomer, preselectedAsset]);

  useEffect(() => {
    if (loading) return;
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  }, [data, loading]);

  const selectedCustomer = customers.find((item) => String(item.id) === String(data.customer_id));
  const selectedMachine = machines.find((item) => String(item.id) === String(data.asset_id));
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    return customers.filter((customer) => !term || [customer.customer_name, customer.phone, customer.customer_code, customer.email].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [customers, customerSearch]);
  const filteredMachines = useMemo(() => {
    const term = machineSearch.trim().toLowerCase();
    return machines.filter((machine) => {
      if (!machine.readiness?.ready || machine.sale_status !== "available" || Number(machine.active_application_count || 0) > 0) return false;
      return !term || [machine.asset_code, machine.asset_name, machine.make, machine.model, machine.serial_number, machine.chassis_number].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    });
  }, [machines, machineSearch]);
  const financedAmount = Math.max(numberValue(data.offer.selling_price) - numberValue(data.offer.deposit), 0);
  const optionalMissing = useMemo(() => [
    !data.kyc.id_number && "ID number",
    !data.kyc.employment_type && "Employment / business type",
    !data.kyc.occupation && "Occupation",
    !data.kyc.residential_address && !selectedCustomer?.address && !data.customer.address && "Address",
    numberValue(data.affordability.monthly_salary_income) + numberValue(data.affordability.monthly_business_income) + numberValue(data.affordability.monthly_other_income) <= 0 && "Income",
    !data.kyc.customer_consent_confirmed && "Customer consent",
    !data.kyc.credit_assessment_consent_confirmed && "Credit assessment consent",
    financedAmount >= 100000 && !data.kyc.guarantor_name && "Guarantor",
  ].filter(Boolean), [data, financedAmount, selectedCustomer]);

  useEffect(() => {
    const offer = data.offer;
    const valid = numberValue(offer.selling_price) > 0 && numberValue(offer.deposit) <= numberValue(offer.selling_price) && Number(offer.installment_count) > 0 && Boolean(offer.first_due_date) && (offer.payment_frequency !== "custom" || Number(offer.custom_interval_days) > 0);
    if (!valid) { setSchedulePreview(null); setScheduleProblem(""); return undefined; }
    const timer = window.setTimeout(async () => {
      setScheduleLoading(true); setScheduleProblem("");
      try { const response = await axiosClient.post(`${API}/schedule-preview`, { offer }); setSchedulePreview(response.data?.schedule || null); }
      catch (error) { setSchedulePreview(null); setScheduleProblem(errorMessage(error, "Could not calculate the exact payment dates.")); }
      finally { setScheduleLoading(false); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [data.offer]);

  useEffect(() => {
    if (!selectedMachine) return;
    setData((current) => current.offer.selling_price ? current : { ...current, offer: { ...current.offer, selling_price: String(selectedMachine.target_selling_price || "") } });
  }, [selectedMachine]);

  function update(section, field, value) { setData((current) => ({ ...current, [section]: { ...current[section], [field]: value } })); }
  function chooseCustomer(customer) { setData((current) => ({ ...current, customerMode: "existing", customer_id: String(customer.id) })); }
  function chooseMachine(machine) { setData((current) => ({ ...current, asset_id: String(machine.id), offer: { ...current.offer, selling_price: current.offer.selling_price || String(machine.target_selling_price || "") } })); }
  function setPhoto(value) { setProfilePhoto(value || null); writePhotoState(photoKey, value || null); }
  function clearDraft() { const fresh = blankState(); setData(fresh); setStep(0); setProblem(""); setNotice("The unfinished draft was cleared on this device."); setSchedulePreview(null); setProfilePhoto(null); writePhotoState(photoKey, null); window.localStorage.removeItem(DRAFT_KEY); }

  function validate(index) {
    if (!canCreate) return "Your account has view-only Finance access.";
    if (index === 0) {
      if (data.customerMode === "existing" && !data.customer_id) return "Select an existing customer or switch to Create new customer.";
      if (data.customerMode === "new" && (!data.customer.customer_name.trim() || !data.customer.phone.trim())) return "Enter the new customer name and primary phone.";
    }
    if (index === 1 && !data.asset_id) return "Select the exact excavator.";
    if (index === 2) {
      if (numberValue(data.offer.selling_price) <= 0) return "Enter the selling price.";
      if (numberValue(data.offer.deposit) > numberValue(data.offer.selling_price)) return "The deposit cannot exceed the selling price.";
      if (Number(data.offer.installment_count) < 1) return "Enter at least one installment payment.";
      if (!data.offer.first_due_date) return "Choose the first payment due date.";
      if (data.offer.payment_frequency === "custom" && Number(data.offer.custom_interval_days) < 1) return "Enter the number of days between payments.";
      if (!schedulePreview) return scheduleProblem || "Wait for the exact schedule preview.";
    }
    return "";
  }

  function next() { const issue = validate(step); if (issue) { setProblem(issue); return; } setProblem(""); setStep((current) => Math.min(current + 1, STEPS.length - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function back() { setProblem(""); setStep((current) => Math.max(current - 1, 0)); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function jump(index) { if (index <= step) { setProblem(""); setStep(index); window.scrollTo({ top: 0, behavior: "smooth" }); return; } next(); }

  async function submit() {
    for (const index of [0, 1, 2]) { const issue = validate(index); if (issue) { setStep(index); setProblem(issue); return; } }
    setSaving(true); setProblem(""); setNotice("");
    try {
      const customerAddress = data.kyc.residential_address || selectedCustomer?.address || data.customer.address;
      const payload = {
        customer_id: data.customerMode === "existing" ? data.customer_id : null,
        customer: data.customerMode === "new" ? data.customer : undefined,
        asset_id: data.asset_id,
        offer: data.offer,
        kyc: { ...data.kyc, customer_name_snapshot: selectedCustomer?.customer_name || data.customer.customer_name, customer_phone_snapshot: selectedCustomer?.phone || data.customer.phone, customer_email_snapshot: selectedCustomer?.email || data.customer.email, customer_address_snapshot: customerAddress, residential_address: customerAddress },
        affordability: data.affordability,
        ...(profilePhoto?.startsWith("data:image/") ? { customer_photo: { data_url: profilePhoto, file_name: "customer-passport-photo.jpg", mime_type: "image/jpeg" } } : {}),
      };
      const response = await axiosClient.post(`${API}/start-installment`, payload);
      window.localStorage.removeItem(DRAFT_KEY); writePhotoState(photoKey, null);
      const applicationNumber = response.data?.application?.application_number || "The installment application";
      setNotice(`${applicationNumber} was created successfully.`);
      window.setTimeout(() => navigate(response.data?.next_path || "/equipment-installment-finance/applications"), 650);
    } catch (error) { setProblem(errorMessage(error, "Could not start the installment.")); }
    finally { setSaving(false); }
  }

  const progress = Math.round((step / (STEPS.length - 1)) * 100);
  return <main className="c03-start2-page">
    <div className="c03-start2-shell">
      <header className="c03-start2-topbar">
        <div className="c03-start2-brand"><span>🏦</span><div><small>Chalin 03 · Equipment Installment Finance</small><strong>Start New Installment</strong></div></div>
        <nav><Link to="/equipment-installment-finance">Finance Home</Link><Link to="/equipment-installment-finance/applications?stage=customer-portfolios">Customer Profiles</Link><button type="button" onClick={clearDraft}>Clear draft</button></nav>
      </header>

      <section className="c03-start2-hero"><div><span>NEW TRANSACTION WORKSPACE</span><h1>Build the installment clearly, one decision at a time.</h1><p>Choose the buyer, connect the exact excavator, set commercial terms, complete useful assessment details and review everything before creating the application.</p></div><aside><small>Progress</small><strong>{progress}%</strong><span>Step {step + 1} of {STEPS.length}</span><div><i style={{ width: `${progress}%` }} /></div></aside></section>

      <nav className="c03-start2-steps" aria-label="Installment creation steps">{STEPS.map(([key, label, hint], index) => <button key={key} type="button" className={`${index === step ? "is-current" : ""} ${index < step ? "is-complete" : ""}`} onClick={() => jump(index)}><span>{index < step ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{hint}</small></div></button>)}</nav>
      {problem ? <div className="c03-start2-alert c03-start2-alert--error" role="alert">{problem}</div> : null}
      {notice ? <div className="c03-start2-alert c03-start2-alert--success" role="status">{notice}</div> : null}
      {!canCreate ? <div className="c03-start2-alert c03-start2-alert--warning">This account can view Finance but cannot create a new installment.</div> : null}

      {loading ? <div className="c03-start2-loading"><strong>Preparing the transaction workspace…</strong><span>Loading customers, available excavators and the local draft environment.</span></div> : null}

      {!loading && step === 0 ? <Card eyebrow="Step 1 · Customer" title="Who is purchasing the excavator?" description="Start with the customer record. Existing customers keep their history connected across Finance.">
        <div className="c03-start2-mode"><button type="button" className={data.customerMode === "existing" ? "is-active" : ""} onClick={() => setData((current) => ({ ...current, customerMode: "existing", customer_id: "" }))}>Existing customer</button><button type="button" className={data.customerMode === "new" ? "is-active" : ""} onClick={() => setData((current) => ({ ...current, customerMode: "new", customer_id: "" }))}>Create new customer</button></div>
        {data.customerMode === "existing" ? <><Field label="Search customer" hint={`${filteredCustomers.length} customer${filteredCustomers.length === 1 ? "" : "s"} available`} wide><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Name, phone, customer code or email" autoComplete="off" /></Field><div className="c03-start2-customer-grid">{filteredCustomers.map((customer) => <button key={customer.id} type="button" className={String(data.customer_id) === String(customer.id) ? "is-selected" : ""} onClick={() => chooseCustomer(customer)}><CustomerPortrait customerId={customer.id} name={customer.customer_name} size="small" /><div><strong>{customer.customer_name}</strong><small>{customer.phone || "No phone"}</small><em>{customer.customer_code || "No code"}</em></div>{String(data.customer_id) === String(customer.id) ? <b>Selected</b> : null}</button>)}</div></> : <div className="c03-start2-grid c03-start2-grid--2"><Field label="Legal / registered name"><input value={data.customer.customer_name} onChange={(event) => update("customer", "customer_name", event.target.value)} /></Field><Field label="Customer type"><select value={data.customer.customer_type} onChange={(event) => update("customer", "customer_type", event.target.value)}><option value="individual">Individual</option><option value="company">Registered company</option><option value="contractor">Contractor / sole business</option><option value="government">Government institution</option></select></Field><Field label="Primary phone"><input inputMode="tel" value={data.customer.phone} onChange={(event) => update("customer", "phone", event.target.value)} /></Field><Field label="WhatsApp / alternative phone"><input inputMode="tel" value={data.customer.whatsapp_phone} onChange={(event) => update("customer", "whatsapp_phone", event.target.value)} /></Field><Field label="Email"><input type="email" value={data.customer.email} onChange={(event) => update("customer", "email", event.target.value)} /></Field><Field label="Authorised representative"><input value={data.customer.contact_person} onChange={(event) => update("customer", "contact_person", event.target.value)} /></Field><Field label="Correspondence address" wide><textarea rows="3" value={data.customer.address} onChange={(event) => update("customer", "address", event.target.value)} /></Field></div>}
        {(selectedCustomer || data.customerMode === "new") ? <div className="c03-start2-photo-card"><div><span>Customer identity photo</span><h3>{selectedCustomer?.customer_name || data.customer.customer_name || "New customer"}</h3><p>Optional. Add a clear portrait only when you have one. It will be attached to this installment's customer document record; it will not appear on unrelated customers or documents.</p></div><div className="c03-start2-photo-editor">{selectedCustomer ? <CustomerPortrait customerId={selectedCustomer.id} name={selectedCustomer.customer_name} src={profilePhoto || ""} size="medium" /> : <CustomerPortrait src={profilePhoto || ""} name={data.customer.customer_name || "Customer"} size="medium" />}<CustomerPortraitPicker value={profilePhoto || ""} name={selectedCustomer?.customer_name || data.customer.customer_name || "Customer"} onChange={setPhoto} compact /></div></div> : <div className="c03-start2-photo-empty"><strong>Select the customer first.</strong><span>The optional customer portrait control will appear here and will be tied to the selected transaction.</span></div>}
      </Card> : null}

      {!loading && step === 1 ? <Card eyebrow="Step 2 · Excavator" title="Which exact excavator is being financed?" description="Only sale-ready machines without an active installment application are offered for selection."><Field label="Search available excavators" hint={`${filteredMachines.length} machine${filteredMachines.length === 1 ? "" : "s"} available`} wide><input value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} placeholder="Asset code, make, model, serial or chassis number" autoComplete="off" /></Field><div className="c03-start2-machine-grid">{filteredMachines.map((machine) => <article key={machine.id} className={String(data.asset_id) === String(machine.id) ? "is-selected" : ""}><div className="c03-start2-machine-image">{machine.main_image_url ? <img src={machine.main_image_url} alt={machine.asset_name} /> : <span>🚜</span>}</div><div className="c03-start2-machine-body"><small>{machine.asset_code}</small><h3>{machine.asset_name}</h3><p>{[machine.make, machine.model, machine.model_year].filter(Boolean).join(" · ") || "Equipment details not recorded"}</p><div><span>Target price<strong>{money(machine.target_selling_price)}</strong></span><span>Serial<strong>{machine.serial_number || "Not recorded"}</strong></span></div><button type="button" onClick={() => chooseMachine(machine)}>{String(data.asset_id) === String(machine.id) ? "✓ Selected" : "Select excavator"}</button></div></article>)}</div>{!filteredMachines.length ? <div className="c03-start2-empty">No sale-ready excavators match this search.</div> : null}</Card> : null}

      {!loading && step === 2 ? <Card eyebrow="Step 3 · Payment terms" title="Build the commercial terms" description="These values drive the authoritative schedule calculation for the application."><div className="c03-start2-terms"><div className="c03-start2-grid c03-start2-grid--2"><Field label="Selling price"><input inputMode="decimal" value={data.offer.selling_price} onChange={(event) => update("offer", "selling_price", event.target.value.replace(/[^0-9.,]/g, ""))} /><strong className="c03-start2-money">{money(data.offer.selling_price)}</strong></Field><Field label="Opening deposit"><input inputMode="decimal" value={data.offer.deposit} onChange={(event) => update("offer", "deposit", event.target.value.replace(/[^0-9.,]/g, ""))} /><strong className="c03-start2-money">{money(data.offer.deposit)}</strong></Field><Field label="Payment frequency"><select value={data.offer.payment_frequency} onChange={(event) => update("offer", "payment_frequency", event.target.value)}><option value="weekly">Weekly · 7 days</option><option value="fortnightly">Fortnightly · 14 days</option><option value="monthly">Monthly</option><option value="custom">Custom interval</option></select></Field>{data.offer.payment_frequency === "custom" ? <Field label="Days between payments"><input type="number" min="1" max="365" value={data.offer.custom_interval_days} onChange={(event) => update("offer", "custom_interval_days", event.target.value)} /></Field> : null}<Field label="Number of payments"><input type="number" min="1" max="520" value={data.offer.installment_count} onChange={(event) => update("offer", "installment_count", event.target.value)} /></Field><Field label="First payment due date"><input type="date" value={data.offer.first_due_date} onChange={(event) => update("offer", "first_due_date", event.target.value)} /></Field><Field label="Weekend handling"><select value={data.offer.non_working_day_rule} onChange={(event) => update("offer", "non_working_day_rule", event.target.value)}><option value="exact">Keep exact date</option><option value="next_weekday">Move to next weekday</option><option value="previous_weekday">Move to previous weekday</option></select></Field><Field label="Internal note" wide><textarea rows="3" value={data.offer.notes} onChange={(event) => update("offer", "notes", event.target.value)} /></Field></div><aside className="c03-start2-deal"><span>Deal summary</span><strong>{money(data.offer.selling_price)}</strong><small>Selling price</small><div><b>{money(data.offer.deposit)}</b><span>Opening deposit</span></div><div><b>{money(financedAmount)}</b><span>Financed amount</span></div><div><b>{selectedMachine?.asset_code || "Not selected"}</b><span>Excavator</span></div></aside></div><SchedulePreview preview={schedulePreview} loading={scheduleLoading} problem={scheduleProblem} /></Card> : null}

      {!loading && step === 3 ? <Card eyebrow="Step 4 · Optional assessment" title="Complete useful customer assessment details" description="These fields can be filled now or completed later on the application before submission and approval."><div className="c03-start2-optional"><strong>{optionalMissing.length} optional items still open</strong><span>{optionalMissing.length ? optionalMissing.join(" · ") : "The assessment is well populated."}</span></div><h3>Identity, residence and work</h3><div className="c03-start2-grid c03-start2-grid--2"><Field label="ID type"><select value={data.kyc.id_type} onChange={(event) => update("kyc", "id_type", event.target.value)}><option>Ghana Card</option><option>Non-Citizen Ghana Card</option><option>Passport</option><option>Driver Licence</option><option>Other</option></select></Field><Field label="ID number"><input value={data.kyc.id_number} onChange={(event) => update("kyc", "id_number", event.target.value)} /></Field><Field label="Date of birth"><input type="date" value={data.kyc.date_of_birth} onChange={(event) => update("kyc", "date_of_birth", event.target.value)} /></Field><Field label="Nationality"><input value={data.kyc.nationality} onChange={(event) => update("kyc", "nationality", event.target.value)} /></Field><Field label="Employment / business type"><select value={data.kyc.employment_type} onChange={(event) => update("kyc", "employment_type", event.target.value)}><option value="">Not recorded yet</option><option value="salaried">Salaried</option><option value="self_employed">Self-employed</option><option value="contractor">Contractor</option><option value="pensioner">Pensioner</option><option value="farmer">Farmer</option><option value="other">Other</option></select></Field><Field label="Occupation / main activity"><input value={data.kyc.occupation} onChange={(event) => update("kyc", "occupation", event.target.value)} /></Field><Field label="Employer / business name"><input value={data.kyc.employer_business_name} onChange={(event) => update("kyc", "employer_business_name", event.target.value)} /></Field><Field label="Business registration number"><input value={data.kyc.business_registration_number} onChange={(event) => update("kyc", "business_registration_number", event.target.value)} /></Field><Field label="Residential address" wide><textarea rows="3" value={data.kyc.residential_address} onChange={(event) => update("kyc", "residential_address", event.target.value)} /></Field><Field label="Work / business address" wide><textarea rows="3" value={data.kyc.work_address} onChange={(event) => update("kyc", "work_address", event.target.value)} /></Field></div><h3>Affordability</h3><div className="c03-start2-grid c03-start2-grid--3">{[["Monthly salary income","monthly_salary_income"],["Monthly business income","monthly_business_income"],["Other monthly income","monthly_other_income"],["Business operating costs","monthly_business_costs"],["Household expenses","monthly_household_expenses"],["Existing monthly debt","existing_monthly_debt"]].map(([label, field]) => <Field key={field} label={label}><input inputMode="decimal" value={data.affordability[field]} onChange={(event) => update("affordability", field, event.target.value.replace(/[^0-9.,]/g, ""))} /><strong className="c03-start2-money">{money(data.affordability[field])}</strong></Field>)}<Field label="Assessment notes" wide><textarea rows="3" value={data.affordability.assessment_notes} onChange={(event) => update("affordability", "assessment_notes", event.target.value)} /></Field></div><h3>Emergency contact & guarantor</h3><div className="c03-start2-grid c03-start2-grid--2"><Field label="Emergency contact name"><input value={data.kyc.emergency_contact_name} onChange={(event) => update("kyc", "emergency_contact_name", event.target.value)} /></Field><Field label="Emergency contact phone"><input inputMode="tel" value={data.kyc.emergency_contact_phone} onChange={(event) => update("kyc", "emergency_contact_phone", event.target.value)} /></Field><Field label="Relationship"><input value={data.kyc.emergency_contact_relationship} onChange={(event) => update("kyc", "emergency_contact_relationship", event.target.value)} /></Field><Field label="Guarantor name"><input value={data.kyc.guarantor_name} onChange={(event) => update("kyc", "guarantor_name", event.target.value)} /></Field><Field label="Guarantor phone"><input inputMode="tel" value={data.kyc.guarantor_phone} onChange={(event) => update("kyc", "guarantor_phone", event.target.value)} /></Field><Field label="Guarantor ID number"><input value={data.kyc.guarantor_id_number} onChange={(event) => update("kyc", "guarantor_id_number", event.target.value)} /></Field><Field label="Guarantor address" wide><textarea rows="2" value={data.kyc.guarantor_address} onChange={(event) => update("kyc", "guarantor_address", event.target.value)} /></Field></div><div className="c03-start2-checks"><label><input type="checkbox" checked={data.kyc.customer_consent_confirmed} onChange={(event) => update("kyc", "customer_consent_confirmed", event.target.checked)} /><span><strong>Customer information consent confirmed</strong><small>Permission to collect and use information for the installment application.</small></span></label><label><input type="checkbox" checked={data.kyc.credit_assessment_consent_confirmed} onChange={(event) => update("kyc", "credit_assessment_consent_confirmed", event.target.checked)} /><span><strong>Credit assessment consent confirmed</strong><small>Permission to assess the proposed installment.</small></span></label></div></Card> : null}

      {!loading && step === 4 ? <Card eyebrow="Step 5 · Final review" title="Confirm the deal before creating the application" description="The draft will use the exact customer, machine, commercial terms and schedule shown below."><div className="c03-start2-review"><article><span>Customer</span><strong>{selectedCustomer?.customer_name || data.customer.customer_name || "Not selected"}</strong><small>{selectedCustomer?.phone || data.customer.phone || "No phone"}</small></article><article><span>Customer photo</span>{profilePhoto ? <CustomerPortrait src={profilePhoto} name={selectedCustomer?.customer_name || data.customer.customer_name || "Customer"} size="small" /> : <strong>Not added</strong>}</article><article><span>Excavator</span><strong>{selectedMachine?.asset_code || "Not selected"}</strong><small>{selectedMachine?.asset_name || "No machine selected"}</small></article><article><span>Selling price</span><strong>{money(data.offer.selling_price)}</strong></article><article><span>Deposit</span><strong>{money(data.offer.deposit)}</strong></article><article><span>Financed amount</span><strong>{money(financedAmount)}</strong></article><article><span>Payments</span><strong>{data.offer.installment_count}</strong><small>{data.offer.payment_frequency}</small></article><article><span>First due</span><strong>{dateLabel(data.offer.first_due_date)}</strong></article></div><SchedulePreview preview={schedulePreview} loading={scheduleLoading} problem={scheduleProblem} />{optionalMissing.length ? <div className="c03-start2-review-note"><strong>Optional assessment still open</strong><span>{optionalMissing.join(" · ")}</span></div> : <div className="c03-start2-review-note is-complete"><strong>Assessment well prepared</strong><span>No optional gaps are currently flagged.</span></div>}</Card> : null}

      <footer className="c03-start2-footer"><div><span>{STEPS[step][1]}</span><strong>{STEPS[step][2]}</strong></div><div>{step > 0 ? <button type="button" onClick={back}>Back</button> : null}{step < STEPS.length - 1 ? <button type="button" className="is-primary" onClick={next} disabled={!canCreate}>Continue to {STEPS[step + 1][1]}</button> : <button type="button" className="is-primary" onClick={submit} disabled={!canCreate || saving}>{saving ? "Creating…" : "Create installment application"}</button>}</div></footer>
    </div>
  </main>;
}
