import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinanceStartNew.css";

const API = "/equipment-catalogue/sales/phase-one";
const DRAFT_KEY = "chalin03.finance.start-installment.v2";

const STEPS = [
  { key: "customer", label: "Customer", title: "Choose the customer" },
  { key: "equipment", label: "Excavator", title: "Choose the exact excavator" },
  { key: "terms", label: "Terms", title: "Build the payment plan" },
  { key: "assessment", label: "Assessment", title: "Add customer assessment" },
  { key: "review", label: "Review", title: "Review and create" },
];

function todayPlus(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function blankState() {
  return {
    customerMode: "existing",
    customer_id: "",
    customer: {
      customer_name: "",
      customer_type: "individual",
      phone: "",
      whatsapp_phone: "",
      email: "",
      address: "",
      contact_person: "",
    },
    asset_id: "",
    offer: {
      selling_price: "",
      deposit: "",
      payment_frequency: "monthly",
      custom_interval_days: "30",
      installment_count: "12",
      first_due_date: todayPlus(30),
      non_working_day_rule: "exact",
      notes: "",
    },
    kyc: {
      id_type: "Ghana Card",
      id_number: "",
      date_of_birth: "",
      nationality: "Ghana",
      employment_type: "",
      occupation: "",
      employer_business_name: "",
      business_registration_number: "",
      residential_address: "",
      work_address: "",
      years_at_residence: "",
      years_in_employment_business: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      emergency_contact_relationship: "",
      guarantor_name: "",
      guarantor_phone: "",
      guarantor_address: "",
      guarantor_id_type: "Ghana Card",
      guarantor_id_number: "",
      guarantor_relationship: "",
      customer_consent_confirmed: false,
      credit_assessment_consent_confirmed: false,
    },
    affordability: {
      monthly_salary_income: "",
      monthly_business_income: "",
      monthly_other_income: "",
      monthly_business_costs: "",
      monthly_household_expenses: "",
      existing_monthly_debt: "",
      assessment_notes: "",
    },
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

function readDraft() {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? mergeDraft(JSON.parse(raw)) : blankState();
  } catch {
    return blankState();
  }
}

function numberValue(value) {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "Not selected";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleDateString("en-GH", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`c03-start-field ${className}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function MoneyField({ label, value, onChange, hint }) {
  return (
    <Field label={label} hint={hint}>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, ""))}
        placeholder="0.00"
      />
      <strong className="c03-start-money">{money(value)}</strong>
    </Field>
  );
}

function SectionCard({ eyebrow, title, description, children, className = "" }) {
  return (
    <section className={`c03-start-card ${className}`}>
      <header className="c03-start-card__header">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function SchedulePreview({ preview, loading, problem }) {
  return (
    <div className="c03-start-schedule">
      <div className="c03-start-schedule__head">
        <div>
          <span>Live schedule calculation</span>
          <strong>
            {loading ? "Calculating…" : preview?.schedule?.length ? `${preview.schedule.length} payments` : "Waiting for valid terms"}
          </strong>
        </div>
        {preview?.periodic_amount ? <b>{money(preview.periodic_amount)} / period</b> : null}
      </div>
      {problem ? <div className="c03-start-inline-error">{problem}</div> : null}
      {preview?.schedule?.length ? (
        <>
          <div className="c03-start-schedule__facts">
            <div><span>Financed</span><strong>{money(preview.financed_amount)}</strong></div>
            <div><span>First due</span><strong>{dateLabel(preview.first_due_date)}</strong></div>
            <div><span>Final due</span><strong>{dateLabel(preview.final_due_date)}</strong></div>
            <div><span>Final payment</span><strong>{money(preview.final_payment_amount)}</strong></div>
          </div>
          <div className="c03-start-schedule__rows">
            {preview.schedule.slice(0, 6).map((row) => (
              <div key={`${row.sequence_number}-${row.due_date}`}>
                <span>#{row.sequence_number}</span>
                <strong>{dateLabel(row.due_date)}</strong>
                <b>{money(row.scheduled_amount)}</b>
              </div>
            ))}
          </div>
          {preview.schedule.length > 6 ? <small className="c03-start-schedule__more">+ {preview.schedule.length - 6} more payment dates</small> : null}
        </>
      ) : (
        <p className="c03-start-muted">Enter valid price, deposit, frequency, number of payments and first due date to see the exact schedule here.</p>
      )}
    </div>
  );
}

export default function EquipmentFinanceStartWizardPage() {
  const { effectivePermissions = [], user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const preselectedCustomer = query.get("customer") || "";
  const preselectedAsset = query.get("asset") || "";
  const role = String(user?.role || "").toLowerCase();
  const canCreate = effectivePermissions.includes("fleet.assets.manage") || ["system_administrator", "super_admin", "admin", "administrator"].includes(role);

  const [step, setStep] = useState(0);
  const [data, setData] = useState(() => {
    const saved = readDraft();
    return {
      ...saved,
      ...(preselectedCustomer ? { customerMode: "existing", customer_id: preselectedCustomer } : {}),
      ...(preselectedAsset ? { asset_id: preselectedAsset } : {}),
    };
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

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setProblem("");
      try {
        const response = await axiosClient.get(`${API}/bootstrap`);
        if (!active) return;
        setCustomers(response.data?.customers || []);
        setMachines(response.data?.machines || []);
      } catch (error) {
        if (active) setProblem(errorMessage(error, "Could not prepare the installment workspace."));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loading) return;
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent("chalin03:finance-draft-change", { detail: { payload: data } }));
  }, [data, loading]);

  const selectedCustomer = customers.find((customer) => String(customer.id) === String(data.customer_id));
  const selectedMachine = machines.find((machine) => String(machine.id) === String(data.asset_id));

  useEffect(() => {
    if (!selectedMachine) return;
    setData((current) => current.offer.selling_price ? current : { ...current, offer: { ...current.offer, selling_price: String(selectedMachine.target_selling_price || "") } });
  }, [selectedMachine]);

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) => [customer.customer_name, customer.phone, customer.customer_code, customer.email].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)));
  }, [customerSearch, customers]);

  const filteredMachines = useMemo(() => {
    const term = machineSearch.trim().toLowerCase();
    return machines.filter((machine) => {
      if (!machine.readiness?.ready || machine.sale_status !== "available") return false;
      if (Number(machine.active_application_count || 0) > 0) return false;
      if (!term) return true;
      return [machine.asset_code, machine.asset_name, machine.make, machine.model, machine.serial_number, machine.chassis_number].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    });
  }, [machineSearch, machines]);

  const financedAmount = Math.max(numberValue(data.offer.selling_price) - numberValue(data.offer.deposit), 0);
  const optionalMissing = useMemo(() => [
    !data.kyc.id_number && "Customer ID",
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
    if (!valid) {
      setSchedulePreview(null);
      setScheduleProblem("");
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setScheduleLoading(true);
      setScheduleProblem("");
      try {
        const response = await axiosClient.post(`${API}/schedule-preview`, { offer });
        setSchedulePreview(response.data?.schedule || null);
      } catch (error) {
        setSchedulePreview(null);
        setScheduleProblem(errorMessage(error, "Could not calculate the exact payment dates."));
      } finally {
        setScheduleLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [data.offer]);

  function updateSection(section, field, value) {
    setData((current) => ({ ...current, [section]: { ...current[section], [field]: value } }));
  }

  function clearDraft() {
    const fresh = blankState();
    setData(fresh);
    setStep(0);
    setSchedulePreview(null);
    setProblem("");
    setNotice("New installment draft started.");
    window.localStorage.removeItem(DRAFT_KEY);
    window.dispatchEvent(new CustomEvent("chalin03:finance-draft-change", { detail: { payload: null } }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function chooseMachine(machine) {
    setData((current) => ({ ...current, asset_id: String(machine.id), offer: { ...current.offer, selling_price: current.offer.selling_price || String(machine.target_selling_price || "") } }));
  }

  function validate(index) {
    if (!canCreate) return "Your account can view Finance but cannot create a new installment.";
    if (index === 0) {
      if (data.customerMode === "existing" && !data.customer_id) return "Select an existing customer or switch to create a new customer.";
      if (data.customerMode === "new" && (!data.customer.customer_name.trim() || !data.customer.phone.trim())) return "Enter the new customer's name and primary phone.";
    }
    if (index === 1 && !data.asset_id) return "Select the exact excavator before continuing.";
    if (index === 2) {
      if (numberValue(data.offer.selling_price) <= 0) return "Enter the selling price.";
      if (numberValue(data.offer.deposit) > numberValue(data.offer.selling_price)) return "The deposit cannot exceed the selling price.";
      if (Number(data.offer.installment_count) < 1) return "Enter at least one installment payment.";
      if (!data.offer.first_due_date) return "Choose the first payment date.";
      if (data.offer.payment_frequency === "custom" && Number(data.offer.custom_interval_days) < 1) return "Enter the number of days between payments.";
      if (!schedulePreview) return scheduleProblem || "Wait for the schedule preview to finish calculating.";
    }
    return "";
  }

  function goTo(index) {
    if (index === step) return;
    if (index < step) {
      setProblem("");
      setStep(index);
    } else {
      const issue = validate(step);
      if (issue) {
        setProblem(issue);
        return;
      }
      setProblem("");
      setStep(index);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() { goTo(Math.min(step + 1, STEPS.length - 1)); }
  function back() { setProblem(""); setStep((current) => Math.max(current - 1, 0)); window.scrollTo({ top: 0, behavior: "smooth" }); }

  async function submit() {
    for (const index of [0, 1, 2]) {
      const issue = validate(index);
      if (issue) {
        setStep(index);
        setProblem(issue);
        return;
      }
    }
    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const customerAddress = data.kyc.residential_address || selectedCustomer?.address || data.customer.address;
      const response = await axiosClient.post(`${API}/start-installment`, {
        customer_id: data.customerMode === "existing" ? data.customer_id : null,
        customer: data.customerMode === "new" ? data.customer : undefined,
        asset_id: data.asset_id,
        offer: data.offer,
        kyc: {
          ...data.kyc,
          customer_name_snapshot: selectedCustomer?.customer_name || data.customer.customer_name,
          customer_phone_snapshot: selectedCustomer?.phone || data.customer.phone,
          customer_email_snapshot: selectedCustomer?.email || data.customer.email,
          customer_address_snapshot: customerAddress,
          residential_address: customerAddress,
        },
        affordability: data.affordability,
      });
      window.localStorage.removeItem(DRAFT_KEY);
      window.dispatchEvent(new CustomEvent("chalin03:finance-draft-change", { detail: { payload: null } }));
      const applicationNumber = response.data?.application?.application_number || "The draft";
      setNotice(`${applicationNumber} was created successfully.`);
      window.setTimeout(() => navigate(response.data?.next_path || "/equipment-installment-finance/applications"), 600);
    } catch (error) {
      setProblem(errorMessage(error, "Could not start the installment."));
    } finally {
      setSaving(false);
    }
  }

  const progress = Math.round((step / (STEPS.length - 1)) * 100);

  return (
    <main className="c03-start-page">
      <div className="c03-start-shell">
        <header className="c03-start-header">
          <div className="c03-start-brandline"><span className="c03-start-logo">🏦</span><div><small>Chalin 03 · Equipment Installment Finance</small><strong>Start New Installment</strong></div></div>
          <div className="c03-start-header-actions"><Link to="/equipment-installment-finance">Finance Home</Link><Link to="/equipment-installment-finance/applications?stage=customer-portfolios">Customer Profiles</Link><button type="button" onClick={clearDraft}>Clear draft</button></div>
        </header>

        <section className="c03-start-hero">
          <div><span className="c03-start-kicker">New transaction workspace</span><h1>Build a new excavator installment from customer to draft.</h1><p>Select the customer, reserve the exact machine, set the commercial terms and verify the payment schedule before creating the application.</p></div>
          <aside className="c03-start-hero-card"><span>Progress</span><strong>{progress}%</strong><small>Step {step + 1} of {STEPS.length}</small><div><i style={{ width: `${progress}%` }} /></div></aside>
        </section>

        <nav className="c03-start-stepbar" aria-label="Installment creation steps">
          {STEPS.map((item, index) => <button type="button" key={item.key} className={`${index === step ? "is-current" : ""} ${index < step ? "is-complete" : ""}`} onClick={() => goTo(index)}><span>{index < step ? "✓" : index + 1}</span><div><strong>{item.label}</strong><small>{item.title}</small></div></button>)}
        </nav>

        {problem ? <div className="c03-start-alert c03-start-alert--error" role="alert">{problem}</div> : null}
        {notice ? <div className="c03-start-alert c03-start-alert--success" role="status">{notice}</div> : null}
        {!canCreate ? <div className="c03-start-alert c03-start-alert--warning">This account has view-only Finance access. Creation controls are disabled.</div> : null}

        {loading ? <section className="c03-start-loading"><strong>Preparing your Finance workspace…</strong><span>Loading customers, available excavators and the draft environment.</span></section> : null}

        {!loading && step === 0 ? <SectionCard eyebrow="Step 1 · Customer" title="Who is purchasing the excavator?" description="Start with the customer record. Existing customers are preferred so history stays connected.">
          <div className="c03-start-mode-tabs"><button type="button" className={data.customerMode === "existing" ? "is-active" : ""} onClick={() => setData((current) => ({ ...current, customerMode: "existing", customer_id: "" }))}>Existing customer</button><button type="button" className={data.customerMode === "new" ? "is-active" : ""} onClick={() => setData((current) => ({ ...current, customerMode: "new", customer_id: "" }))}>Create new customer</button></div>
          {data.customerMode === "existing" ? <><Field label="Search customers" hint={`${filteredCustomers.length} customer${filteredCustomers.length === 1 ? "" : "s"} available`} className="c03-start-field--wide"><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Name, phone, customer code or email" autoComplete="off" /></Field><div className="c03-start-customer-grid">{filteredCustomers.map((customer) => <button type="button" key={customer.id} className={String(data.customer_id) === String(customer.id) ? "is-selected" : ""} onClick={() => setData((current) => ({ ...current, customer_id: String(customer.id) }))}><span>{String(customer.customer_name || "Customer").slice(0, 1).toUpperCase()}</span><div><strong>{customer.customer_name}</strong><small>{customer.phone || "No phone"}</small><em>{customer.customer_code || "No code"}</em></div>{String(data.customer_id) === String(customer.id) ? <b>Selected</b> : null}</button>)}</div>{!filteredCustomers.length ? <div className="c03-start-empty">No customer matches this search.</div> : null}</> : <div className="c03-start-grid c03-start-grid--2"><Field label="Legal / registered name"><input value={data.customer.customer_name} onChange={(event) => updateSection("customer", "customer_name", event.target.value)} /></Field><Field label="Customer type"><select value={data.customer.customer_type} onChange={(event) => updateSection("customer", "customer_type", event.target.value)}><option value="individual">Individual</option><option value="company">Registered company</option><option value="contractor">Contractor / sole business</option><option value="government">Government institution</option></select></Field><Field label="Primary phone"><input inputMode="tel" value={data.customer.phone} onChange={(event) => updateSection("customer", "phone", event.target.value)} /></Field><Field label="WhatsApp / alternative phone"><input inputMode="tel" value={data.customer.whatsapp_phone} onChange={(event) => updateSection("customer", "whatsapp_phone", event.target.value)} /></Field><Field label="Email"><input type="email" value={data.customer.email} onChange={(event) => updateSection("customer", "email", event.target.value)} /></Field><Field label="Authorised representative"><input value={data.customer.contact_person} onChange={(event) => updateSection("customer", "contact_person", event.target.value)} /></Field><Field label="Correspondence address" className="c03-start-field--wide"><textarea rows="3" value={data.customer.address} onChange={(event) => updateSection("customer", "address", event.target.value)} /></Field></div>}
          {selectedCustomer ? <div className="c03-start-selected-summary"><span>Customer selected</span><strong>{selectedCustomer.customer_name}</strong><small>{selectedCustomer.phone || "No phone recorded"} · {selectedCustomer.customer_code || "No code"}</small><Link to={`/equipment-installment-finance/applications?stage=customer-portfolios&customer=${selectedCustomer.id}`}>Open customer profile</Link></div> : null}
        </SectionCard> : null}

        {!loading && step === 1 ? <SectionCard eyebrow="Step 2 · Excavator" title="Which exact excavator is being financed?" description="Only sale-ready machines with no active installment application are shown."><Field label="Search available excavators" hint={`${filteredMachines.length} machine${filteredMachines.length === 1 ? "" : "s"} available`} className="c03-start-field--wide"><input value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} placeholder="Asset code, make, model, serial or chassis number" autoComplete="off" /></Field><div className="c03-start-machine-grid">{filteredMachines.map((machine) => <article key={machine.id} className={String(data.asset_id) === String(machine.id) ? "is-selected" : ""}><div className="c03-start-machine-image">{machine.main_image_url ? <img src={machine.main_image_url} alt={machine.asset_name} /> : <span>🚜</span>}</div><div className="c03-start-machine-body"><small>{machine.asset_code}</small><h3>{machine.asset_name}</h3><p>{[machine.make, machine.model, machine.model_year].filter(Boolean).join(" · ") || "Equipment details not recorded"}</p><div className="c03-start-machine-facts"><span>Target price<strong>{money(machine.target_selling_price)}</strong></span><span>Serial<strong>{machine.serial_number || "Not recorded"}</strong></span></div><button type="button" onClick={() => chooseMachine(machine)}>{String(data.asset_id) === String(machine.id) ? "✓ Selected" : "Select excavator"}</button></div></article>)}</div>{!filteredMachines.length ? <div className="c03-start-empty">No sale-ready excavators match this search.</div> : null}</SectionCard> : null}

        {!loading && step === 2 ? <SectionCard eyebrow="Step 3 · Payment terms" title="Build the commercial terms" description="The live schedule below is calculated from these exact values."><div className="c03-start-terms-layout"><div className="c03-start-grid c03-start-grid--2"><MoneyField label="Selling price" value={data.offer.selling_price} onChange={(value) => updateSection("offer", "selling_price", value)} /><MoneyField label="Opening deposit" value={data.offer.deposit} onChange={(value) => updateSection("offer", "deposit", value)} /><Field label="Payment frequency"><select value={data.offer.payment_frequency} onChange={(event) => updateSection("offer", "payment_frequency", event.target.value)}><option value="weekly">Weekly · every 7 days</option><option value="fortnightly">Fortnightly · every 14 days</option><option value="monthly">Monthly</option><option value="custom">Custom interval</option></select></Field>{data.offer.payment_frequency === "custom" ? <Field label="Days between payments"><input type="number" min="1" max="365" value={data.offer.custom_interval_days} onChange={(event) => updateSection("offer", "custom_interval_days", event.target.value)} /></Field> : null}<Field label="Number of payments"><input type="number" min="1" max="520" value={data.offer.installment_count} onChange={(event) => updateSection("offer", "installment_count", event.target.value)} /></Field><Field label="First payment due date"><input type="date" value={data.offer.first_due_date} onChange={(event) => updateSection("offer", "first_due_date", event.target.value)} /></Field><Field label="Weekend handling"><select value={data.offer.non_working_day_rule} onChange={(event) => updateSection("offer", "non_working_day_rule", event.target.value)}><option value="exact">Keep exact date</option><option value="next_weekday">Move to next weekday</option><option value="previous_weekday">Move to previous weekday</option></select></Field><Field label="Internal note" className="c03-start-field--wide"><textarea rows="3" value={data.offer.notes} onChange={(event) => updateSection("offer", "notes", event.target.value)} placeholder="Optional note for the application file" /></Field></div><aside className="c03-start-deal-summary"><span>Deal summary</span><strong>{money(data.offer.selling_price)}</strong><small>Selling price</small><div><b>{money(data.offer.deposit)}</b><span>Deposit</span></div><div><b>{money(financedAmount)}</b><span>Financed amount</span></div><div><b>{selectedMachine?.asset_code || "Not selected"}</b><span>Excavator</span></div></aside></div><SchedulePreview preview={schedulePreview} loading={scheduleLoading} problem={scheduleProblem} /></SectionCard> : null}

        {!loading && step === 3 ? <SectionCard eyebrow="Step 4 · Optional assessment" title="Add customer assessment details" description="These fields can be completed now or later. They do not prevent draft creation unless a commercial rule explicitly requires them."><div className="c03-start-optional-banner"><strong>{optionalMissing.length} items still optional</strong><span>{optionalMissing.length ? optionalMissing.join(" · ") : "The profile is well populated."}</span></div><h3 className="c03-start-subhead">Identity, residence and work</h3><div className="c03-start-grid c03-start-grid--2"><Field label="ID type"><select value={data.kyc.id_type} onChange={(event) => updateSection("kyc", "id_type", event.target.value)}><option>Ghana Card</option><option>Non-Citizen Ghana Card</option><option>Passport</option><option>Driver Licence</option><option>Other</option></select></Field><Field label="ID number"><input value={data.kyc.id_number} onChange={(event) => updateSection("kyc", "id_number", event.target.value)} /></Field><Field label="Date of birth"><input type="date" value={data.kyc.date_of_birth} onChange={(event) => updateSection("kyc", "date_of_birth", event.target.value)} /></Field><Field label="Nationality"><input value={data.kyc.nationality} onChange={(event) => updateSection("kyc", "nationality", event.target.value)} /></Field><Field label="Employment / business type"><select value={data.kyc.employment_type} onChange={(event) => updateSection("kyc", "employment_type", event.target.value)}><option value="">Not recorded yet</option><option value="salaried">Salaried</option><option value="self_employed">Self-employed</option><option value="contractor">Contractor</option><option value="pensioner">Pensioner</option><option value="farmer">Farmer</option><option value="other">Other</option></select></Field><Field label="Occupation / main activity"><input value={data.kyc.occupation} onChange={(event) => updateSection("kyc", "occupation", event.target.value)} /></Field><Field label="Employer / business name"><input value={data.kyc.employer_business_name} onChange={(event) => updateSection("kyc", "employer_business_name", event.target.value)} /></Field><Field label="Business registration number"><input value={data.kyc.business_registration_number} onChange={(event) => updateSection("kyc", "business_registration_number", event.target.value)} /></Field><Field label="Residential address" className="c03-start-field--wide"><textarea rows="3" value={data.kyc.residential_address} onChange={(event) => updateSection("kyc", "residential_address", event.target.value)} /></Field><Field label="Work / business address" className="c03-start-field--wide"><textarea rows="3" value={data.kyc.work_address} onChange={(event) => updateSection("kyc", "work_address", event.target.value)} /></Field></div><h3 className="c03-start-subhead">Affordability</h3><div className="c03-start-grid c03-start-grid--3"><MoneyField label="Monthly salary income" value={data.affordability.monthly_salary_income} onChange={(value) => updateSection("affordability", "monthly_salary_income", value)} /><MoneyField label="Monthly business income" value={data.affordability.monthly_business_income} onChange={(value) => updateSection("affordability", "monthly_business_income", value)} /><MoneyField label="Other monthly income" value={data.affordability.monthly_other_income} onChange={(value) => updateSection("affordability", "monthly_other_income", value)} /><MoneyField label="Business operating costs" value={data.affordability.monthly_business_costs} onChange={(value) => updateSection("affordability", "monthly_business_costs", value)} /><MoneyField label="Household expenses" value={data.affordability.monthly_household_expenses} onChange={(value) => updateSection("affordability", "monthly_household_expenses", value)} /><MoneyField label="Existing monthly debt" value={data.affordability.existing_monthly_debt} onChange={(value) => updateSection("affordability", "existing_monthly_debt", value)} /><Field label="Assessment notes" className="c03-start-field--wide"><textarea rows="3" value={data.affordability.assessment_notes} onChange={(event) => updateSection("affordability", "assessment_notes", event.target.value)} /></Field></div><h3 className="c03-start-subhead">Emergency contact, guarantor and consent</h3><div className="c03-start-grid c03-start-grid--2"><Field label="Emergency contact name"><input value={data.kyc.emergency_contact_name} onChange={(event) => updateSection("kyc", "emergency_contact_name", event.target.value)} /></Field><Field label="Emergency contact phone"><input inputMode="tel" value={data.kyc.emergency_contact_phone} onChange={(event) => updateSection("kyc", "emergency_contact_phone", event.target.value)} /></Field><Field label="Emergency relationship"><input value={data.kyc.emergency_contact_relationship} onChange={(event) => updateSection("kyc", "emergency_contact_relationship", event.target.value)} /></Field><Field label="Guarantor name"><input value={data.kyc.guarantor_name} onChange={(event) => updateSection("kyc", "guarantor_name", event.target.value)} /></Field><Field label="Guarantor phone"><input inputMode="tel" value={data.kyc.guarantor_phone} onChange={(event) => updateSection("kyc", "guarantor_phone", event.target.value)} /></Field><Field label="Guarantor ID number"><input value={data.kyc.guarantor_id_number} onChange={(event) => updateSection("kyc", "guarantor_id_number", event.target.value)} /></Field><Field label="Guarantor address" className="c03-start-field--wide"><textarea rows="2" value={data.kyc.guarantor_address} onChange={(event) => updateSection("kyc", "guarantor_address", event.target.value)} /></Field></div><div className="c03-start-checks"><label><input type="checkbox" checked={data.kyc.customer_consent_confirmed} onChange={(event) => updateSection("kyc", "customer_consent_confirmed", event.target.checked)} /><span><strong>Customer information consent confirmed</strong><small>Customer permission to collect and use application information.</small></span></label><label><input type="checkbox" checked={data.kyc.credit_assessment_consent_confirmed} onChange={(event) => updateSection("kyc", "credit_assessment_consent_confirmed", event.target.checked)} /><span><strong>Credit assessment consent confirmed</strong><small>Permission for the company to assess the proposed installment.</small></span></label></div></SectionCard> : null}

        {!loading && step === 4 ? <SectionCard eyebrow="Step 5 · Final review" title="Everything is ready to create the draft" description="Review the commercial snapshot below. Optional assessment gaps will remain visible on the application for later completion."><div className="c03-start-review-grid"><article><span>Customer</span><strong>{selectedCustomer?.customer_name || data.customer.customer_name || "Not selected"}</strong><small>{selectedCustomer?.phone || data.customer.phone || "No phone"}</small></article><article><span>Excavator</span><strong>{selectedMachine?.asset_code || "Not selected"}</strong><small>{selectedMachine?.asset_name || "No machine selected"}</small></article><article><span>Selling price</span><strong>{money(data.offer.selling_price)}</strong><small>Commercial price</small></article><article><span>Opening deposit</span><strong>{money(data.offer.deposit)}</strong><small>Paid at opening</small></article><article><span>Financed amount</span><strong>{money(financedAmount)}</strong><small>Before installment payments</small></article><article><span>Payment pattern</span><strong>{data.offer.installment_count} payments</strong><small>{data.offer.payment_frequency === "monthly" ? "Monthly" : data.offer.payment_frequency}</small></article></div><SchedulePreview preview={schedulePreview} loading={scheduleLoading} problem={scheduleProblem} />{optionalMissing.length ? <div className="c03-start-review-note"><strong>Still optional / incomplete</strong><span>{optionalMissing.join(" · ")}</span></div> : <div className="c03-start-review-note is-complete"><strong>Profile is well prepared</strong><span>No optional assessment gaps are currently flagged.</span></div>}</SectionCard> : null}

        <footer className="c03-start-footer"><div><span>{STEPS[step].label}</span><strong>{STEPS[step].title}</strong></div><div className="c03-start-footer-actions">{step > 0 ? <button type="button" onClick={back}>Back</button> : null}{step < STEPS.length - 1 ? <button type="button" className="is-primary" onClick={next} disabled={!canCreate}>Continue to {STEPS[step + 1].label}</button> : <button type="button" className="is-primary" onClick={submit} disabled={!canCreate || saving}>{saving ? "Creating draft…" : "Create installment draft"}</button>}</div></footer>
      </div>
    </main>
  );
}
