import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import EquipmentFinanceStartWizardPage from "./EquipmentFinanceStartWizardPage.jsx";
import "../styles/equipmentFinanceCustomerProfileRestore.css";

const CURRENT_DRAFT_KEY = "chalin03.finance.start-installment.v2";
const LEGACY_AUTOSAVE_KEY = "chalin03.finance.start-installment.v1";

const CUSTOMER_TYPES = [
  ["individual", "Individual"],
  ["company", "Registered company"],
  ["contractor", "Contractor / sole business"],
  ["government", "Government institution"],
];

const EMPLOYMENT_TYPES = [
  ["", "Not recorded yet"],
  ["salaried", "Salaried employee"],
  ["self_employed", "Self-employed / business owner"],
  ["contractor", "Contractor"],
  ["pensioner", "Pensioner"],
  ["farmer", "Farmer"],
  ["other", "Other"],
];

const ID_TYPES = [
  "Ghana Card",
  "Non-Citizen Ghana Card",
  "Passport",
  "Driver Licence",
  "Other",
];

function readJson(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function splitResidentialAddress(value) {
  const lines = String(value || "").split(/\r?\n/);
  const addressLines = [];
  let digitalAddress = "";

  for (const line of lines) {
    const match = /^\s*(?:GhanaPost GPS|Digital address)\s*:\s*(.+)$/i.exec(line);
    if (match) digitalAddress = match[1].trim();
    else if (line.trim()) addressLines.push(line.trim());
  }

  return {
    residential_address: addressLines.join("\n"),
    digital_address: digitalAddress,
  };
}

function composeResidentialAddress(address, digitalAddress) {
  return [
    text(address),
    text(digitalAddress) ? `GhanaPost GPS: ${text(digitalAddress)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function emptyProfile() {
  return {
    customer: {
      customer_name: "",
      customer_type: "individual",
      phone: "",
      whatsapp_phone: "",
      email: "",
      address: "",
      contact_person: "",
      risk_notes: "",
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
      digital_address: "",
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
      verification_notes: "",
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

function profileFromDraft(draft = {}) {
  const base = emptyProfile();
  const currentKyc = { ...base.kyc, ...(draft.kyc || {}) };
  const addresses = splitResidentialAddress(
    currentKyc.residential_address || draft.customer?.address || ""
  );

  return {
    customer: { ...base.customer, ...(draft.customer || {}) },
    kyc: {
      ...currentKyc,
      residential_address: addresses.residential_address,
      digital_address:
        currentKyc.digital_address || addresses.digital_address || "",
    },
    affordability: {
      ...base.affordability,
      ...(draft.affordability || {}),
    },
  };
}

function latestDraft() {
  return readJson(CURRENT_DRAFT_KEY) || readJson(LEGACY_AUTOSAVE_KEY) || {};
}

function Field({ title, hint = "", wide = false, children }) {
  return (
    <label className={`finance-profile__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Section({ number, title, description, children }) {
  return (
    <section className="finance-profile__section">
      <header>
        <b>{number}</b>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function MoneyInput({ value, onChange }) {
  return (
    <input
      inputMode="decimal"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/[^0-9.,]/g, ""))}
      placeholder="0.00"
    />
  );
}

export default function EquipmentFinanceStartWizardEnhancedPage() {
  const [profile, setProfile] = useState(() => profileFromDraft(latestDraft()));
  const [expanded, setExpanded] = useState(true);
  const [wizardVersion, setWizardVersion] = useState(0);
  const [notice, setNotice] = useState("");

  useLayoutEffect(() => {
    const current = window.localStorage.getItem(CURRENT_DRAFT_KEY);
    const legacy = window.localStorage.getItem(LEGACY_AUTOSAVE_KEY);
    if (!current && legacy) window.localStorage.setItem(CURRENT_DRAFT_KEY, legacy);
  }, []);

  useEffect(() => {
    const current = window.localStorage.getItem(CURRENT_DRAFT_KEY);
    if (current) window.localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
  }, [wizardVersion]);

  const completion = useMemo(() => {
    const checks = [
      text(profile.customer.customer_name) && text(profile.customer.phone),
      text(profile.kyc.id_number) && text(profile.kyc.nationality),
      text(profile.kyc.residential_address) && text(profile.kyc.digital_address),
      text(profile.kyc.employment_type) && text(profile.kyc.occupation),
      text(profile.kyc.emergency_contact_name) &&
        text(profile.kyc.emergency_contact_phone),
      Number(profile.affordability.monthly_salary_income || 0) +
        Number(profile.affordability.monthly_business_income || 0) +
        Number(profile.affordability.monthly_other_income || 0) >
        0,
      profile.kyc.customer_consent_confirmed &&
        profile.kyc.credit_assessment_consent_confirmed,
    ];
    return {
      completed: checks.filter(Boolean).length,
      total: checks.length,
    };
  }, [profile]);

  function update(group, field, value) {
    setProfile((current) => ({
      ...current,
      [group]: { ...current[group], [field]: value },
    }));
  }

  function reloadProfile() {
    setProfile(profileFromDraft(latestDraft()));
    setNotice("Customer details reloaded from the current installment draft.");
  }

  function saveProfile(event) {
    event.preventDefault();
    const existing = latestDraft();
    const residentialAddress = composeResidentialAddress(
      profile.kyc.residential_address,
      profile.kyc.digital_address
    );
    const nextDraft = {
      ...existing,
      customerMode: existing.customerMode || "new",
      customer: {
        ...(existing.customer || {}),
        ...profile.customer,
        address: profile.customer.address || residentialAddress,
      },
      kyc: {
        ...(existing.kyc || {}),
        ...profile.kyc,
        digital_address: profile.kyc.digital_address,
        residential_address: residentialAddress,
        customer_address_snapshot:
          profile.customer.address || residentialAddress,
        customer_name_snapshot: profile.customer.customer_name,
        customer_phone_snapshot: profile.customer.phone,
        customer_email_snapshot: profile.customer.email,
      },
      affordability: {
        ...(existing.affordability || {}),
        ...profile.affordability,
      },
    };

    writeJson(CURRENT_DRAFT_KEY, nextDraft);
    writeJson(LEGACY_AUTOSAVE_KEY, nextDraft);
    setWizardVersion((current) => current + 1);
    setNotice(
      "Complete customer details saved into this installment draft. The guided steps below have been refreshed."
    );
  }

  return (
    <>
      <section className="finance-profile">
        <header className="finance-profile__hero">
          <div>
            <p>Complete customer record</p>
            <h2>Customer Profile, KYC &amp; Affordability</h2>
            <span>
              The details were restored. Only the customer legal name and primary phone
              are required to create a draft; identity, residence, employment, emergency
              contact, guarantor, affordability and consent remain visible for completion
              before submission and approval.
            </span>
          </div>
          <div className="finance-profile__status">
            <strong>{completion.completed}/{completion.total}</strong>
            <span>profile sections ready</span>
            <button type="button" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Hide profile" : "Open full profile"}
            </button>
          </div>
        </header>

        <div className="finance-profile__notice">
          <strong>Draft rule:</strong> missing optional information does not stop draft
          creation. It must be completed and independently verified before the application
          can be submitted or approved. Ghana Card and supporting documents should be
          placed in the private case-document vault after the draft is created—not in a
          public file link.
        </div>

        {notice ? <div className="finance-profile__saved">{notice}</div> : null}

        {expanded ? (
          <form className="finance-profile__form" onSubmit={saveProfile}>
            <Section
              number="1"
              title="Customer identity and contact"
              description="Record the legal person or organisation that will sign the installment documents."
            >
              <div className="finance-profile__grid">
                <Field title="Full legal name / registered business name" hint="Required to create a new-customer draft">
                  <input
                    value={profile.customer.customer_name}
                    onChange={(event) =>
                      update("customer", "customer_name", event.target.value)
                    }
                  />
                </Field>
                <Field title="Customer type">
                  <select
                    value={profile.customer.customer_type}
                    onChange={(event) =>
                      update("customer", "customer_type", event.target.value)
                    }
                  >
                    {CUSTOMER_TYPES.map(([value, title]) => (
                      <option key={value} value={value}>{title}</option>
                    ))}
                  </select>
                </Field>
                <Field title="Primary phone number" hint="Required to create a new-customer draft">
                  <input
                    inputMode="tel"
                    value={profile.customer.phone}
                    onChange={(event) => update("customer", "phone", event.target.value)}
                  />
                </Field>
                <Field title="WhatsApp / alternative phone" hint="Optional">
                  <input
                    inputMode="tel"
                    value={profile.customer.whatsapp_phone}
                    onChange={(event) =>
                      update("customer", "whatsapp_phone", event.target.value)
                    }
                  />
                </Field>
                <Field title="Email address" hint="Optional">
                  <input
                    type="email"
                    value={profile.customer.email}
                    onChange={(event) => update("customer", "email", event.target.value)}
                  />
                </Field>
                <Field
                  title="Contact person / authorised representative"
                  hint="Useful for a company, contractor or government customer"
                >
                  <input
                    value={profile.customer.contact_person}
                    onChange={(event) =>
                      update("customer", "contact_person", event.target.value)
                    }
                  />
                </Field>
                <Field title="Customer correspondence address" wide hint="Optional for draft">
                  <textarea
                    rows="2"
                    value={profile.customer.address}
                    onChange={(event) => update("customer", "address", event.target.value)}
                  />
                </Field>
              </div>
            </Section>

            <Section
              number="2"
              title="Official identity and residence"
              description="Capture the information used to identify and locate the customer."
            >
              <div className="finance-profile__grid">
                <Field title="ID type" hint="Ghana Card is preferred for Ghanaian financial transactions">
                  <select
                    value={profile.kyc.id_type}
                    onChange={(event) => update("kyc", "id_type", event.target.value)}
                  >
                    {ID_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </Field>
                <Field title="ID number" hint="Optional for draft; complete before submission">
                  <input
                    value={profile.kyc.id_number}
                    onChange={(event) => update("kyc", "id_number", event.target.value)}
                  />
                </Field>
                <Field title="Date of birth" hint="For an individual customer">
                  <input
                    type="date"
                    value={profile.kyc.date_of_birth}
                    onChange={(event) =>
                      update("kyc", "date_of_birth", event.target.value)
                    }
                  />
                </Field>
                <Field title="Nationality / residency">
                  <input
                    value={profile.kyc.nationality}
                    onChange={(event) => update("kyc", "nationality", event.target.value)}
                  />
                </Field>
                <Field title="Residential / physical address" wide hint="House, street, town and district">
                  <textarea
                    rows="2"
                    value={profile.kyc.residential_address}
                    onChange={(event) =>
                      update("kyc", "residential_address", event.target.value)
                    }
                  />
                </Field>
                <Field title="GhanaPost GPS / digital address" hint="For example: AK-123-4567">
                  <input
                    value={profile.kyc.digital_address}
                    onChange={(event) =>
                      update("kyc", "digital_address", event.target.value.toUpperCase())
                    }
                  />
                </Field>
                <Field title="Years at current residence" hint="Optional">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={profile.kyc.years_at_residence}
                    onChange={(event) =>
                      update("kyc", "years_at_residence", event.target.value)
                    }
                  />
                </Field>
              </div>
            </Section>

            <Section
              number="3"
              title="Employment or business profile"
              description="Record how the customer earns income and where the activity can be verified."
            >
              <div className="finance-profile__grid">
                <Field title="Employment / business type">
                  <select
                    value={profile.kyc.employment_type}
                    onChange={(event) =>
                      update("kyc", "employment_type", event.target.value)
                    }
                  >
                    {EMPLOYMENT_TYPES.map(([value, title]) => (
                      <option key={value || "empty"} value={value}>{title}</option>
                    ))}
                  </select>
                </Field>
                <Field title="Occupation / main activity">
                  <input
                    value={profile.kyc.occupation}
                    onChange={(event) => update("kyc", "occupation", event.target.value)}
                  />
                </Field>
                <Field title="Employer / business name">
                  <input
                    value={profile.kyc.employer_business_name}
                    onChange={(event) =>
                      update("kyc", "employer_business_name", event.target.value)
                    }
                  />
                </Field>
                <Field title="Business registration number" hint="When the customer operates a registered business">
                  <input
                    value={profile.kyc.business_registration_number}
                    onChange={(event) =>
                      update("kyc", "business_registration_number", event.target.value)
                    }
                  />
                </Field>
                <Field title="Work / business address" wide>
                  <textarea
                    rows="2"
                    value={profile.kyc.work_address}
                    onChange={(event) => update("kyc", "work_address", event.target.value)}
                  />
                </Field>
                <Field title="Years in employment / business">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={profile.kyc.years_in_employment_business}
                    onChange={(event) =>
                      update("kyc", "years_in_employment_business", event.target.value)
                    }
                  />
                </Field>
              </div>
            </Section>

            <Section
              number="4"
              title="Emergency or next-of-kin contact"
              description="Record a trusted person who can be contacted when the customer cannot be reached."
            >
              <div className="finance-profile__grid">
                <Field title="Contact name">
                  <input
                    value={profile.kyc.emergency_contact_name}
                    onChange={(event) =>
                      update("kyc", "emergency_contact_name", event.target.value)
                    }
                  />
                </Field>
                <Field title="Contact phone">
                  <input
                    inputMode="tel"
                    value={profile.kyc.emergency_contact_phone}
                    onChange={(event) =>
                      update("kyc", "emergency_contact_phone", event.target.value)
                    }
                  />
                </Field>
                <Field title="Relationship to customer">
                  <input
                    value={profile.kyc.emergency_contact_relationship}
                    onChange={(event) =>
                      update("kyc", "emergency_contact_relationship", event.target.value)
                    }
                  />
                </Field>
              </div>
            </Section>

            <Section
              number="5"
              title="Monthly affordability"
              description="Capture monthly-equivalent income, costs and existing debt for the credit assessment."
            >
              <div className="finance-profile__grid">
                <Field title="Salary income"><MoneyInput value={profile.affordability.monthly_salary_income} onChange={(value) => update("affordability", "monthly_salary_income", value)} /></Field>
                <Field title="Business income"><MoneyInput value={profile.affordability.monthly_business_income} onChange={(value) => update("affordability", "monthly_business_income", value)} /></Field>
                <Field title="Other income"><MoneyInput value={profile.affordability.monthly_other_income} onChange={(value) => update("affordability", "monthly_other_income", value)} /></Field>
                <Field title="Business operating costs"><MoneyInput value={profile.affordability.monthly_business_costs} onChange={(value) => update("affordability", "monthly_business_costs", value)} /></Field>
                <Field title="Household expenses"><MoneyInput value={profile.affordability.monthly_household_expenses} onChange={(value) => update("affordability", "monthly_household_expenses", value)} /></Field>
                <Field title="Existing monthly debt"><MoneyInput value={profile.affordability.existing_monthly_debt} onChange={(value) => update("affordability", "existing_monthly_debt", value)} /></Field>
                <Field title="Assessment notes" wide hint="Seasonal income, exceptional costs, income source or intended machine use">
                  <textarea
                    rows="3"
                    value={profile.affordability.assessment_notes}
                    onChange={(event) =>
                      update("affordability", "assessment_notes", event.target.value)
                    }
                  />
                </Field>
              </div>
            </Section>

            <Section
              number="6"
              title="Guarantor details"
              description="Keep the complete guarantor record visible. The policy may require it before submission for higher exposure."
            >
              <div className="finance-profile__grid">
                <Field title="Guarantor full name">
                  <input value={profile.kyc.guarantor_name} onChange={(event) => update("kyc", "guarantor_name", event.target.value)} />
                </Field>
                <Field title="Guarantor phone">
                  <input inputMode="tel" value={profile.kyc.guarantor_phone} onChange={(event) => update("kyc", "guarantor_phone", event.target.value)} />
                </Field>
                <Field title="Relationship to customer">
                  <input value={profile.kyc.guarantor_relationship} onChange={(event) => update("kyc", "guarantor_relationship", event.target.value)} />
                </Field>
                <Field title="Guarantor ID type">
                  <select value={profile.kyc.guarantor_id_type} onChange={(event) => update("kyc", "guarantor_id_type", event.target.value)}>
                    {ID_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </Field>
                <Field title="Guarantor ID number">
                  <input value={profile.kyc.guarantor_id_number} onChange={(event) => update("kyc", "guarantor_id_number", event.target.value)} />
                </Field>
                <Field title="Guarantor residential address" wide>
                  <textarea rows="2" value={profile.kyc.guarantor_address} onChange={(event) => update("kyc", "guarantor_address", event.target.value)} />
                </Field>
              </div>
            </Section>

            <Section
              number="7"
              title="Consent and internal KYC notes"
              description="Record the customer's permission and any verification facts the reviewer must know."
            >
              <div className="finance-profile__checks">
                <label>
                  <input
                    type="checkbox"
                    checked={profile.kyc.customer_consent_confirmed}
                    onChange={(event) =>
                      update("kyc", "customer_consent_confirmed", event.target.checked)
                    }
                  />
                  <span>
                    <strong>Customer information and contract consent confirmed</strong>
                    <small>The customer understands why the information is collected and how it supports the installment application.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={profile.kyc.credit_assessment_consent_confirmed}
                    onChange={(event) =>
                      update("kyc", "credit_assessment_consent_confirmed", event.target.checked)
                    }
                  />
                  <span>
                    <strong>Credit and affordability assessment consent confirmed</strong>
                    <small>The customer permits the company to review supplied identity, income, address and guarantor evidence for this application.</small>
                  </span>
                </label>
              </div>
              <div className="finance-profile__grid">
                <Field title="Verification / risk notes" wide hint="Internal authorised staff only">
                  <textarea
                    rows="3"
                    value={profile.kyc.verification_notes}
                    onChange={(event) =>
                      update("kyc", "verification_notes", event.target.value)
                    }
                  />
                </Field>
              </div>
            </Section>

            <div className="finance-profile__actions">
              <button type="button" onClick={reloadProfile}>Reload current draft</button>
              <button className="is-primary" type="submit">Save profile into installment draft</button>
            </div>
          </form>
        ) : null}
      </section>

      <EquipmentFinanceStartWizardPage key={wizardVersion} />
    </>
  );
}
