// Administrative document generation only. This interface does not recommend, rank, discipline, dismiss, or otherwise decide employment outcomes. An authorised human manager selects the worker and document after independent review.
import { useCallback, useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import "../styles/workerHrLetters.css";

const today = new Date().toISOString().slice(0, 10);

const EMPTY_PAYLOAD = Object.freeze({
  recipient_address: "",
  role: "",
  department: "",
  work_location: "",
  employment_type: "",
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
    "I confirm that I have read or had this letter explained to me, understand its contents, and have received a copy. My signature confirms receipt and, where the letter requires acceptance, my agreement to the stated terms.",
  management_note: "",
  rules: [],
});

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

function initialForm(worker, defaultRules = []) {
  return {
    letter_type: "employment",
    title: "",
    subject: "",
    letter_date: today,
    effective_date: "",
    response_due_date: "",
    signatory_name: "",
    signatory_title: "Managing Director",
    payload: {
      ...EMPTY_PAYLOAD,
      role: worker?.job_title || "",
      department: worker?.department || "",
      employment_type: worker?.employment_type || "",
      start_date: cleanDate(worker?.employment_start_date),
      reporting_to: worker?.supervisor_name || "",
      rules: [...defaultRules],
    },
  };
}

function Field({ label, children, full = false }) {
  return (
    <label className={`worker-hr-field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Notice({ type = "info", children }) {
  return <div className={`worker-hr-notice ${type}`}>{children}</div>;
}

export default function WorkerHrLettersPanel({
  worker,
  canView,
  canManage,
  openPdf,
  onMessage,
  onError,
}) {
  const workerId = worker?.id;
  const [options, setOptions] = useState({
    letter_types: [],
    default_rules: [],
    legal_review_note: "",
  });
  const [letters, setLetters] = useState([]);
  const [form, setForm] = useState(() => initialForm(worker));
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const [acknowledgement, setAcknowledgement] = useState({
    letter_id: "",
    acknowledgement_status: "received",
    acknowledged_name: worker?.full_name || "",
    note: "",
  });

  const selectedType = form.letter_type;
  const factBasedNotice = [
    "show_cause",
    "warning",
    "final_warning",
    "suspension",
    "termination",
    "probation_extension",
  ].includes(selectedType);
  const employmentTerms = [
    "employment",
    "probation_confirmation",
    "promotion_transfer",
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

  const typeTitle = useMemo(() => {
    return (
      options.letter_types.find((item) => item.code === selectedType)?.title ||
      "Worker HR Letter"
    );
  }, [options.letter_types, selectedType]);

  const load = useCallback(async function loadLetters() {
    if (!workerId || !canView) return;
    setLoading(true);
    setLocalError("");

    try {
      const [optionResponse, letterResponse] = await Promise.all([
        axiosClient.get(
          `/release2-final/workers-expanded/${workerId}/hr-letter-options`
        ),
        axiosClient.get(
          `/release2-final/workers-expanded/${workerId}/hr-letters`
        ),
      ]);

      const nextOptions = {
        letter_types: optionResponse.data.letter_types || [],
        default_rules: optionResponse.data.default_rules || [],
        legal_review_note: optionResponse.data.legal_review_note || "",
      };

      setOptions(nextOptions);
      setLetters(letterResponse.data.letters || []);
      setForm((current) => {
        if (editingId) return current;
        return initialForm(worker, nextOptions.default_rules);
      });
      setAcknowledgement((current) => ({
        ...current,
        acknowledged_name: current.acknowledged_name || worker?.full_name || "",
      }));
    } catch (error) {
      const message = errorMessage(
        error,
        "Worker HR correspondence could not be loaded."
      );
      setLocalError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [workerId, canView, editingId, onError, worker]);

  useEffect(() => {
    setEditingId(null);
    setForm(initialForm(worker));
    setAcknowledgement({
      letter_id: "",
      acknowledgement_status: "received",
      acknowledged_name: worker?.full_name || "",
      note: "",
    });
  }, [workerId, worker]);

  useEffect(() => {
    load();
  }, [load]);

  function setRoot(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
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

  function resetForm() {
    setEditingId(null);
    setForm(initialForm(worker, options.default_rules));
    setLocalError("");
  }

  function editDraft(letter) {
    setEditingId(letter.id);
    setForm({
      letter_type: letter.letter_type,
      title: letter.title || "",
      subject: letter.subject || "",
      letter_date: cleanDate(letter.letter_date) || today,
      effective_date: cleanDate(letter.effective_date),
      response_due_date: cleanDate(letter.response_due_date),
      signatory_name: letter.signatory_name || "",
      signatory_title: letter.signatory_title || "",
      payload: {
        ...EMPTY_PAYLOAD,
        ...(letter.payload || {}),
        rules: Array.isArray(letter.payload?.rules)
          ? letter.payload.rules
          : [],
      },
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveLetter(event) {
    event.preventDefault();
    setSaving(true);
    setLocalError("");

    try {
      const endpoint = editingId
        ? `/release2-final/workers-expanded/${workerId}/hr-letters/${editingId}`
        : `/release2-final/workers-expanded/${workerId}/hr-letters`;
      const response = editingId
        ? await axiosClient.put(endpoint, form)
        : await axiosClient.post(endpoint, form);

      onMessage?.(response.data.message);
      resetForm();
      await load();
    } catch (error) {
      const message = errorMessage(error, "The worker HR letter could not be saved.");
      setLocalError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  }

  async function finalizeLetter(letter) {
    if (
      !window.confirm(
        `Finalize and lock ${letter.letter_number}? Locked documents cannot be edited.`
      )
    ) {
      return;
    }

    setSaving(true);
    setLocalError("");
    try {
      const response = await axiosClient.post(
        `/release2-final/workers-expanded/${workerId}/hr-letters/${letter.id}/issue`
      );
      onMessage?.(response.data.message);
      await load();
    } catch (error) {
      const message = errorMessage(error, "The document could not be finalized.");
      setLocalError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  }

  async function archiveLetter(letter) {
    const reason = window.prompt(
      `Enter the reason for archiving ${letter.letter_number}. The record will remain in history.`
    );
    if (!reason?.trim()) return;

    setSaving(true);
    setLocalError("");
    try {
      const response = await axiosClient.post(
        `/release2-final/workers-expanded/${workerId}/hr-letters/${letter.id}/cancel`,
        { reason: reason.trim() }
      );
      onMessage?.(response.data.message);
      await load();
    } catch (error) {
      const message = errorMessage(error, "The document could not be archived.");
      setLocalError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveAcknowledgement(event) {
    event.preventDefault();
    const letterId = Number(acknowledgement.letter_id);
    if (!letterId) {
      setLocalError("Choose a finalized document first.");
      return;
    }

    setSaving(true);
    setLocalError("");
    try {
      const response = await axiosClient.post(
        `/release2-final/workers-expanded/${workerId}/hr-letters/${letterId}/acknowledge`,
        acknowledgement
      );
      onMessage?.(response.data.message);
      setAcknowledgement({
        letter_id: "",
        acknowledgement_status: "received",
        acknowledged_name: worker?.full_name || "",
        note: "",
      });
      await load();
    } catch (error) {
      const message = errorMessage(
        error,
        "Worker signature or receipt evidence could not be recorded."
      );
      setLocalError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <Notice type="warning">
        You need Worker Documents viewing permission to see employment and
        HR correspondence.
      </Notice>
    );
  }

  if (loading) {
    return <div className="worker-hr-loading">Loading worker HR letters...</div>;
  }

  return (
    <div className="worker-hr-stack">
      <section className="worker-hr-card worker-hr-intro">
        <div>
          <p>Linked directly to {worker.full_name}</p>
          <h3>Employment Letters and HR Correspondence</h3>
          <span>
            Prepare appointment, confirmation, workplace notice, written warning,
            suspension notice, employment separation, promotion/transfer and
            resignation-acceptance documents. A human manager supplies and reviews
            every fact before a document is finalized.
          </span>
        </div>
        <div className="worker-hr-worker-summary">
          <strong>{worker.employee_number}</strong>
          <span>{worker.job_title || "Role not set"}</span>
          <span>{worker.department || "Department not set"}</span>
        </div>
      </section>

      {options.legal_review_note ? (
        <Notice type="warning">{options.legal_review_note}</Notice>
      ) : null}
      {localError ? <Notice type="error">{localError}</Notice> : null}

      {canManage ? (
        <section className="worker-hr-card">
          <div className="worker-hr-heading-row">
            <div>
              <p>{editingId ? "Editing saved draft" : "New HR document"}</p>
              <h3>{editingId ? `Update ${typeTitle}` : typeTitle}</h3>
            </div>
            {editingId ? (
              <button type="button" className="secondary" onClick={resetForm}>
                Stop Editing
              </button>
            ) : null}
          </div>

          <form className="worker-hr-form" onSubmit={saveLetter}>
            <Field label="Letter type">
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

            <Field label="Letter date">
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

            <Field label="Authorised boss / signatory name">
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

            <Field label="Worker address" full>
              <textarea
                value={form.payload.recipient_address}
                onChange={(event) =>
                  setPayload("recipient_address", event.target.value)
                }
                placeholder="Optional residential or postal address"
              />
            </Field>

            {employmentTerms ? (
              <>
                <Field label="Role">
                  <input
                    value={form.payload.role}
                    onChange={(event) => setPayload("role", event.target.value)}
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
                  <input
                    value={form.payload.employment_type}
                    onChange={(event) =>
                      setPayload("employment_type", event.target.value)
                    }
                  />
                </Field>
                <Field label="Start date">
                  <input
                    type="date"
                    value={form.payload.start_date}
                    onChange={(event) =>
                      setPayload("start_date", event.target.value)
                    }
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

            {factBasedNotice ? (
              <>
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
              <div className="worker-hr-rules full">
                <div className="worker-hr-heading-row">
                  <div>
                    <p>Management-approved starter list</p>
                    <h4>Rules and Regulations</h4>
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
                <div className="worker-hr-rule-grid">
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
                <Field label="Additional custom rule" full>
                  <textarea
                    placeholder="Type an extra rule, then add it to the letter"
                    onBlur={(event) => {
                      const rule = event.target.value.trim();
                      if (rule && !(form.payload.rules || []).includes(rule)) {
                        setPayload("rules", [...form.payload.rules, rule]);
                        event.target.value = "";
                      }
                    }}
                  />
                </Field>
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

            <Field label="Worker agreement / acknowledgement wording" full>
              <textarea
                value={form.payload.worker_agreement}
                onChange={(event) =>
                  setPayload("worker_agreement", event.target.value)
                }
              />
            </Field>

            <Field label="Management note included in letter" full>
              <textarea
                value={form.payload.management_note}
                onChange={(event) =>
                  setPayload("management_note", event.target.value)
                }
                placeholder="Included in the generated letter only when entered"
              />
            </Field>

            <div className="worker-hr-form-actions full">
              <button type="submit" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Draft"
                    : "Save Draft Letter"}
              </button>
              <button type="button" className="secondary" onClick={resetForm}>
                Clear Form
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="worker-hr-card">
        <div className="worker-hr-heading-row">
          <div>
            <p>Permanent profile history</p>
            <h3>Saved Letters</h3>
          </div>
          <span>{letters.length} record(s)</span>
        </div>

        {letters.length === 0 ? (
          <div className="worker-hr-empty">No HR letters have been created.</div>
        ) : (
          <div className="worker-hr-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number / type</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Acknowledgement</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {letters.map((letter) => (
                  <tr key={letter.id}>
                    <td>
                      <strong>{letter.letter_number || "Draft"}</strong>
                      <span>{letter.title}</span>
                    </td>
                    <td>
                      {formatDate(letter.letter_date)}
                      {letter.effective_date ? (
                        <span>Effective {formatDate(letter.effective_date)}</span>
                      ) : null}
                    </td>
                    <td>
                      <b className={`worker-hr-status ${letter.status}`}>
                        {letter.status}
                      </b>
                      {letter.cancelled_at ? (
                        <span>{letter.cancellation_reason}</span>
                      ) : null}
                    </td>
                    <td>
                      <strong>{letter.worker_acknowledgement_status}</strong>
                      {letter.worker_acknowledged_name ? (
                        <span>{letter.worker_acknowledged_name}</span>
                      ) : null}
                    </td>
                    <td>
                      <div className="worker-hr-actions">
                        <button
                          type="button"
                          onClick={() =>
                            openPdf(
                              `/release2-final/workers-expanded/${workerId}/hr-letters/${letter.id}/pdf`,
                              `hr-letter-${letter.id}`
                            )
                          }
                        >
                          PDF
                        </button>
                        {canManage && letter.status === "draft" ? (
                          <>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => editDraft(letter)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => finalizeLetter(letter)}
                              disabled={saving}
                            >
                              Finalize & Lock
                            </button>
                          </>
                        ) : null}
                        {canManage && letter.status !== "cancelled" ? (
                          <button
                            type="button"
                            className="danger"
                            onClick={() => archiveLetter(letter)}
                            disabled={saving}
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

      {canManage ? (
        <section className="worker-hr-card">
          <h3>Record Worker Signature / Receipt</h3>
          <p>
            Use this after the worker signs the printed letter or after a witness
            records that the letter was delivered. The physical signed copy can
            also be uploaded under Documents and Licences.
          </p>
          <form className="worker-hr-form" onSubmit={saveAcknowledgement}>
            <Field label="Finalized document">
              <select
                value={acknowledgement.letter_id}
                onChange={(event) =>
                  setAcknowledgement((current) => ({
                    ...current,
                    letter_id: event.target.value,
                  }))
                }
                required
              >
                <option value="">Choose letter</option>
                {letters
                  .filter((letter) =>
                    ["issued", "acknowledged"].includes(letter.status)
                  )
                  .map((letter) => (
                    <option key={letter.id} value={letter.id}>
                      {letter.letter_number} — {letter.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Result">
              <select
                value={acknowledgement.acknowledgement_status}
                onChange={(event) =>
                  setAcknowledgement((current) => ({
                    ...current,
                    acknowledgement_status: event.target.value,
                  }))
                }
              >
                <option value="received">Received</option>
                <option value="accepted">Accepted / agreed</option>
                <option value="declined">Declined to sign</option>
                <option value="not_required">Not required</option>
              </select>
            </Field>
            <Field label="Worker or witness name">
              <input
                value={acknowledgement.acknowledged_name}
                onChange={(event) =>
                  setAcknowledgement((current) => ({
                    ...current,
                    acknowledged_name: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Note" full>
              <textarea
                value={acknowledgement.note}
                onChange={(event) =>
                  setAcknowledgement((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                placeholder="Example: Signed original filed in personnel folder, or worker declined in the presence of named witness."
              />
            </Field>
            <div className="worker-hr-form-actions full">
              <button type="submit" disabled={saving}>
                Record Acknowledgement
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
