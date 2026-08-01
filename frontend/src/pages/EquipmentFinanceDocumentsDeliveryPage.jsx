import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinanceDocumentsDelivery.css";

const API = "/equipment-catalogue/sales/documents-delivery";
const LIFECYCLE_API = "/equipment-catalogue/sales/finance-lifecycle";

const CATEGORY_LABELS = {
  kyc_identity: "KYC identity",
  kyc_address: "KYC address",
  kyc_income: "KYC income",
  guarantor_identity: "Guarantor identity",
  guarantor_undertaking: "Guarantor undertaking",
  agreement_attachment: "Agreement attachment",
  delivery_evidence: "Delivery evidence",
  other: "Other",
};

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateTime(value) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString("en-GH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
    reader.readAsDataURL(file);
  });
}

function StatusPill({ value }) {
  return <span className={`phase5-pill is-${String(value || "pending").replaceAll("_", "-")}`}>{String(value || "pending").replaceAll("_", " ")}</span>;
}

export default function EquipmentFinanceDocumentsDeliveryPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [cases, setCases] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [caseFile, setCaseFile] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [categories, setCategories] = useState(Object.keys(CATEGORY_LABELS));
  const [documentForm, setDocumentForm] = useState({
    document_category: "kyc_identity",
    document_type: "",
    file: null,
  });
  const [documentNotes, setDocumentNotes] = useState({});
  const [authorizationReason, setAuthorizationReason] = useState("");
  const [decisionReasons, setDecisionReasons] = useState({});
  const [deliveryForm, setDeliveryForm] = useState({
    authorization_number: "",
    receiving_person: "",
    receiving_phone: "",
    destination: "",
    condition_status: "good",
    meter_reading: "",
    fuel_level_percent: "",
    attachments_tools: "",
    notes: "",
  });

  async function loadCase(agreementId, { silent = false } = {}) {
    if (!agreementId) {
      setCaseFile(null);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const response = await axiosClient.get(`${API}/cases/${agreementId}`);
      setCaseFile(response.data);
      const authorized = (response.data.delivery_authorizations || []).find(
        (item) => item.authorization_status === "authorized"
      );
      if (authorized) {
        setDeliveryForm((current) => ({
          ...current,
          authorization_number: authorized.authorization_number,
        }));
      }
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the Finance case file."));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadWorkspace() {
    setLoading(true);
    setProblem("");
    try {
      const [caseResponse, capabilityResponse] = await Promise.all([
        axiosClient.get(`${API}/cases`),
        axiosClient.get(`${API}/capabilities`),
      ]);
      const nextCases = caseResponse.data?.cases || [];
      setCases(nextCases);
      setCapabilities(capabilityResponse.data?.capabilities || null);
      setCategories(capabilityResponse.data?.document_categories || Object.keys(CATEGORY_LABELS));
      const nextId = String(selectedId || nextCases[0]?.agreement_id || "");
      setSelectedId(nextId);
      if (nextId) await loadCase(nextId, { silent: true });
      else setCaseFile(null);
    } catch (error) {
      setProblem(errorMessage(error, "Could not load Phase 5 documents and delivery."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function perform(action, successMessage) {
    setBusy(true);
    setProblem("");
    setNotice("");
    try {
      const response = await action();
      setNotice(response?.data?.message || successMessage);
      await loadCase(selectedId, { silent: true });
      const casesResponse = await axiosClient.get(`${API}/cases`);
      setCases(casesResponse.data?.cases || []);
      return response;
    } catch (error) {
      setProblem(errorMessage(error, "The protected Finance action could not be completed."));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitDocument(event) {
    event.preventDefault();
    if (!documentForm.file) {
      setProblem("Choose a PDF, JPEG or PNG document first.");
      return;
    }
    const content = await fileToBase64(documentForm.file);
    const response = await perform(
      () =>
        axiosClient.post(`${API}/cases/${selectedId}/documents`, {
          document_category: documentForm.document_category,
          document_type: documentForm.document_type,
          file_name: documentForm.file.name,
          mime_type: documentForm.file.type,
          content_base64: content,
        }),
      "Private document encrypted and stored."
    );
    if (response) {
      setDocumentForm({
        document_category: "kyc_identity",
        document_type: "",
        file: null,
      });
      event.currentTarget.reset();
    }
  }

  async function decideDocument(document, kind, decision) {
    const notes = String(documentNotes[document.id] || "").trim();
    if (!notes) {
      setProblem(`Enter ${kind} notes for ${document.document_number}.`);
      return;
    }
    await perform(
      () =>
        axiosClient.post(`${API}/documents/${document.id}/${kind}`, {
          decision,
          notes,
        }),
      "Document decision recorded."
    );
  }

  async function requestAuthorization(event) {
    event.preventDefault();
    await perform(
      () =>
        axiosClient.post(`${API}/cases/${selectedId}/delivery-authorizations`, {
          reason: authorizationReason,
        }),
      "Delivery authorization requested."
    );
    setAuthorizationReason("");
  }

  async function decideAuthorization(authorization, decision) {
    const reason = String(decisionReasons[authorization.id] || "").trim();
    if (!reason) {
      setProblem("Enter an independent delivery decision reason.");
      return;
    }
    await perform(
      () =>
        axiosClient.post(`${API}/delivery-authorizations/${authorization.id}/decision`, {
          decision,
          reason,
        }),
      "Delivery authorization decision recorded."
    );
  }

  async function confirmDelivery(event) {
    event.preventDefault();
    const idempotencyKey = `finance-delivery-${selectedId}-${Date.now()}-${crypto.randomUUID()}`;
    await perform(
      () =>
        axiosClient.post(`${LIFECYCLE_API}/accounts/${selectedId}/delivery`, {
          ...deliveryForm,
          idempotency_key: idempotencyKey,
        }),
      "Authorized delivery confirmed."
    );
  }

  const selectedCase = caseFile?.case || null;
  const documents = caseFile?.documents || [];
  const pendingReview = documents.filter((document) => document.review_status === "pending" && !document.archived_at);
  const pendingApproval = documents.filter(
    (document) =>
      document.review_status === "verified" &&
      document.approval_status === "pending" &&
      !document.archived_at
  );
  const pendingAuthorizations = (caseFile?.delivery_authorizations || []).filter(
    (item) => item.authorization_status === "pending"
  );
  const activeAuthorization = (caseFile?.delivery_authorizations || []).find(
    (item) => item.authorization_status === "authorized"
  );
  const permissionRows = useMemo(
    () =>
      capabilities
        ? [
            ["View private documents", capabilities.private_documents_view],
            ["Upload case documents", capabilities.private_documents_upload],
            ["Independent review", capabilities.independent_document_review],
            ["Approve documents", capabilities.document_approval],
            ["Request delivery", capabilities.delivery_authorization_request],
            ["Authorize delivery", capabilities.delivery_authorization_decision],
            ["Confirm handover", capabilities.delivery_confirmation],
            ["View activity log", capabilities.activity_log_view],
          ]
        : [],
    [capabilities]
  );

  return (
    <main className="phase5-workspace" data-testid="phase5-documents-delivery-page">
      <header className="phase5-hero">
        <div>
          <p>Equipment Installment Finance · Phase 5</p>
          <h1>Documents, approvals and delivery</h1>
          <span>
            Private files are encrypted. Upload, review, approval, authorization and physical
            confirmation must be performed by the permitted independent staff roles.
          </span>
        </div>
        <div className="phase5-role-card" data-testid="phase5-role-card">
          <small>Current Finance role</small>
          <strong>{capabilities?.role?.replaceAll("_", " ") || "Loading…"}</strong>
          <span>{capabilities?.protected_system_administrator ? "Protected administrator" : "Role-controlled access"}</span>
        </div>
      </header>

      {problem ? <div className="phase5-alert is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="phase5-alert is-success" role="status">{notice}</div> : null}

      <section className="phase5-case-picker">
        <label>
          Finance case
          <select
            value={selectedId}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedId(value);
              loadCase(value);
            }}
            data-testid="phase5-case-select"
          >
            {!cases.length ? <option value="">No installment cases</option> : null}
            {cases.map((item) => (
              <option value={item.agreement_id} key={item.agreement_id}>
                {item.agreement_number} · {item.customer_name} · {item.asset_code}
              </option>
            ))}
          </select>
        </label>
        {selectedCase ? (
          <div className="phase5-case-summary">
            <article><span>Customer</span><strong>{selectedCase.customer_name}</strong></article>
            <article><span>Equipment</span><strong>{selectedCase.asset_code}</strong></article>
            <article><span>Official balance</span><strong>{money(selectedCase.outstanding_balance)}</strong></article>
            <article><span>Document gate</span><strong>{caseFile.document_readiness?.complete ? "Complete" : "Incomplete"}</strong></article>
          </div>
        ) : null}
      </section>

      {loading ? <div className="phase5-empty">Loading the protected Finance case file…</div> : null}
      {!loading && !selectedCase ? <div className="phase5-empty">No active installment case is available.</div> : null}

      {!loading && selectedCase ? (
        <>
          <section className="phase5-grid phase5-grid--top">
            <article className="phase5-panel" data-testid="phase5-required-documents">
              <div className="phase5-panel__head">
                <div><small>Policy {caseFile.policy?.policy_version}</small><h2>Required documents</h2></div>
                <StatusPill value={caseFile.document_readiness?.complete ? "complete" : "incomplete"} />
              </div>
              <div className="phase5-checklist">
                {(caseFile.document_readiness?.required || []).map((item) => (
                  <div key={item.category} className={item.complete ? "is-complete" : ""}>
                    <b>{item.complete ? "✓" : "!"}</b>
                    <span>{CATEGORY_LABELS[item.category] || item.category}</span>
                    <small>{item.complete ? "Reviewed and approved" : "Still required"}</small>
                  </div>
                ))}
              </div>
              <p className="phase5-privacy-note">
                No public file URL is stored. Content is decrypted only for an authenticated,
                role-authorized request and every access is written to the activity log.
              </p>
            </article>

            <article className="phase5-panel" data-testid="phase5-permissions">
              <div className="phase5-panel__head"><div><small>Server-enforced</small><h2>Staff permissions</h2></div></div>
              <div className="phase5-permissions">
                {permissionRows.map(([label, allowed]) => (
                  <div key={label}><span>{label}</span><b className={allowed ? "is-yes" : "is-no"}>{allowed ? "Allowed" : "Not allowed"}</b></div>
                ))}
              </div>
              <p className="phase5-privacy-note">
                Uploader ≠ reviewer; uploader/reviewer ≠ approver; requester ≠ authorizer;
                authorizer ≠ delivery confirmer.
              </p>
            </article>
          </section>

          {capabilities?.private_documents_upload ? (
            <section className="phase5-panel" data-testid="phase5-upload-panel">
              <div className="phase5-panel__head"><div><small>Encrypted at rest</small><h2>Add KYC, guarantor or agreement document</h2></div></div>
              <form className="phase5-form phase5-form--upload" onSubmit={submitDocument}>
                <label>Category<select value={documentForm.document_category} onChange={(event) => setDocumentForm((current) => ({ ...current, document_category: event.target.value }))}>{categories.map((category) => <option value={category} key={category}>{CATEGORY_LABELS[category] || category}</option>)}</select></label>
                <label>Document type<input required value={documentForm.document_type} onChange={(event) => setDocumentForm((current) => ({ ...current, document_type: event.target.value }))} placeholder="Ghana Card, guarantor ID, signed agreement…" /></label>
                <label>Private file<input required type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setDocumentForm((current) => ({ ...current, file: event.target.files?.[0] || null }))} /></label>
                <button disabled={busy} type="submit" data-testid="phase5-upload-document">Encrypt and upload</button>
              </form>
            </section>
          ) : null}

          <section className="phase5-panel" data-testid="phase5-document-register">
            <div className="phase5-panel__head">
              <div><small>Private case file</small><h2>Document register</h2></div>
              <span>{documents.length} record{documents.length === 1 ? "" : "s"}</span>
            </div>
            {!documents.length ? <div className="phase5-empty">No private documents have been uploaded.</div> : null}
            <div className="phase5-documents">
              {documents.map((document) => (
                <article key={document.id} data-testid="phase5-document-row" className={document.archived_at ? "is-archived" : ""}>
                  <div className="phase5-document__identity">
                    <small>{document.document_number}</small>
                    <strong>{CATEGORY_LABELS[document.document_category] || document.document_category}</strong>
                    <span>{document.document_type} · {document.original_file_name}</span>
                    <em>SHA-256 {document.content_checksum?.slice(0, 18)}… · private access only</em>
                  </div>
                  <div className="phase5-document__states">
                    <div><span>Review</span><StatusPill value={document.review_status} /></div>
                    <div><span>Approval</span><StatusPill value={document.approval_status} /></div>
                  </div>
                  {!document.archived_at ? (
                    <a href={`${axiosClient.defaults.baseURL}${API}/documents/${document.id}/content`} target="_blank" rel="noreferrer">Secure download</a>
                  ) : <StatusPill value="archived" />}
                  {!document.archived_at && ((capabilities?.independent_document_review && document.review_status === "pending") || (capabilities?.document_approval && document.review_status === "verified" && document.approval_status === "pending")) ? (
                    <div className="phase5-document__decision">
                      <input value={documentNotes[document.id] || ""} onChange={(event) => setDocumentNotes((current) => ({ ...current, [document.id]: event.target.value }))} placeholder="Independent review or approval notes" />
                      {capabilities?.independent_document_review && document.review_status === "pending" ? <><button disabled={busy} onClick={() => decideDocument(document, "review", "verify")}>Verify</button><button disabled={busy} className="is-danger" onClick={() => decideDocument(document, "review", "reject")}>Reject review</button></> : null}
                      {capabilities?.document_approval && document.review_status === "verified" && document.approval_status === "pending" ? <><button disabled={busy} onClick={() => decideDocument(document, "approval", "approve")}>Approve</button><button disabled={busy} className="is-danger" onClick={() => decideDocument(document, "approval", "reject")}>Reject approval</button></> : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="phase5-grid">
            <article className="phase5-panel" data-testid="phase5-review-queues">
              <div className="phase5-panel__head"><div><small>Independent control</small><h2>Review and approval queues</h2></div></div>
              <div className="phase5-queue"><div><span>Awaiting independent review</span><strong>{pendingReview.length}</strong></div><div><span>Awaiting manager approval</span><strong>{pendingApproval.length}</strong></div></div>
              <p>Each decision records the actor, notes, time, request evidence and immutable document checksum.</p>
            </article>

            <article className="phase5-panel" data-testid="phase5-authorization-panel">
              <div className="phase5-panel__head"><div><small>Before physical handover</small><h2>Delivery authorization</h2></div></div>
              {capabilities?.delivery_authorization_request && !pendingAuthorizations.length && !activeAuthorization && !selectedCase.delivery_count ? (
                <form className="phase5-form" onSubmit={requestAuthorization}>
                  <label>Request reason<textarea required value={authorizationReason} onChange={(event) => setAuthorizationReason(event.target.value)} placeholder="Why the approved customer and exact machine are ready for delivery" /></label>
                  <button disabled={busy || !caseFile.document_readiness?.complete} type="submit" data-testid="phase5-request-delivery">Request authorization</button>
                </form>
              ) : null}
              {pendingAuthorizations.map((authorization) => (
                <div className="phase5-authorization" key={authorization.id} data-testid="phase5-pending-authorization">
                  <small>{authorization.authorization_number}</small><StatusPill value={authorization.authorization_status} /><p>{authorization.request_reason}</p>
                  {capabilities?.delivery_authorization_decision ? <div className="phase5-document__decision"><input value={decisionReasons[authorization.id] || ""} onChange={(event) => setDecisionReasons((current) => ({ ...current, [authorization.id]: event.target.value }))} placeholder="Independent authorization reason" /><button disabled={busy} data-testid="phase5-authorize-delivery" onClick={() => decideAuthorization(authorization, "authorize")}>Authorize</button><button disabled={busy} className="is-danger" onClick={() => decideAuthorization(authorization, "reject")}>Reject</button></div> : null}
                </div>
              ))}
              {activeAuthorization ? <div className="phase5-authorization is-authorized"><small>{activeAuthorization.authorization_number}</small><StatusPill value="authorized" /><p>Valid until {dateTime(activeAuthorization.expires_at)}. A different staff member must confirm the physical handover.</p></div> : null}
              {selectedCase.delivery_count ? <div className="phase5-authorization is-authorized"><StatusPill value="consumed" /><p>Controlled delivery has been completed and preserved.</p></div> : null}
            </article>
          </section>

          {capabilities?.delivery_confirmation && activeAuthorization && !selectedCase.delivery_count ? (
            <section className="phase5-panel" data-testid="phase5-delivery-confirmation-panel">
              <div className="phase5-panel__head"><div><small>Independent physical evidence</small><h2>Confirm equipment delivery</h2></div><span>{activeAuthorization.authorization_number}</span></div>
              <form className="phase5-form phase5-form--delivery" onSubmit={confirmDelivery}>
                <input type="hidden" value={deliveryForm.authorization_number} />
                <label>Receiving person<input required value={deliveryForm.receiving_person} onChange={(event) => setDeliveryForm((current) => ({ ...current, receiving_person: event.target.value }))} /></label>
                <label>Receiving phone<input value={deliveryForm.receiving_phone} onChange={(event) => setDeliveryForm((current) => ({ ...current, receiving_phone: event.target.value }))} /></label>
                <label>Destination<input required value={deliveryForm.destination} onChange={(event) => setDeliveryForm((current) => ({ ...current, destination: event.target.value }))} /></label>
                <label>Condition<select value={deliveryForm.condition_status} onChange={(event) => setDeliveryForm((current) => ({ ...current, condition_status: event.target.value }))}><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option><option value="under_inspection">Under inspection</option></select></label>
                <label>Meter reading<input required min="0" step="0.01" type="number" value={deliveryForm.meter_reading} onChange={(event) => setDeliveryForm((current) => ({ ...current, meter_reading: event.target.value }))} /></label>
                <label>Fuel level %<input required min="0" max="100" step="0.01" type="number" value={deliveryForm.fuel_level_percent} onChange={(event) => setDeliveryForm((current) => ({ ...current, fuel_level_percent: event.target.value }))} /></label>
                <label>Attachments and tools<textarea value={deliveryForm.attachments_tools} onChange={(event) => setDeliveryForm((current) => ({ ...current, attachments_tools: event.target.value }))} /></label>
                <label>Confirmation notes<textarea value={deliveryForm.notes} onChange={(event) => setDeliveryForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <button disabled={busy} type="submit" data-testid="phase5-confirm-delivery">Confirm authorized handover</button>
              </form>
            </section>
          ) : null}

          <section className="phase5-panel" data-testid="phase5-activity-log">
            <div className="phase5-panel__head"><div><small>Append-only evidence</small><h2>Finance case activity</h2></div><span>{caseFile.activity?.length || 0} events</span></div>
            <div className="phase5-activity">
              {(caseFile.activity || []).map((event) => (
                <article key={event.id} data-testid="phase5-activity-row"><b>{event.action_type?.replaceAll("_", " ")}</b><span>{event.description}</span><small>{event.actor_name || event.actor_role || "System"} · {dateTime(event.created_at)}</small></article>
              ))}
              {!caseFile.activity?.length ? <div className="phase5-empty">No Phase 5 activity has been recorded.</div> : null}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
