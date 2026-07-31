import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinancePhaseOne.css";

const API = "/equipment-catalogue/sales/phase-one";
const DRAFT_KEY = "chalin03.finance.start-installment.v1";

const STEP_TITLES = [
  "Customer",
  "Excavator",
  "Price & plan",
  "KYC & affordability",
  "Review",
];

function todayPlus(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function initialState() {
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
      installment_count: "12",
      first_due_date: todayPlus(30),
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
      monthly_salary_income: "0",
      monthly_business_income: "0",
      monthly_other_income: "0",
      monthly_business_costs: "0",
      monthly_household_expenses: "0",
      existing_monthly_debt: "0",
      assessment_notes: "",
    },
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
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
        placeholder="0.00"
      />
      <strong className="finance-simple__money">{money(value)}</strong>
    </Field>
  );
}

export default function EquipmentFinanceStartWizardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const preselectedCustomer = new URLSearchParams(location.search).get("customer") || "";
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialState);
  const [customers, setCustomers] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [machineSearch, setMachineSearch] = useState("");

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
            const parsed = JSON.parse(saved);
            setData((current) => ({ ...current, ...parsed }));
            setNotice("Your unfinished installment draft was restored on this device.");
          } catch {
            window.localStorage.removeItem(DRAFT_KEY);
          }
        }
        if (preselectedCustomer) {
          setData((current) => ({
            ...current,
            customerMode: "existing",
            customer_id: preselectedCustomer,
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
  }, [preselectedCustomer]);

  useEffect(() => {
    if (loading) return;
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  }, [data, loading]);

  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === String(data.customer_id)
  );
  const selectedMachine = machines.find(
    (machine) => String(machine.id) === String(data.asset_id)
  );

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
  const periodicAmount = financedAmount / Math.max(numberValue(data.offer.installment_count), 1);

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
    }
    if (index === 3) {
      const customerAddress =
        data.kyc.residential_address ||
        selectedCustomer?.address ||
        data.customer.address;
      if (
        !data.kyc.id_number.trim() ||
        !data.kyc.employment_type ||
        !data.kyc.occupation.trim() ||
        !String(customerAddress || "").trim()
      ) {
        return "Complete the customer ID, employment type, occupation and residential address.";
      }
      if (!data.kyc.customer_consent_confirmed || !data.kyc.credit_assessment_consent_confirmed) {
        return "Confirm both customer consent declarations.";
      }
      if (financedAmount >= 100000) {
        if (
          !data.kyc.guarantor_name.trim() ||
          !data.kyc.guarantor_phone.trim() ||
          !data.kyc.guarantor_id_number.trim()
        ) {
          return "This financed amount requires the guarantor name, phone and ID number.";
        }
      }
      const income =
        numberValue(data.affordability.monthly_salary_income) +
        numberValue(data.affordability.monthly_business_income) +
        numberValue(data.affordability.monthly_other_income);
      if (income <= 0) return "Enter the customer’s monthly income before review.";
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
    for (let index = 0; index < STEP_TITLES.length - 1; index += 1) {
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
      const applicationNumber = response.data?.application?.application_number || "the draft";
      setNotice(`${applicationNumber} was created with its automatic Installment Offer.`);
      window.setTimeout(() => navigate(response.data?.next_path || "/equipment-installment-finance/applications"), 900);
    } catch (error) {
      setProblem(errorMessage(error, "Could not start the installment."));
    } finally {
      setSaving(false);
    }
  }

  function clearDraft() {
    window.localStorage.removeItem(DRAFT_KEY);
    setData(initialState());
    setStep(0);
    setProblem("");
    setNotice("The local draft was cleared.");
  }

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>Simple guided workflow</p>
          <h1>Start New Installment</h1>
          <span>
            Choose the customer and exact excavator, set the payment plan, complete KYC,
            then create one draft application. The Installment Offer is created automatically.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">
            Help with this process
          </Link>
          <button type="button" onClick={clearDraft}>Clear draft</button>
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}
      <div className="finance-simple__notice is-info">
        Finance is company-wide. You do not need to choose a Hire location; the system keeps
        the excavator’s physical yard only as internal storage information.
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
              <span className="finance-simple__muted">Search first to avoid duplicate customer records.</span>
            </div>
            <select
              value={data.customerMode}
              onChange={(event) => setData((current) => ({ ...current, customerMode: event.target.value, customer_id: "" }))}
              aria-label="Customer mode"
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
                  <article
                    className={`finance-simple__customer ${String(data.customer_id) === String(customer.id) ? "is-selected" : ""}`}
                    key={customer.id}
                  >
                    <div className="finance-simple__customer-body">
                      <span className="finance-simple__pill">{customer.customer_code}</span>
                      <h3>{customer.customer_name}</h3>
                      <p>{customer.phone || "No phone"}</p>
                      <small>{customer.address || "No address recorded"}</small>
                      <div className="finance-simple__facts">
                        <div><span>Applications</span><strong>{customer.finance_application_count || 0}</strong></div>
                        <div><span>Outstanding</span><strong>{money(customer.outstanding_balance)}</strong></div>
                      </div>
                      <button
                        className={String(data.customer_id) === String(customer.id) ? "is-primary" : ""}
                        type="button"
                        onClick={() => setData((current) => ({ ...current, customer_id: String(customer.id) }))}
                      >
                        {String(data.customer_id) === String(customer.id) ? "Selected" : "Select customer"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!filteredCustomers.length ? <div className="finance-simple__empty">No matching customer. Choose Create new customer.</div> : null}
            </>
          ) : (
            <div className="finance-simple__grid">
              <Field title="Full name"><input value={data.customer.customer_name} onChange={(event) => updateSection("customer", "customer_name", event.target.value)} /></Field>
              <Field title="Customer type"><select value={data.customer.customer_type} onChange={(event) => updateSection("customer", "customer_type", event.target.value)}><option value="individual">Individual</option><option value="company">Company</option><option value="contractor">Contractor</option><option value="government">Government</option></select></Field>
              <Field title="Phone"><input inputMode="tel" value={data.customer.phone} onChange={(event) => updateSection("customer", "phone", event.target.value)} /></Field>
              <Field title="WhatsApp phone"><input inputMode="tel" value={data.customer.whatsapp_phone} onChange={(event) => updateSection("customer", "whatsapp_phone", event.target.value)} /></Field>
              <Field title="Email"><input type="email" value={data.customer.email} onChange={(event) => updateSection("customer", "email", event.target.value)} /></Field>
              <Field title="Contact person"><input value={data.customer.contact_person} onChange={(event) => updateSection("customer", "contact_person", event.target.value)} /></Field>
              <Field title="Address" wide><textarea value={data.customer.address} onChange={(event) => updateSection("customer", "address", event.target.value)} /></Field>
            </div>
          )}
        </section>
      ) : null}

      {!loading && step === 1 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__section-header">
            <div><p className="finance-simple__eyebrow">Step 2</p><h2>Select the exact excavator</h2><span className="finance-simple__muted">Only Finance-ready, available machines without an active application appear here.</span></div>
            <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=machines">Register an excavator</Link>
          </div>
          <div className="finance-simple__grid"><Field title="Search excavators" wide><input value={machineSearch} onChange={(event) => setMachineSearch(event.target.value)} placeholder="Code, make, model, serial or chassis" /></Field></div>
          <div className="finance-simple__machine-grid">
            {filteredMachines.map((machine) => {
              const photo = machine.media?.find((item) => item.is_primary)?.file_url || machine.main_image_url;
              return (
                <article className={`finance-simple__machine ${String(data.asset_id) === String(machine.id) ? "is-selected" : ""}`} key={machine.id}>
                  <div className="finance-simple__machine-image">{photo ? <img src={photo} alt={machine.asset_name} /> : <span>🚜</span>}</div>
                  <div className="finance-simple__machine-body">
                    <span className="finance-simple__pill is-good">Available</span>
                    <h3>{machine.asset_code} — {machine.asset_name}</h3>
                    <p>{[machine.make, machine.model, machine.model_year].filter(Boolean).join(" · ")}</p>
                    <div className="finance-simple__facts"><div><span>Serial / chassis</span><strong>{machine.serial_number || machine.chassis_number}</strong></div><div><span>Sale value</span><strong>{money(machine.target_selling_price)}</strong></div></div>
                    <button className={String(data.asset_id) === String(machine.id) ? "is-primary" : ""} type="button" onClick={() => chooseMachine(machine)}>{String(data.asset_id) === String(machine.id) ? "Selected" : "Select excavator"}</button>
                  </div>
                </article>
              );
            })}
          </div>
          {!filteredMachines.length ? <div className="finance-simple__empty">No available Finance-ready excavator matches this search.</div> : null}
        </section>
      ) : null}

      {!loading && step === 2 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Step 3</p><h2>Set price and payment plan</h2><span className="finance-simple__muted">This creates the commercial Installment Offer automatically—there is no separate quotation page.</span></div></div>
          <div className="finance-simple__grid">
            <MoneyField title="Agreed selling price" value={data.offer.selling_price} onChange={(value) => updateSection("offer", "selling_price", value)} />
            <MoneyField title="Opening deposit" value={data.offer.deposit} onChange={(value) => updateSection("offer", "deposit", value)} />
            <Field title="Payment frequency"><select value={data.offer.payment_frequency} onChange={(event) => updateSection("offer", "payment_frequency", event.target.value)}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></Field>
            <Field title="Number of payments"><input type="number" min="1" max="520" value={data.offer.installment_count} onChange={(event) => updateSection("offer", "installment_count", event.target.value)} /></Field>
            <Field title="First payment due date"><input type="date" value={data.offer.first_due_date} onChange={(event) => updateSection("offer", "first_due_date", event.target.value)} /></Field>
            <Field title="Offer note"><input value={data.offer.notes} onChange={(event) => updateSection("offer", "notes", event.target.value)} placeholder="Optional commercial note" /></Field>
          </div>
          <div className="finance-simple__summary">
            <article><span>Financed balance</span><strong className="finance-simple__money">{money(financedAmount)}</strong></article>
            <article><span>Approximate payment</span><strong className="finance-simple__money">{money(periodicAmount)}</strong><small>Per selected payment period; the final schedule handles rounding.</small></article>
          </div>
        </section>
      ) : null}

      {!loading && step === 3 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Step 4</p><h2>KYC, guarantor and affordability</h2><span className="finance-simple__muted">Save the application as a draft now; an authorised reviewer verifies the evidence before approval.</span></div></div>
          <div className="finance-simple__grid">
            <Field title="ID type"><input value={data.kyc.id_type} onChange={(event) => updateSection("kyc", "id_type", event.target.value)} /></Field>
            <Field title="ID number"><input value={data.kyc.id_number} onChange={(event) => updateSection("kyc", "id_number", event.target.value)} /></Field>
            <Field title="Date of birth"><input type="date" value={data.kyc.date_of_birth} onChange={(event) => updateSection("kyc", "date_of_birth", event.target.value)} /></Field>
            <Field title="Nationality"><input value={data.kyc.nationality} onChange={(event) => updateSection("kyc", "nationality", event.target.value)} /></Field>
            <Field title="Employment / business type"><select value={data.kyc.employment_type} onChange={(event) => updateSection("kyc", "employment_type", event.target.value)}><option value="">Choose type</option><option value="salaried">Salaried</option><option value="self_employed">Self-employed</option><option value="contractor">Contractor</option><option value="farmer">Farmer</option><option value="pensioner">Pensioner</option><option value="other">Other</option></select></Field>
            <Field title="Occupation"><input value={data.kyc.occupation} onChange={(event) => updateSection("kyc", "occupation", event.target.value)} /></Field>
            <Field title="Employer / business name"><input value={data.kyc.employer_business_name} onChange={(event) => updateSection("kyc", "employer_business_name", event.target.value)} /></Field>
            <Field title="Business registration number"><input value={data.kyc.business_registration_number} onChange={(event) => updateSection("kyc", "business_registration_number", event.target.value)} /></Field>
            <Field title="Residential address" wide><textarea value={data.kyc.residential_address} onChange={(event) => updateSection("kyc", "residential_address", event.target.value)} placeholder={selectedCustomer?.address || data.customer.address || "Current residential address"} /></Field>
            <Field title="Work address" wide><textarea value={data.kyc.work_address} onChange={(event) => updateSection("kyc", "work_address", event.target.value)} /></Field>
            <Field title="Years at residence"><input type="number" min="0" max="200" value={data.kyc.years_at_residence} onChange={(event) => updateSection("kyc", "years_at_residence", event.target.value)} /></Field>
            <Field title="Years in work / business"><input type="number" min="0" max="200" value={data.kyc.years_in_employment_business} onChange={(event) => updateSection("kyc", "years_in_employment_business", event.target.value)} /></Field>
          </div>

          <div className="finance-simple__section">
            <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Emergency contact</p><h2>Someone we can reach</h2></div></div>
            <div className="finance-simple__grid is-three">
              <Field title="Name"><input value={data.kyc.emergency_contact_name} onChange={(event) => updateSection("kyc", "emergency_contact_name", event.target.value)} /></Field>
              <Field title="Phone"><input inputMode="tel" value={data.kyc.emergency_contact_phone} onChange={(event) => updateSection("kyc", "emergency_contact_phone", event.target.value)} /></Field>
              <Field title="Relationship"><input value={data.kyc.emergency_contact_relationship} onChange={(event) => updateSection("kyc", "emergency_contact_relationship", event.target.value)} /></Field>
            </div>
          </div>

          <div className="finance-simple__section">
            <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Guarantor</p><h2>{financedAmount >= 100000 ? "Required for this amount" : "Optional guarantor"}</h2></div></div>
            <div className="finance-simple__grid">
              <Field title="Guarantor name"><input value={data.kyc.guarantor_name} onChange={(event) => updateSection("kyc", "guarantor_name", event.target.value)} /></Field>
              <Field title="Guarantor phone"><input inputMode="tel" value={data.kyc.guarantor_phone} onChange={(event) => updateSection("kyc", "guarantor_phone", event.target.value)} /></Field>
              <Field title="Guarantor ID number"><input value={data.kyc.guarantor_id_number} onChange={(event) => updateSection("kyc", "guarantor_id_number", event.target.value)} /></Field>
              <Field title="Relationship"><input value={data.kyc.guarantor_relationship} onChange={(event) => updateSection("kyc", "guarantor_relationship", event.target.value)} /></Field>
              <Field title="Guarantor address" wide><textarea value={data.kyc.guarantor_address} onChange={(event) => updateSection("kyc", "guarantor_address", event.target.value)} /></Field>
            </div>
          </div>

          <div className="finance-simple__section">
            <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Monthly affordability</p><h2>Income and commitments</h2></div></div>
            <div className="finance-simple__grid is-three">
              <MoneyField title="Salary income" value={data.affordability.monthly_salary_income} onChange={(value) => updateSection("affordability", "monthly_salary_income", value)} />
              <MoneyField title="Business income" value={data.affordability.monthly_business_income} onChange={(value) => updateSection("affordability", "monthly_business_income", value)} />
              <MoneyField title="Other income" value={data.affordability.monthly_other_income} onChange={(value) => updateSection("affordability", "monthly_other_income", value)} />
              <MoneyField title="Business costs" value={data.affordability.monthly_business_costs} onChange={(value) => updateSection("affordability", "monthly_business_costs", value)} />
              <MoneyField title="Household expenses" value={data.affordability.monthly_household_expenses} onChange={(value) => updateSection("affordability", "monthly_household_expenses", value)} />
              <MoneyField title="Existing monthly debt" value={data.affordability.existing_monthly_debt} onChange={(value) => updateSection("affordability", "existing_monthly_debt", value)} />
              <Field title="Assessment note" wide><textarea value={data.affordability.assessment_notes} onChange={(event) => updateSection("affordability", "assessment_notes", event.target.value)} /></Field>
            </div>
          </div>

          <div className="finance-simple__grid">
            <label className="finance-simple__check"><input type="checkbox" checked={data.kyc.customer_consent_confirmed} onChange={(event) => updateSection("kyc", "customer_consent_confirmed", event.target.checked)} /><span><strong>Customer consent confirmed</strong><small>The customer agrees that these details may be used for the installment application.</small></span></label>
            <label className="finance-simple__check"><input type="checkbox" checked={data.kyc.credit_assessment_consent_confirmed} onChange={(event) => updateSection("kyc", "credit_assessment_consent_confirmed", event.target.checked)} /><span><strong>Credit assessment consent confirmed</strong><small>The customer understands the affordability and verification review.</small></span></label>
          </div>
        </section>
      ) : null}

      {!loading && step === 4 ? (
        <section className="finance-simple__panel">
          <div className="finance-simple__section-header"><div><p className="finance-simple__eyebrow">Step 5</p><h2>Review before creating the draft</h2><span className="finance-simple__muted">Nothing is delivered, reserved or transferred here. The manager must review and approve the application later.</span></div></div>
          <div className="finance-simple__summary">
            <article><span>Customer</span><strong>{selectedCustomer?.customer_name || data.customer.customer_name}</strong><small>{selectedCustomer?.phone || data.customer.phone}</small></article>
            <article><span>Excavator</span><strong>{selectedMachine ? `${selectedMachine.asset_code} — ${selectedMachine.asset_name}` : "Not selected"}</strong><small>{selectedMachine?.serial_number || selectedMachine?.chassis_number}</small></article>
            <article><span>Selling price</span><strong className="finance-simple__money">{money(data.offer.selling_price)}</strong></article>
            <article><span>Deposit</span><strong className="finance-simple__money">{money(data.offer.deposit)}</strong></article>
            <article><span>Financed balance</span><strong className="finance-simple__money">{money(financedAmount)}</strong></article>
            <article><span>Payment plan</span><strong>{data.offer.installment_count} {label(data.offer.payment_frequency)} payments</strong><small>First due {data.offer.first_due_date}</small></article>
            <article><span>Customer ID</span><strong>{data.kyc.id_type}: {data.kyc.id_number}</strong></article>
            <article><span>Guarantor</span><strong>{data.kyc.guarantor_name || "Not recorded"}</strong><small>{data.kyc.guarantor_phone}</small></article>
          </div>
          <div className="finance-simple__notice is-info">The system will automatically create an approved commercial Installment Offer and one draft credit application. KYC verification and credit approval remain separate controlled actions.</div>
        </section>
      ) : null}

      {!loading ? (
        <footer className="finance-simple__sticky-actions">
          <span>Step {step + 1} of {STEP_TITLES.length}: {STEP_TITLES[step]}</span>
          <div>
            {step > 0 ? <button type="button" onClick={goBack}>Back</button> : null}
            <button type="button" onClick={() => setNotice("Draft saved automatically on this device.")}>Save draft</button>
            {step < STEP_TITLES.length - 1 ? (
              <button className="is-primary" type="button" onClick={continueForward}>Continue</button>
            ) : (
              <button className="is-primary" type="button" onClick={submit} disabled={saving}>{saving ? "Creating draft…" : "Create Installment Draft"}</button>
            )}
          </div>
        </footer>
      ) : null}
    </main>
  );
}
