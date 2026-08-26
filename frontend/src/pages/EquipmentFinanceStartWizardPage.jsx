import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { CustomerPortraitPicker } from "../components/CustomerPortrait";
import "../styles/equipmentFinancePhaseOne.css";
import "../styles/equipmentFinanceStartWizardPolish.css";

const API = "/equipment-catalogue/sales/phase-one";
const DRAFT_KEY = "chalin03.finance.start-installment.v2";

const STEP_TITLES = [
  "Customer",
  "Excavator",
  "Payment plan",
  "Optional assessment",
  "Review & create",
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
      profile_photo_data_url: "",
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

function deepMergeDraft(saved = {}) {
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

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function numberValue(value) {
  const number = Number(String(value || "0").replaceAll(",", ""));
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "Not recorded")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

function Field({ title, children, wide = false, hint = "" }) {
  return (
    <label className={`finance-simple__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function MoneyField({ title, value, onChange, hint = "" }) {
  return (
    <Field title={title} hint={hint}>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, ""))}
        placeholder="Leave empty or enter 0.00"
      />
      <strong className="finance-simple__money">{money(value)}</strong>
    </Field>
  );
}

function SchedulePreview({ preview, loading, problem }) {
  if (loading) {
    return <div className="finance-simple__notice is-info">Calculating exact payment dates…</div>;
  }
  if (problem) {
    return <div className="finance-simple__notice is-error">{problem}</div>;
  }
  if (!preview?.schedule?.length) return null;
  const firstRows = preview.schedule.slice(0, 8);
  const finalRows = preview.schedule.length > 11 ? preview.schedule.slice(-3) : [];
  const visibleRows = [...firstRows, ...finalRows];
  return (
    <section className="finance-simple__section">
      <div className="finance-simple__section-header">
        <div>
          <p className="finance-simple__eyebrow">Exact schedule preview</p>
          <h3>{preview.schedule.length} payment date(s)</h3>
          <span className="finance-simple__muted">
            First {dateLabel(preview.first_due_date)} · Final {dateLabel(preview.final_due_date)}
          </span>
        </div>
        <strong className="finance-simple__money">{money(preview.periodic_amount)}</strong>
      </div>
      <div className="finance-simple__facts">
        <div><span>Financed amount</span><strong>{money(preview.financed_amount)}</strong></div>
        <div><span>Normal payment</span><strong>{money(preview.periodic_amount)}</strong></div>
        <div><span>Final payment</span><strong>{money(preview.final_payment_amount)}</strong></div>
        <div><span>Date rule</span><strong>{label(preview.non_working_day_rule)}</strong></div>
      </div>
      <div className="finance-simple__schedule-list">
        {visibleRows.map((row, index) => (
          <article key={`${row.sequence_number}-${row.due_date}`}>
            {index === 8 && finalRows.length ? <small>… remaining dates …</small> : null}
            <span>Payment {row.sequence_number}</span>
            <strong>{dateLabel(row.due_date)}</strong>
            <b>{money(row.scheduled_amount)}</b>
          </article>
        ))}
      </div>
      <details>
        <summary>Show every exact payment date</summary>
        <div className="finance-simple__schedule-list">
          {preview.schedule.map((row) => (
            <article key={`all-${row.sequence_number}-${row.due_date}`}>
              <span>Payment {row.sequence_number}</span>
              <strong>{dateLabel(row.due_date)}</strong>
              <b>{money(row.scheduled_amount)}</b>
            </article>
          ))}
        </div>
      </details>
    </section>
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
  const canCreate =
    effectivePermissions.includes("fleet.assets.manage") ||
    ["system_administrator", "super_admin", "admin", "administrator"].includes(role);

  const [step, setStep] = useState(0);
  const [data, setData] = useState(blankState);
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
        const saved = window.localStorage.getItem(DRAFT_KEY);
        if (saved) {
          try {
            setData(deepMergeDraft(JSON.parse(saved)));
            setNotice("Your unfinished installment draft was restored on this device.");
          } catch {
            window.localStorage.removeItem(DRAFT_KEY);
      window.dispatchEvent(
        new CustomEvent("chalin03:finance-draft-change", {
          detail: { payload: null },
        })
      );
          }
        }
        if (preselectedCustomer || preselectedAsset) {
          setData((current) => ({
            ...current,
            ...(preselectedCustomer
              ? { customerMode: "existing", customer_id: preselectedCustomer }
              : {}),
            ...(preselectedAsset ? { asset_id: preselectedAsset } : {}),
          }));
        }
      } catch (error) {
        if (active) setProblem(errorMessage(error, "Could not prepare the installment wizard."));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [preselectedAsset, preselectedCustomer]);

  useEffect(() => {
    if (loading) return;
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    window.dispatchEvent(
      new CustomEvent("chalin03:finance-draft-change", {
        detail: { payload: data },
      })
    );
  }, [data, loading]);

  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === String(data.customer_id)
  );
  const selectedMachine = machines.find(
    (machine) => String(machine.id) === String(data.asset_id)
  );

  useEffect(() => {
    if (!selectedMachine) return;
    setData((current) => {
      if (current.offer.selling_price) return current;
      return {
        ...current,
        offer: {
          ...current.offer,
          selling_price: String(selectedMachine.target_selling_price || ""),
        },
      };
    });
  }, [selectedMachine]);

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) =>
      [customer.customer_name, customer.phone, customer.customer_code, customer.email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [customerSearch, customers]);

  const filteredMachines = useMemo(() => {
    const term = machineSearch.trim().toLowerCase();
    return machines.filter((machine) => {
      if (!machine.readiness?.ready || machine.sale_status !== "available") return false;
      if (Number(machine.active_application_count || 0) > 0) return false;
      if (!term) return true;
      return [
        machine.asset_code,
        machine.asset_name,
        machine.make,
        machine.model,
        machine.serial_number,
        machine.chassis_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [machineSearch, machines]);

  const financedAmount = Math.max(
    numberValue(data.offer.selling_price) - numberValue(data.offer.deposit),
    0
  );

  useEffect(() => {
    const offer = data.offer;
    const valid =
      numberValue(offer.selling_price) > 0 &&
      numberValue(offer.deposit) <= numberValue(offer.selling_price) &&
      Number(offer.installment_count) > 0 &&
      Boolean(offer.first_due_date) &&
      (offer.payment_frequency !== "custom" || Number(offer.custom_interval_days) > 0);
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
        setScheduleProblem(errorMessage(error, "Could not calculate the exact dates."));
      } finally {
        setScheduleLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data.offer]);

  function updateSection(section, field, value) {
    setData((current) => ({
      ...current,
      [section]: { ...current[section], [field]: value },
    }));
  }

  function chooseMachine(machine) {
    setData((current) => ({
      ...current,
      asset_id: String(machine.id),
      offer: {
        ...current.offer,
        selling_price:
          current.offer.selling_price || String(machine.target_selling_price || ""),
      },
    }));
  }

  function validateStep(index) {
    if (!canCreate) return "Your account can view Finance but cannot create a new installment.";
    if (index === 0) {
      if (data.customerMode === "existing" && !data.customer_id) {
        return "Select an existing customer or choose Create new customer.";
      }
      if (
        data.customerMode === "new" &&
        (!data.customer.customer_name.trim() || !data.customer.phone.trim())
      ) {
        return "Enter the new customer name and phone number.";
      }
    }
    if (index === 1 && !data.asset_id) return "Select the exact excavator.";
    if (index === 2) {
      if (numberValue(data.offer.selling_price) <= 0) return "Enter the selling price.";
      if (numberValue(data.offer.deposit) > numberValue(data.offer.selling_price)) {
        return "The deposit cannot exceed the selling price.";
      }
      if (numberValue(data.offer.installment_count) < 1) {
        return "Enter at least one installment payment.";
      }
      if (!data.offer.first_due_date) return "Choose the first payment due date.";
      if (
        data.offer.payment_frequency === "custom" &&
        Number(data.offer.custom_interval_days) < 1
      ) {
        return "Enter how many days should pass between payments.";
      }
      if (!schedulePreview) return scheduleProblem || "Wait for the exact schedule preview.";
    }
    return "";
  }

  function continueForward() {
    const issue = validateStep(step);
    if (issue) {
      setProblem(issue);
      return;
    }
    setProblem("");
    setStep((current) => Math.min(current + 1, STEP_TITLES.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    setProblem("");
    setStep((current) => Math.max(current - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    for (const index of [0, 1, 2]) {
      const issue = validateStep(index);
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
      const customerAddress =
        data.kyc.residential_address ||
        selectedCustomer?.address ||
        data.customer.address;
      const payload = {
        customer_id: data.customerMode === "existing" ? data.customer_id : null,
        customer: data.customerMode === "new" ? data.customer : undefined,
        asset_id: data.asset_id,
        offer: data.offer,
        kyc: {
          ...data.kyc,
          customer_name_snapshot:
            selectedCustomer?.customer_name || data.customer.customer_name,
          customer_phone_snapshot: selectedCustomer?.phone || data.customer.phone,
          customer_email_snapshot: selectedCustomer?.email || data.customer.email,
          customer_address_snapshot: customerAddress,
          residential_address: customerAddress,
        },
        affordability: data.affordability,
      };
      const response = await axiosClient.post(`${API}/start-installment`, payload);
      window.localStorage.removeItem(DRAFT_KEY);
      window.dispatchEvent(
        new CustomEvent("chalin03:finance-draft-change", {
          detail: { payload: null },
        })
      );
      const applicationNumber = response.data?.application?.application_number || "The draft";
      setNotice(`${applicationNumber} was created with its exact payment dates.`);
      window.setTimeout(
        () =>
          navigate(
            response.data?.next_path || "/equipment-installment-finance/applications"
          ),
        900
      );
    } catch (error) {
      setProblem(errorMessage(error, "Could not start the installment."));
    } finally {
      setSaving(false);
    }
  }

  function clearDraft() {
    window.localStorage.removeItem(DRAFT_KEY);
      window.dispatchEvent(
        new CustomEvent("chalin03:finance-draft-change", {
          detail: { payload: null },
        })
      );
    setData(blankState());
    setSchedulePreview(null);
    setStep(0);
    setProblem("");
    setNotice("The draft was cleared.");
  }

  const optionalMissing = [
    !data.kyc.id_number && "Customer ID",
    !data.kyc.employment_type && "Employment or business type",
    !data.kyc.occupation && "Occupation",
    !data.kyc.residential_address && !selectedCustomer?.address && !data.customer.address && "Address",
    numberValue(data.affordability.monthly_salary_income) +
      numberValue(data.affordability.monthly_business_income) +
      numberValue(data.affordability.monthly_other_income) <=
      0 && "Affordability income",
    !data.kyc.customer_consent_confirmed && "Customer consent",
    !data.kyc.credit_assessment_consent_confirmed && "Credit assessment consent",
    financedAmount >= 100000 && !data.kyc.guarantor_name && "Guarantor",
  ].filter(Boolean);

  return (
    <main className="finance-simple finance-start-wizard">
      <header className="finance-simple__hero">
        <div>
          <p>Company-wide guided workflow</p>
          <h1>Start New Installment</h1>
          <span>
            Choose the customer and exact excavator, calculate every payment date, then
            create a draft. KYC and affordability can be completed later before submission.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">
            Help with this process
          </Link>
          <button type="button" onClick={clearDraft}>Clear draft</button>
        </div>
      </header>

      {!canCreate ? (
        <div className="finance-simple__notice is-error" role="alert">
          Your account has view-only Finance access. Ask an authorised administrator for
          installment-creation permission before entering customer information.
        </div>
      ) : null}
      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}
      <div className="finance-simple__notice is-info">
        Installment Finance is company-wide. No operational location is selected or stored on the case.
      </div>

      <nav className="finance-simple__steps" aria-label="Installment steps">
        {STEP_TITLES.map((title, index) => (
          <button
            className={`finance-simple__step ${index === step ? "is-active" : ""} ${index < step ? "is-done" : ""}`}
            key={title}
            type="button"
            onClick={() => index <= step && setStep(index)}
          >
            <b>{index < step ? "✓" : index + 1}</b>
            <span>{title}</span>
          </button>
        ))}
      </nav>

      {loading ? <div className="finance-simple__empty">Preparing customers and excavators…</div> : null}

      {!loading && step === 0 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__section-header">
            <div>
              <p className="finance-simple__eyebrow">Step 1</p>
              <h2>Who is buying the excavator?</h2>
              <span className="finance-simple__muted">Search first to avoid duplicate records.</span>
            </div>
            <select
              value={data.customerMode}
              onChange={(event) =>
                setData((current) => ({
                  ...current,
                  customerMode: event.target.value,
                  customer_id: "",
                }))
              }
              aria-label="Customer mode"
              disabled={!canCreate}
            >
              <option value="existing">Select existing customer</option>
              <option value="new">Create new customer</option>
            </select>
          </div>

          {data.customerMode === "existing" ? (
            <>
              <div className="finance-simple__grid">
                <Field title="Search customer" wide>
                  <input
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="Name, phone, customer code or email"
                  />
                </Field>
              </div>
              <div className="finance-simple__customer-grid">
                {filteredCustomers.map((customer) => (
                  <button
                    type="button"
                    key={customer.id}
                    className={String(data.customer_id) === String(customer.id) ? "is-selected" : ""}
                    onClick={() => setData((current) => ({ ...current, customer_id: String(customer.id) }))}
                  >
                    <strong>{customer.customer_name}</strong>
                    <span>{customer.phone || "No phone"}</span>
                    <small>{customer.customer_code} · {money(customer.outstanding_balance)}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="finance-simple__grid">
              <div className="finance-start-wizard__customer-photo">
                <CustomerPortraitPicker value={data.customer.profile_photo_data_url} name={data.customer.customer_name || "Customer"} onChange={(value) => updateSection("customer", "profile_photo_data_url", value)} compact />
              </div>
              <Field title="Customer name"><input value={data.customer.customer_name} onChange={(event) => updateSection("customer", "customer_name", event.target.value)} /></Field>
              <Field title="Customer type"><select value={data.customer.customer_type} onChange={(event) => updateSection("customer", "customer_type", event.target.value)}><option value="individual">Individual</option><option value="company">Company</option><option value="contractor">Contractor</option><option value="government">Government</option></select></Field>
              <Field title="Phone number"><input inputMode="tel" value={data.customer.phone} onChange={(event) => updateSection("customer", "phone", event.target.value)} /></Field>
              <Field title="WhatsApp phone" hint="Optional"><input inputMode="tel" value={data.customer.whatsapp_phone} onChange={(event) => updateSection("customer", "whatsapp_phone", event.target.value)} /></Field>
              <Field title="Email" hint="Optional"><input type="email" value={data.customer.email} onChange={(event) => updateSection("customer", "email", event.target.value)} /></Field>
              <Field title="Address" hint="Optional for draft"><textarea value={data.customer.address} onChange={(event) => updateSection("customer", "address", event.target.value)} /></Field>
            </div>
          )}
        </section>
      ) : null}

      {!loading && step === 1 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__section-header">
            <div><p className="finance-simple__eyebrow">Step 2</p><h2>Select the exact excavator</h2><span className="finance-simple__muted">Only sale-ready machines without an active case appear.</span></div>
          </div>
          <div className="finance-simple__grid"><Field title="Search excavator" wide><input value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} placeholder="Code, make, model, serial or chassis" /></Field></div>
          <div className="finance-simple__cards">
            {filteredMachines.map((machine) => (
              <article className={`finance-simple__card ${String(data.asset_id) === String(machine.id) ? "is-selected" : ""}`} key={machine.id}>
                <div className="finance-simple__machine-image">{machine.main_image_url ? <img src={machine.main_image_url} alt={machine.asset_name} /> : <span>🚜</span>}</div>
                <div className="finance-simple__card-body"><small>{machine.asset_code}</small><h3>{machine.asset_name}</h3><p>{[machine.make, machine.model, machine.model_year].filter(Boolean).join(" ")}</p><div className="finance-simple__facts"><div><span>Target price</span><strong>{money(machine.target_selling_price)}</strong></div><div><span>Serial</span><strong>{machine.serial_number || "Not recorded"}</strong></div></div><button className="is-primary" type="button" onClick={() => chooseMachine(machine)}>{String(data.asset_id) === String(machine.id) ? "✓ Selected" : "Select this excavator"}</button></div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && step === 2 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Step 3</p><h2>Set the exact payment interval</h2><span className="finance-simple__muted">The dates shown here become the approved Offer and agreement dates.</span></div></div>
          <div className="finance-simple__grid">
            <MoneyField title="Selling price" value={data.offer.selling_price} onChange={(value) => updateSection("offer", "selling_price", value)} />
            <MoneyField title="Opening deposit" value={data.offer.deposit} onChange={(value) => updateSection("offer", "deposit", value)} />
            <Field title="Payment pattern"><select value={data.offer.payment_frequency} onChange={(event) => updateSection("offer", "payment_frequency", event.target.value)}><option value="weekly">Every 7 days</option><option value="fortnightly">Every 14 days</option><option value="monthly">Monthly on the selected date</option><option value="custom">Choose number of days</option></select></Field>
            {data.offer.payment_frequency === "custom" ? <Field title="Days between payments" hint="For example: 10, 21 or 30 days"><input type="number" min="1" max="365" inputMode="numeric" value={data.offer.custom_interval_days} onChange={(event) => updateSection("offer", "custom_interval_days", event.target.value)} /></Field> : null}
            <Field title="Number of payments"><input type="number" min="1" max="520" inputMode="numeric" value={data.offer.installment_count} onChange={(event) => updateSection("offer", "installment_count", event.target.value)} /></Field>
            <Field title="First payment date"><input type="date" value={data.offer.first_due_date} onChange={(event) => updateSection("offer", "first_due_date", event.target.value)} /></Field>
            <Field title="Weekend handling"><select value={data.offer.non_working_day_rule} onChange={(event) => updateSection("offer", "non_working_day_rule", event.target.value)}><option value="exact">Keep the exact date</option><option value="next_weekday">Move to next weekday</option><option value="previous_weekday">Move to previous weekday</option></select></Field>
            <Field title="Internal note" wide hint="Optional"><textarea value={data.offer.notes} onChange={(event) => updateSection("offer", "notes", event.target.value)} /></Field>
          </div>
          <SchedulePreview preview={schedulePreview} loading={scheduleLoading} problem={scheduleProblem} />
        </section>
      ) : null}

      {!loading && step === 3 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__notice is-info"><strong>Everything on this step is optional when creating the draft.</strong><p>Complete it now when available, or open the draft later before submission and approval.</p></div>
          <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Step 4</p><h2>Customer assessment</h2><span className="finance-simple__muted">Missing information will be shown as a later checklist—not a creation error.</span></div></div>
          <h3>Identity and work</h3>
          <div className="finance-simple__grid">
            <Field title="ID type" hint="Optional"><input value={data.kyc.id_type} onChange={(event) => updateSection("kyc", "id_type", event.target.value)} /></Field>
            <Field title="ID number" hint="Optional"><input value={data.kyc.id_number} onChange={(event) => updateSection("kyc", "id_number", event.target.value)} /></Field>
            <Field title="Date of birth" hint="Optional"><input type="date" value={data.kyc.date_of_birth} onChange={(event) => updateSection("kyc", "date_of_birth", event.target.value)} /></Field>
            <Field title="Employment or business type" hint="Optional"><select value={data.kyc.employment_type} onChange={(event) => updateSection("kyc", "employment_type", event.target.value)}><option value="">Not recorded yet</option><option value="salaried">Salaried</option><option value="self_employed">Self-employed</option><option value="contractor">Contractor</option><option value="pensioner">Pensioner</option><option value="farmer">Farmer</option><option value="other">Other</option></select></Field>
            <Field title="Occupation" hint="Optional"><input value={data.kyc.occupation} onChange={(event) => updateSection("kyc", "occupation", event.target.value)} /></Field>
            <Field title="Employer or business" hint="Optional"><input value={data.kyc.employer_business_name} onChange={(event) => updateSection("kyc", "employer_business_name", event.target.value)} /></Field>
            <Field title="Residential address" wide hint="Optional for draft"><textarea value={data.kyc.residential_address} onChange={(event) => updateSection("kyc", "residential_address", event.target.value)} /></Field>
          </div>
          <h3>Monthly affordability</h3>
          <div className="finance-simple__grid">
            <MoneyField title="Salary income" value={data.affordability.monthly_salary_income} onChange={(value) => updateSection("affordability", "monthly_salary_income", value)} hint="Optional for draft" />
            <MoneyField title="Business income" value={data.affordability.monthly_business_income} onChange={(value) => updateSection("affordability", "monthly_business_income", value)} hint="Optional for draft" />
            <MoneyField title="Other income" value={data.affordability.monthly_other_income} onChange={(value) => updateSection("affordability", "monthly_other_income", value)} hint="Optional for draft" />
            <MoneyField title="Business costs" value={data.affordability.monthly_business_costs} onChange={(value) => updateSection("affordability", "monthly_business_costs", value)} hint="Optional" />
            <MoneyField title="Household expenses" value={data.affordability.monthly_household_expenses} onChange={(value) => updateSection("affordability", "monthly_household_expenses", value)} hint="Optional" />
            <MoneyField title="Existing monthly debt" value={data.affordability.existing_monthly_debt} onChange={(value) => updateSection("affordability", "existing_monthly_debt", value)} hint="Optional" />
          </div>
          <h3>Consent and guarantor</h3>
          <div className="finance-simple__checks">
            <label><input type="checkbox" checked={data.kyc.customer_consent_confirmed} onChange={(event) => updateSection("kyc", "customer_consent_confirmed", event.target.checked)} /> Customer consent confirmed</label>
            <label><input type="checkbox" checked={data.kyc.credit_assessment_consent_confirmed} onChange={(event) => updateSection("kyc", "credit_assessment_consent_confirmed", event.target.checked)} /> Credit assessment consent confirmed</label>
          </div>
          <div className="finance-simple__grid">
            <Field title="Guarantor name" hint={financedAmount >= 100000 ? "Complete before submission" : "Optional"}><input value={data.kyc.guarantor_name} onChange={(event) => updateSection("kyc", "guarantor_name", event.target.value)} /></Field>
            <Field title="Guarantor phone" hint="Optional for draft"><input value={data.kyc.guarantor_phone} onChange={(event) => updateSection("kyc", "guarantor_phone", event.target.value)} /></Field>
            <Field title="Guarantor ID number" hint="Optional for draft"><input value={data.kyc.guarantor_id_number} onChange={(event) => updateSection("kyc", "guarantor_id_number", event.target.value)} /></Field>
          </div>
        </section>
      ) : null}

      {!loading && step === 4 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Step 5</p><h2>Review and create the draft</h2><span className="finance-simple__muted">Only customer, excavator and valid payment terms are required now.</span></div></div>
          <div className="finance-simple__summary">
            <article><span>Customer</span><strong>{selectedCustomer?.customer_name || data.customer.customer_name}</strong><small>{selectedCustomer?.phone || data.customer.phone}</small></article>
            <article><span>Excavator</span><strong>{selectedMachine?.asset_code} — {selectedMachine?.asset_name}</strong><small>{[selectedMachine?.make, selectedMachine?.model].filter(Boolean).join(" ")}</small></article>
            <article><span>Selling price</span><strong>{money(data.offer.selling_price)}</strong></article>
            <article><span>Deposit</span><strong>{money(data.offer.deposit)}</strong></article>
            <article><span>Financed amount</span><strong>{money(financedAmount)}</strong></article>
            <article><span>Payment interval</span><strong>{data.offer.payment_frequency === "custom" ? `Every ${data.offer.custom_interval_days} days` : label(data.offer.payment_frequency)}</strong></article>
            <article><span>Exact dates</span><strong>{schedulePreview?.schedule?.length || 0} payments</strong><small>{dateLabel(schedulePreview?.first_due_date)} → {dateLabel(schedulePreview?.final_due_date)}</small></article>
            <article><span>Normal payment</span><strong>{money(schedulePreview?.periodic_amount)}</strong></article>
          </div>
          {optionalMissing.length ? (
            <div className="finance-simple__notice is-warning">
              <strong>Complete before submission for approval:</strong>
              <p>{optionalMissing.join(", ")}.</p>
              <small>These items do not block draft creation.</small>
            </div>
          ) : (
            <div className="finance-simple__notice">Assessment information is ready for later verification.</div>
          )}
          <SchedulePreview preview={schedulePreview} loading={false} problem="" />
        </section>
      ) : null}

      {!loading ? (
        <div className="finance-simple__sticky-actions">
          {step > 0 ? <button type="button" onClick={goBack} disabled={saving}>Back</button> : <span />}
          {step < STEP_TITLES.length - 1 ? (
            <button className="is-primary" type="button" onClick={continueForward} disabled={!canCreate}>Continue</button>
          ) : (
            <button className="is-primary" type="button" onClick={submit} disabled={saving || !canCreate}>{saving ? "Creating draft…" : "Create Draft Installment"}</button>
          )}
        </div>
      ) : null}
    </main>
  );
}
