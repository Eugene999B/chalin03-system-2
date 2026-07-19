import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/employmentDocuments.css";

const today = new Date().toISOString().slice(0, 10);

const EMPTY_RECIPIENT = Object.freeze({
  full_name: "",
  preferred_name: "",
  phone: "",
  email: "",
  address: "",
});

const EMPTY_PAYLOAD = Object.freeze({
  recipient_address: "",
  role: "",
  department: "",
  work_location: "",
  employment_type: "permanent",
  start_date: "",
  salary_amount: "",
  pay_frequency: "monthly",
  probation_period: "",
  reporting_to: "",
  working_schedule: "",
  leave_terms: "",
  notice_terms: "",
  benefits: "",
  reason: "",
  incident_date: "",
  prior_action: "",
  action_required: "",
  response_instructions: "",
  suspension_terms: "",
  final_dues: "",
  property_return: "",
  handover_requirements: "",
  new_role: "",
  new_department: "",
  new_location: "",
  additional_terms: "",
  worker_agreement:
    "I confirm that I have read or had this document explained to me, understand its contents and have received a copy. My signature confirms receipt and, where acceptance is required, my agreement to the stated terms.",
  management_note: "",
  rules: [],
});

function createEmptyForm(signature, defaultRules = []) {
  return {
    recipient: { ...EMPTY_RECIPIENT },
    letter_type: "employment",
    title: "",
    subject: "",
    letter_date: today,
    effective_date: "",
    response_due_date: "",
    signatory_name: signature?.signatory_name || "",
    signatory_title: signature?.signatory_title || "Managing Director",
    payload: {
      ...EMPTY_PAYLOAD,
      start_date: today,
      rules: [...defaultRules],
    },
  };
}

function cleanDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-GB");
}

function errorMessage(error, fallback) {
  return error.response?.data?.message || error.message || fallback;
}

function Field({ label, children, full = false }) {
  return (
    <label className={`employment-field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Notice({ tone = "info", children }) {
  return <div className={`employment-notice ${tone}`}>{children}</div>;
}

function statusLabel(value) {
  return String(value || "draft").replaceAll("_", " ");
}

export default function EmploymentDocumentsPage() {
  const { workspaceCode, hasPermission } = useAuth();
  const canManage = hasPermission("workers.documents.manage");
  const canLink = hasPermission("workers.manage") || canManage;
  const [options, setOptions] = useState({
    letter_types: [],
    default_rules: [],
    legal_review_note: "",
    signature: { configured: false },
  });
  const [documents, setDocuments] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [form, setForm] = useState(() => createEmptyForm());
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [linkSelections, setLinkSelections] = useState({});
  const [customRule, setCustomRule] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const settingsPath = useMemo(() => {
    if (workspaceCode === "mining") return "/mining/document-signature-settings";
    if (workspaceCode === "equipment_hire") {
      return "/equipment-hire-operations/document-signature-settings";
    }
    return "/document-signature-settings";
  }, [workspaceCode]);

  const selectedType = form.letter_type;
  const employmentTerms = [
    "employment",
    "probation_confirmation",
    "promotion_transfer",
  ].includes(selectedType);
  const factBased = [
    "show_cause",
    "warning",
    "final_warning",
    "suspension",
    "termination",
    "probation_extension",
  ].includes(selectedType);
  const needsResponse = [
    "show_cause",
    "warning",
    "final_warning",
    "suspension",
    "probation_extension",
  ].includes(selectedType);
  const separation = ["termination", "resignation_acceptance"].includes(
    selectedType
  );

  const typeTitle = useMemo(
    () =>
      options.letter_types.find((item) => item.code === selectedType)?.title ||
      "Employment / HR Document",
    [options.letter_types, selectedType]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const requests = [
        axiosClient.get("/release2-final/standalone-hr/options"),
        axiosClient.get("/release2-final/standalone-hr/documents", {
          params: { search },
        }),
      ];
      if (canLink) {
        requests.push(
          axiosClient.get("/release2-final/workers", {
            params: { search: "" },
          })
        );
      }

      const [optionResponse, documentResponse, workerResponse] =
        await Promise.all(requests);
      const nextOptions = {
        letter_types: optionResponse.data.letter_types || [],
        default_rules: optionResponse.data.default_rules || [],
        legal_review_note: optionResponse.data.legal_review_note || "",
        signature: optionResponse.data.signature || { configured: false },
      };
      setOptions(nextOptions);
      setDocuments(documentResponse.data.documents || []);
      setWorkers(workerResponse?.data?.workers || []);
      setForm((current) =>
        editingId
          ? current
          : createEmptyForm(nextOptions.signature, nextOptions.default_rules)
      );
    } catch (requestError) {
      setError(
        errorMessage(
          requestError,
          "Standalone employment documents could not be loaded."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [canLink, editingId, search]);

  useEffect(() => {
    load();
  }, [load]);

  function setRoot(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setRecipient(key, value) {
    setForm((current) => ({
      ...current,
      recipient: { ...current.recipient, [key]: value },
    }));
  }

  function setPayload(key, value) {
    setForm((current) => ({
      ...current,
      payload: { ...current.payload, [key]: value },
    }));
  }

  function toggleRule(rule) {
    setForm((current) => {
      const selected = new Set(current.payload.rules || []);
      if (selected.has(rule)) selected.delete(rule);
      else selected.add(rule);
      return {
        ...current,
        payload: { ...current.payload, rules: [...selected] },
      };
    });
  }

  function addCustomRule() {
    const rule = customRule.trim();
    if (!rule || (form.payload.rules || []).includes(rule)) return;
    setPayload("rules", [...form.payload.rules, rule]);
    setCustomRule("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(createEmptyForm(options.signature, options.default_rules));
    setCustomRule("");
    setError("");
  }

  function editDocument(document) {
    setEditingId(document.id);
    setForm({
      recipient: {
        full_name: document.recipient_full_name || "",
        preferred_name: document.recipient_preferred_name || "",
        phone: document.recipient_phone || "",
        email: document.recipient_email || "",
        address: document.recipient_address || "",
      },
      letter_type: document.letter_type,
      title: document.title || "",
      subject: document.subject || "",
      letter_date: cleanDate(document.letter_date) || today,
      effective_date: cleanDate(document.effective_date),
      response_due_date: cleanDate(document.response_due_date),
      signatory_name: document.signatory_name || "",
      signatory_title: document.signatory_title || "",
      payload: {
        ...EMPTY_PAYLOAD,
        ...(document.payload || {}),
        rules: Array.isArray(document.payload?.rules)
          ? document.payload.rules
          : [],
      },
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveDocument(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const endpoint = editingId
        ? `/release2-final/standalone-hr/documents/${editingId}`
        : "/release2-final/standalone-hr/documents";
      const response = editingId
        ? await axiosClient.put(endpoint, form)
        : await axiosClient.post(endpoint, form);
      setMessage(response.data.message);
      resetForm();
      await load();
    } catch (requestError) {
      setError(
        errorMessage(requestError, "The standalone document could not be saved.")
      );
    } finally {
      setSaving(false);
    }
  }

  async function runAction(document, action, payload, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/release2-final/standalone-hr/documents/${document.id}/${action}`,
        payload || {}
      );
      setMessage(response.data.message);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError, "The document action could not be completed."));
    } finally {
      setSaving(false);
    }
  }

  async function openPdf(document) {
    setError("");
    try {
      const response = await axiosClient.get(
        `/release2-final/standalone-hr/documents/${document.id}/pdf`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(
        new Blob([response.data], { type: "application/pdf" })
      );
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (requestError) {
      setError(errorMessage(requestError, "The PDF could not be opened."));
    }
  }

  function acknowledge(document) {
    const name = window.prompt(
      "Enter the recipient or witness name for acknowledgement:",
      document.recipient_full_name
    );
    if (!name?.trim()) return;
    const result = window.prompt(
      "Enter accepted, received, declined or not_required:",
      document.letter_type === "employment" ? "accepted" : "received"
    );
    if (!result?.trim()) return;
    const note = window.prompt("Optional acknowledgement note:", "") || "";
    runAction(document, "acknowledge", {
      acknowledged_name: name.trim(),
      acknowledgement_status: result.trim().toLowerCase(),
      note,
    });
  }

  function archive(document) {
    const reason = window.prompt(
      `Enter the reason for archiving ${document.letter_number}. The audit record will remain:`,
      ""
    );
    if (!reason?.trim()) return;
    runAction(document, "cancel", { reason: reason.trim() });
  }

  function linkWorker(document) {
    const workerId = Number(linkSelections[document.id]);
    if (!workerId) {
      setError("Choose the registered worker profile to receive this document history.");
      return;
    }
    runAction(
      document,
      "link-worker",
      { worker_id: workerId },
      "Link this standalone document into the selected worker profile? The original standalone record will remain for audit history."
    );
  }

  if (loading) {
    return <div className="employment-loading">Loading employment documents...</div>;
  }

  return (
    <div className="employment-page">
      <header className="employment-hero">
        <div>
          <p>New Hire and HR Administration</p>
          <h1>Employment & HR Documents</h1>
          <span>
            Prepare professional letters before a person has been registered as a
            worker. After onboarding, link the finalized history into the worker
            profile without recreating the document.
          </span>
        </div>
        <div className="employment-hero-badge">
          <strong>{documents.length}</strong>
          <span>standalone records</span>
        </div>
      </header>

      {options.legal_review_note ? (
        <Notice tone="warning">{options.legal_review_note}</Notice>
      ) : null}
      {!options.signature.configured ? (
        <Notice tone="warning">
          No boss signature is configured. Drafts can be prepared, but approval is
          blocked until the authorised signature is saved in{" "}
          <Link to={settingsPath}>Document Signature Settings</Link>.
        </Notice>
      ) : (
        <Notice tone="success">
          Approval signature ready: {options.signature.signatory_name} —{" "}
          {options.signature.signatory_title}. Issued documents keep an immutable
          snapshot.
        </Notice>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {canManage ? (
        <section className="employment-card">
          <div className="employment-heading-row">
            <div>
              <p>{editingId ? "Editing saved draft" : "Person not yet registered"}</p>
              <h2>{editingId ? `Update ${typeTitle}` : typeTitle}</h2>
            </div>
            {editingId ? (
              <button type="button" className="secondary" onClick={resetForm}>
                Stop Editing
              </button>
            ) : null}
          </div>

          <form className="employment-form" onSubmit={saveDocument}>
            <div className="employment-section-title full">
              <strong>Recipient / prospective worker</strong>
              <span>No worker profile is created by this form.</span>
            </div>
            <Field label="Full name">
              <input
                value={form.recipient.full_name}
                onChange={(event) => setRecipient("full_name", event.target.value)}
                required
              />
            </Field>
            <Field label="Preferred name">
              <input
                value={form.recipient.preferred_name}
                onChange={(event) =>
                  setRecipient("preferred_name", event.target.value)
                }
              />
            </Field>
            <Field label="Phone">
              <input
                value={form.recipient.phone}
                onChange={(event) => setRecipient("phone", event.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.recipient.email}
                onChange={(event) => setRecipient("email", event.target.value)}
              />
            </Field>
            <Field label="Residential / postal address" full>
              <textarea
                value={form.recipient.address}
                onChange={(event) => setRecipient("address", event.target.value)}
              />
            </Field>

            <div className="employment-section-title full">
              <strong>Document control</strong>
              <span>All drafts are audited and finalized documents are locked.</span>
            </div>
            <Field label="Document type">
              <select
                value={form.letter_type}
                onChange={(event) => setRoot("letter_type", event.target.value)}
              >
                {options.letter_types.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Document date">
              <input
                type="date"
                value={form.letter_date}
                onChange={(event) => setRoot("letter_date", event.target.value)}
                required
              />
            </Field>
            <Field label="Title">
              <input
                value={form.title}
                onChange={(event) => setRoot("title", event.target.value)}
                placeholder={typeTitle}
              />
            </Field>
            <Field label="Subject">
              <input
                value={form.subject}
                onChange={(event) => setRoot("subject", event.target.value)}
                placeholder={typeTitle}
              />
            </Field>
            <Field label="Effective date">
              <input
                type="date"
                value={form.effective_date}
                onChange={(event) => setRoot("effective_date", event.target.value)}
              />
            </Field>
            {needsResponse ? (
              <Field label="Response / review due date">
                <input
                  type="date"
                  value={form.response_due_date}
                  onChange={(event) =>
                    setRoot("response_due_date", event.target.value)
                  }
                />
              </Field>
            ) : null}
            <Field label="Authorised signatory name">
              <input
                value={form.signatory_name}
                onChange={(event) =>
                  setRoot("signatory_name", event.target.value)
                }
                required
              />
            </Field>
            <Field label="Signatory title">
              <input
                value={form.signatory_title}
                onChange={(event) =>
                  setRoot("signatory_title", event.target.value)
                }
                required
              />
            </Field>

            {employmentTerms ? (
              <>
                <div className="employment-section-title full">
                  <strong>Employment terms</strong>
                  <span>Only completed fields appear in the PDF.</span>
                </div>
                <Field label="Role">
                  <input
                    value={form.payload.role}
                    onChange={(event) => setPayload("role", event.target.value)}
                    required={selectedType === "employment"}
                  />
                </Field>
                <Field label="Department">
                  <input
                    value={form.payload.department}
                    onChange={(event) =>
                      setPayload("department", event.target.value)
                    }
                  />
                </Field>
                <Field label="Work location">
                  <input
                    value={form.payload.work_location}
                    onChange={(event) =>
                      setPayload("work_location", event.target.value)
                    }
                    placeholder="Store, mining site, base or yard"
                  />
                </Field>
                <Field label="Employment type">
                  <select
                    value={form.payload.employment_type}
                    onChange={(event) =>
                      setPayload("employment_type", event.target.value)
                    }
                  >
                    <option value="permanent">Permanent</option>
                    <option value="contract">Contract</option>
                    <option value="temporary">Temporary</option>
                    <option value="casual">Casual</option>
                  </select>
                </Field>
                <Field label="Start date">
                  <input
                    type="date"
                    value={form.payload.start_date}
                    onChange={(event) =>
                      setPayload("start_date", event.target.value)
                    }
                    required={selectedType === "employment"}
                  />
                </Field>
                <Field label="Salary (GHS)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.payload.salary_amount}
                    onChange={(event) =>
                      setPayload("salary_amount", event.target.value)
                    }
                  />
                </Field>
                <Field label="Pay frequency">
                  <input
                    value={form.payload.pay_frequency}
                    onChange={(event) =>
                      setPayload("pay_frequency", event.target.value)
                    }
                  />
                </Field>
                <Field label="Probation period">
                  <input
                    value={form.payload.probation_period}
                    onChange={(event) =>
                      setPayload("probation_period", event.target.value)
                    }
                    placeholder="Example: Three months"
                  />
                </Field>
                <Field label="Reports to">
                  <input
                    value={form.payload.reporting_to}
                    onChange={(event) =>
                      setPayload("reporting_to", event.target.value)
                    }
                  />
                </Field>
                <Field label="Working schedule">
                  <input
                    value={form.payload.working_schedule}
                    onChange={(event) =>
                      setPayload("working_schedule", event.target.value)
                    }
                    placeholder="Days, hours and shifts"
                  />
                </Field>
                <Field label="Leave terms" full>
                  <textarea
                    value={form.payload.leave_terms}
                    onChange={(event) =>
                      setPayload("leave_terms", event.target.value)
                    }
                  />
                </Field>
                <Field label="Notice terms" full>
                  <textarea
                    value={form.payload.notice_terms}
                    onChange={(event) =>
                      setPayload("notice_terms", event.target.value)
                    }
                  />
                </Field>
                <Field label="Benefits / allowances" full>
                  <textarea
                    value={form.payload.benefits}
                    onChange={(event) =>
                      setPayload("benefits", event.target.value)
                    }
                  />
                </Field>
              </>
            ) : null}

            {selectedType === "promotion_transfer" ? (
              <>
                <Field label="New role">
                  <input
                    value={form.payload.new_role}
                    onChange={(event) =>
                      setPayload("new_role", event.target.value)
                    }
                  />
                </Field>
                <Field label="New department">
                  <input
                    value={form.payload.new_department}
                    onChange={(event) =>
                      setPayload("new_department", event.target.value)
                    }
                  />
                </Field>
                <Field label="New location" full>
                  <input
                    value={form.payload.new_location}
                    onChange={(event) =>
                      setPayload("new_location", event.target.value)
                    }
                  />
                </Field>
              </>
            ) : null}

            {factBased ? (
              <>
                <div className="employment-section-title full">
                  <strong>Factual and procedural details</strong>
                  <span>Management must verify the evidence before approval.</span>
                </div>
                <Field label="Incident date">
                  <input
                    type="date"
                    value={form.payload.incident_date}
                    onChange={(event) =>
                      setPayload("incident_date", event.target.value)
                    }
                  />
                </Field>
                <Field label="Reason and factual details" full>
                  <textarea
                    value={form.payload.reason}
                    onChange={(event) =>
                      setPayload("reason", event.target.value)
                    }
                    required
                  />
                </Field>
                <Field label="Previous discussion / warning / evidence" full>
                  <textarea
                    value={form.payload.prior_action}
                    onChange={(event) =>
                      setPayload("prior_action", event.target.value)
                    }
                  />
                </Field>
                <Field label="Required improvement or action" full>
                  <textarea
                    value={form.payload.action_required}
                    onChange={(event) =>
                      setPayload("action_required", event.target.value)
                    }
                  />
                </Field>
                <Field label="Response instructions" full>
                  <textarea
                    value={form.payload.response_instructions}
                    onChange={(event) =>
                      setPayload("response_instructions", event.target.value)
                    }
                  />
                </Field>
              </>
            ) : null}

            {selectedType === "suspension" ? (
              <Field label="Suspension terms" full>
                <textarea
                  value={form.payload.suspension_terms}
                  onChange={(event) =>
                    setPayload("suspension_terms", event.target.value)
                  }
                  placeholder="Duration, pay status, access restrictions and reporting instructions"
                />
              </Field>
            ) : null}

            {separation ? (
              <>
                <Field label="Final remuneration and benefits" full>
                  <textarea
                    value={form.payload.final_dues}
                    onChange={(event) =>
                      setPayload("final_dues", event.target.value)
                    }
                  />
                </Field>
                <Field label="Handover requirements" full>
                  <textarea
                    value={form.payload.handover_requirements}
                    onChange={(event) =>
                      setPayload("handover_requirements", event.target.value)
                    }
                  />
                </Field>
                <Field label="Return of company property" full>
                  <textarea
                    value={form.payload.property_return}
                    onChange={(event) =>
                      setPayload("property_return", event.target.value)
                    }
                  />
                </Field>
              </>
            ) : null}

            {selectedType === "employment" ? (
              <div className="employment-rules full">
                <div className="employment-heading-row">
                  <div>
                    <p>Management-approved starter list</p>
                    <h3>Rules and Regulations</h3>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setPayload("rules", [...options.default_rules])
                    }
                  >
                    Select All
                  </button>
                </div>
                <div className="employment-rule-grid">
                  {options.default_rules.map((rule) => (
                    <label key={rule}>
                      <input
                        type="checkbox"
                        checked={(form.payload.rules || []).includes(rule)}
                        onChange={() => toggleRule(rule)}
                      />
                      <span>{rule}</span>
                    </label>
                  ))}
                </div>
                <div className="employment-custom-rule">
                  <input
                    value={customRule}
                    onChange={(event) => setCustomRule(event.target.value)}
                    placeholder="Additional custom rule"
                  />
                  <button type="button" className="secondary" onClick={addCustomRule}>
                    Add Rule
                  </button>
                </div>
              </div>
            ) : null}

            <Field label="Additional terms / closing details" full>
              <textarea
                value={form.payload.additional_terms}
                onChange={(event) =>
                  setPayload("additional_terms", event.target.value)
                }
              />
            </Field>
            <Field label="Recipient agreement / acknowledgement wording" full>
              <textarea
                value={form.payload.worker_agreement}
                onChange={(event) =>
                  setPayload("worker_agreement", event.target.value)
                }
              />
            </Field>
            <Field label="Management note included in document" full>
              <textarea
                value={form.payload.management_note}
                onChange={(event) =>
                  setPayload("management_note", event.target.value)
                }
              />
            </Field>

            <div className="employment-actions full">
              <button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Draft"
                    : "Save Standalone Draft"}
              </button>
              <button type="button" className="secondary" onClick={resetForm}>
                Clear Form
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="employment-card">
        <div className="employment-heading-row">
          <div>
            <p>Independent hiring and HR history</p>
            <h2>Saved Standalone Documents</h2>
          </div>
          <div className="employment-search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or document number"
            />
            <button type="button" className="secondary" onClick={load}>
              Search
            </button>
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="employment-empty">No standalone HR documents have been created.</div>
        ) : (
          <div className="employment-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Document</th>
                  <th>Date / status</th>
                  <th>Worker profile link</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <strong>{document.recipient_full_name}</strong>
                      <span>{document.recipient_phone || document.recipient_email || "No contact entered"}</span>
                    </td>
                    <td>
                      <strong>{document.letter_number || "Draft"}</strong>
                      <span>{document.title}</span>
                    </td>
                    <td>
                      <strong>{formatDate(document.letter_date)}</strong>
                      <span className={`employment-status ${document.status}`}>
                        {statusLabel(document.status)}
                      </span>
                    </td>
                    <td>
                      {document.linked_worker_id ? (
                        <div className="employment-linked">
                          <strong>{document.linked_worker_number}</strong>
                          <span>{document.linked_worker_name}</span>
                        </div>
                      ) : canLink ? (
                        <div className="employment-link-control">
                          <select
                            value={linkSelections[document.id] || ""}
                            onChange={(event) =>
                              setLinkSelections((current) => ({
                                ...current,
                                [document.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Choose registered worker</option>
                            {workers.map((worker) => (
                              <option key={worker.id} value={worker.id}>
                                {worker.employee_number} — {worker.full_name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="secondary compact"
                            onClick={() => linkWorker(document)}
                            disabled={saving}
                          >
                            Link
                          </button>
                        </div>
                      ) : (
                        <span>Not linked</span>
                      )}
                    </td>
                    <td>
                      <div className="employment-row-actions">
                        <button
                          type="button"
                          className="secondary compact"
                          onClick={() => openPdf(document)}
                        >
                          PDF
                        </button>
                        {canManage && document.status === "draft" ? (
                          <>
                            <button
                              type="button"
                              className="secondary compact"
                              onClick={() => editDocument(document)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="compact"
                              disabled={saving || !options.signature.configured}
                              onClick={() =>
                                runAction(
                                  document,
                                  "issue",
                                  {},
                                  `Approve, sign and permanently lock ${document.letter_number}?`
                                )
                              }
                            >
                              Approve & Sign
                            </button>
                          </>
                        ) : null}
                        {canManage && ["issued", "acknowledged"].includes(document.status) ? (
                          <button
                            type="button"
                            className="secondary compact"
                            onClick={() => acknowledge(document)}
                          >
                            Acknowledge
                          </button>
                        ) : null}
                        {canManage && document.status !== "cancelled" ? (
                          <button
                            type="button"
                            className="danger compact"
                            onClick={() => archive(document)}
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
