import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/equipmentFinanceCaseWorkspace.css";

const PRIVATE_API = "/equipment-catalogue/sales/private-documents";
const AUTH_API = "/equipment-catalogue/sales/delivery-authorizations";
const LIFECYCLE_API = "/equipment-catalogue/sales/finance-lifecycle";

const CATEGORY_OPTIONS = [
  ["kyc_identity", "KYC identity"],
  ["kyc_address", "KYC address"],
  ["kyc_income", "KYC income"],
  ["guarantor_identity", "Guarantor identity"],
  ["guarantor_undertaking", "Guarantor undertaking"],
  ["agreement_attachment", "Agreement attachment"],
  ["other", "Other"],
];

const CONFIRMATION_ROLES = new Set([
  "finance_accountant",
  "credit_officer",
  "collections_officer",
  "finance_manager",
  "equipment_business_accountant",
  "equipment_business_manager",
]);

function money(value) {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function dateTime(value) {
  if (!value) return "â€”";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString("en-GH");
}

function label(value) {
  return String(value || "â€”").replaceAll("_", " ");
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",").pop() : value);
    };
    reader.readAsDataURL(file);
  });
}

function statusClass(value) {
  const normalized = String(value || "").toLowerCase();
  if (["approved", "verified", "authorized", "consumed", "complete", "delivered"].includes(normalized)) {
    return "is-success";
  }
  if (["rejected", "revoked", "expired", "archived"].includes(normalized)) {
    return "is-danger";
  }
  return "is-pending";
}

function permissionRows(documentCapabilities, reviewCapabilities, authorizationCapabilities, role) {
  return [
    ["View private files", documentCapabilities.private_documents_view],
    ["Upload private files", documentCapabilities.private_documents_upload],
    ["Download private files", documentCapabilities.private_documents_download],
    ["Independent review", reviewCapabilities.independent_document_review],
    ["Approve documents", reviewCapabilities.document_approval],
    ["Archive/replace evidence", reviewCapabilities.document_archive],
    ["Request delivery", authorizationCapabilities.delivery_authorization_request],
    ["Authorize delivery", authorizationCapabilities.delivery_authorization_decision],
    ["Revoke authorization", authorizationCapabilities.delivery_authorization_revoke],
    ["Confirm handover", CONFIRMATION_ROLES.has(role)],
  ];
}

export default function EquipmentFinanceCaseWorkspacePage() {
  const [cases, setCases] = useState([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [caseFile, setCaseFile] = useState(null);
  const [documentCapabilities, setDocumentCapabilities] = useState({});
  const [reviewCapabilities, setReviewCapabilities] = useState({});
  const [authorizationCapabilities, setAuthorizationCapabilities] = useState({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState({});
  const [upload, setUpload] = useState({
    document_category: "kyc_identity",
    document_type: "",
    file: null,
    replacement_of_document_id: null,
  });
  const [authorizationReason, setAuthorizationReason] = useState("");
  const [authorizationDecisionReason, setAuthorizationDecisionReason] = useState("");
  const [delivery, setDelivery] = useState({
    receiving_person: "",
    receiving_phone: "",
    destination: "",
    condition_status: "good",
    meter_reading: "",
    fuel_level_percent: "",
    attachments_tools: "",
    notes: "",
  });

  const role =
    authorizationCapabilities.role ||
    reviewCapabilities.role ||
    documentCapabilities.role ||
    "unknown";

  const [selectedType, selectedId] = selectedKey.includes(":")
    ? selectedKey.split(":", 2)
    : ["", ""];

  const loadCase = useCallback(async (caseType, caseId) => {
    if (!caseType || !caseId) {
      setCaseFile(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const reviewPath =
        caseType === "agreement"
          ? `${PRIVATE_API}/review-cases/${caseId}`
          : `${PRIVATE_API}/application-review-cases/${caseId}`;
      const [reviewResponse, authorizationResponse, documentCapsResponse, reviewCapsResponse, authorizationCapsResponse] =
        await Promise.all([
          axiosClient.get(reviewPath),
          caseType === "agreement"
            ? axiosClient.get(`${AUTH_API}/cases/${caseId}`)
            : Promise.resolve({ data: {} }),
          axiosClient.get(`${PRIVATE_API}/capabilities`),
          axiosClient.get(`${PRIVATE_API}/review-capabilities`),
          axiosClient.get(`${AUTH_API}/capabilities`),
        ]);
      const review = reviewResponse.data || {};
      const authorization = authorizationResponse.data || {};
      setDocumentCapabilities(documentCapsResponse.data?.capabilities || {});
      setReviewCapabilities(reviewCapsResponse.data?.capabilities || {});
      setAuthorizationCapabilities(authorizationCapsResponse.data?.capabilities || {});
      setCaseFile({
        case: review.case || authorization.case || null,
        documents: review.review_documents || review.documents || [],
        readiness: review.document_readiness || authorization.document_readiness || null,
        activity: review.activity || [],
        reviewPolicy: review.review_policy || {},
        authorizations: authorization.authorizations || [],
        authorizationPolicy: authorization.authorization_policy || {},
        deliveryThreshold: authorization.delivery_threshold || {},
      });
    } catch (loadError) {
      setError(errorMessage(loadError, "The Finance case file could not be loaded."));
      setCaseFile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [applicationResult, agreementResult] = await Promise.allSettled([
        axiosClient.get(`${PRIVATE_API}/applications`),
        axiosClient.get(`${PRIVATE_API}/cases`),
      ]);
      if (
        applicationResult.status === "rejected" &&
        agreementResult.status === "rejected"
      ) {
        throw agreementResult.reason || applicationResult.reason;
      }
      const applicationResponse =
        applicationResult.status === "fulfilled"
          ? applicationResult.value
          : { data: { cases: [] } };
      const agreementResponse =
        agreementResult.status === "fulfilled"
          ? agreementResult.value
          : { data: { cases: [] } };
      const applicationRows = (applicationResponse.data?.cases || []).map((item) => ({
        ...item,
        case_type: "application",
        case_id: item.application_id,
      }));
      const agreementRows = (agreementResponse.data?.cases || []).map((item) => ({
        ...item,
        case_type: "agreement",
        case_id: item.agreement_id,
      }));
      const rows = [...applicationRows, ...agreementRows];
      setCases(rows);
      const nextKey = selectedKey || (rows[0] ? `${rows[0].case_type}:${rows[0].case_id}` : "");
      setSelectedKey(nextKey);
      if (nextKey) {
        const [caseType, caseId] = nextKey.split(":", 2);
        await loadCase(caseType, caseId);
      }
      else setLoading(false);
    } catch (loadError) {
      setError(errorMessage(loadError, "Private Finance cases could not be loaded."));
      setLoading(false);
    }
  }, [loadCase, selectedKey]);

  useEffect(() => {
    loadCases();
    // Initial load only. Subsequent refreshes use loadCase to preserve selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    if (selectedType && selectedId) await loadCase(selectedType, selectedId);
  }, [loadCase, selectedId, selectedType]);

  const filteredCases = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cases;
    return cases.filter((item) =>
      [
        item.agreement_number,
        item.application_number,
        item.customer_name,
        item.customer_phone,
        item.asset_code,
        item.asset_name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [cases, search]);

  const financeCase = caseFile?.case;
  const documents = caseFile?.documents || [];
  const authorizations = caseFile?.authorizations || [];
  const activity = caseFile?.activity || [];
  const liveAuthorization = authorizations.find(
    (item) => item.effective_status === "authorized" && item.can_be_used_for_delivery
  );
  const pendingAuthorization = authorizations.find(
    (item) => item.effective_status === "pending"
  );
  const delivered = Number(financeCase?.delivery_count || 0) > 0;
  const permissionList = permissionRows(
    documentCapabilities,
    reviewCapabilities,
    authorizationCapabilities,
    role
  );

  async function perform(key, action, successText) {
    setWorking(key);
    setError("");
    setMessage("");
    try {
      const response = await action();
      setMessage(response?.data?.message || successText);
      await refresh();
      return response;
    } catch (actionError) {
      setError(errorMessage(actionError, "The protected Finance action failed."));
      return null;
    } finally {
      setWorking("");
    }
  }

  async function uploadDocument(event) {
    event.preventDefault();
    if (!upload.file || !upload.document_type.trim()) {
      setError("Choose a private file and enter its document type.");
      return;
    }
    const content = await fileToBase64(upload.file);
    const caseCollection = selectedType === "agreement" ? "cases" : "applications";
    const response = await perform(
      "upload",
      () =>
        axiosClient.post(`${PRIVATE_API}/${caseCollection}/${selectedId}/documents`, {
          document_category: upload.document_category,
          document_type: upload.document_type,
          file_name: upload.file.name,
          mime_type: upload.file.type,
          content_base64: content,
          replacement_of_document_id: upload.replacement_of_document_id,
        }),
      "Private document encrypted and stored."
    );
    if (response) {
      setUpload({
        document_category: "kyc_identity",
        document_type: "",
        file: null,
        replacement_of_document_id: null,
      });
      const input = document.getElementById("phase5e-private-file");
      if (input) input.value = "";
    }
  }

  async function downloadDocument(documentRow) {
    setWorking(`download-${documentRow.id}`);
    setError("");
    try {
      const response = await axiosClient.get(
        `${PRIVATE_API}/documents/${documentRow.id}/content`,
        { responseType: "blob", headers: { Accept: documentRow.mime_type } }
      );
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = documentRow.original_file_name || "private-finance-document";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Downloaded ${documentRow.document_number} through the authenticated Finance session.`);
      await refresh();
    } catch (downloadError) {
      setError(errorMessage(downloadError, "The private document could not be downloaded."));
    } finally {
      setWorking("");
    }
  }

  async function documentAction(documentRow, action, decision, fallback) {
    const documentId = documentRow.id;
    const text = String(notes[documentId] || "").trim();
    if (!text) {
      setError("Enter independent notes before recording this decision.");
      return;
    }
    const response = await perform(
      `${action}-${documentId}`,
      () =>
        axiosClient.post(`${PRIVATE_API}/documents/${documentId}/${action}`, {
          ...(action === "archive" ? { reason: text } : { decision, notes: text }),
        }),
      fallback
    );
    if (response && action === "archive") {
      setUpload({
        document_category: documentRow.document_category,
        document_type: documentRow.document_type || "",
        file: null,
        replacement_of_document_id: documentId,
      });
      setMessage(
        `${documentRow.document_number} was archived. Choose its replacement file below; the new version will preserve this evidence chain.`
      );
    }
  }

  function requestAuthorization() {
    if (selectedType !== "agreement") return;
    if (!authorizationReason.trim()) {
      setError("Enter why this approved customer and exact machine are ready for delivery.");
      return;
    }
    perform(
      "request-authorization",
      () =>
        axiosClient.post(`${AUTH_API}/cases/${selectedId}/requests`, {
          reason: authorizationReason,
        }),
      "Delivery authorization requested."
    ).then((response) => {
      if (response) setAuthorizationReason("");
    });
  }

  function decideAuthorization(authorizationId, decision) {
    if (!authorizationDecisionReason.trim()) {
      setError("Enter an independent authorization reason.");
      return;
    }
    perform(
      `${decision}-authorization`,
      () =>
        axiosClient.post(`${AUTH_API}/authorizations/${authorizationId}/decision`, {
          decision,
          reason: authorizationDecisionReason,
        }),
      `Delivery authorization ${decision === "authorize" ? "approved" : "rejected"}.`
    ).then((response) => {
      if (response) setAuthorizationDecisionReason("");
    });
  }

  function revokeAuthorization(authorizationId) {
    if (!authorizationDecisionReason.trim()) {
      setError("Enter a revocation reason.");
      return;
    }
    perform(
      "revoke-authorization",
      () =>
        axiosClient.post(`${AUTH_API}/authorizations/${authorizationId}/revoke`, {
          reason: authorizationDecisionReason,
        }),
      "Delivery authorization revoked."
    );
  }

  function confirmDelivery(event) {
    event.preventDefault();
    if (selectedType !== "agreement") return;
    perform(
      "confirm-delivery",
      () =>
        axiosClient.post(`${LIFECYCLE_API}/accounts/${selectedId}/delivery`, {
          authorization_number: liveAuthorization?.authorization_number,
          idempotency_key: `finance-delivery-${selectedId}-${crypto.randomUUID()}`,
          ...delivery,
        }),
      "Authorized delivery and independent handover confirmation recorded."
    ).then((response) => {
      if (response) {
        setDelivery({
          receiving_person: "",
          receiving_phone: "",
          destination: "",
          condition_status: "good",
          meter_reading: "",
          fuel_level_percent: "",
          attachments_tools: "",
          notes: "",
        });
      }
    });
  }

  return (
    <main className="phase5e-workspace" data-testid="phase5e-case-workspace">
      <header className="phase5e-hero">
        <div>
          <p className="phase5e-eyebrow">Equipment Installment Finance Â· Phase 5E</p>
          <h1>Private documents, approvals and controlled delivery</h1>
          <p>
            One server-backed case file for KYC, guarantor evidence, agreement attachments,
            independent decisions, delivery authorization, physical handover and activity.
          </p>
          <nav className="phase5e-actions" aria-label="Finance document areas">
            <Link to="?stage=documents">Customer evidence</Link>
            <Link to="?stage=generated-documents">Generated agreements</Link>
            <Link to="?stage=collections">Receipts</Link>
            <Link to="?stage=operations">Statements and reports</Link>
          </nav>
        </div>
        <button type="button" className="phase5e-secondary" onClick={refresh} disabled={!selectedKey || loading}>
          Refresh case
        </button>
      </header>

      {message ? <div className="phase5e-alert is-success" role="status">{message}</div> : null}
      {error ? <div className="phase5e-alert is-error" role="alert">{error}</div> : null}

      <section className="phase5e-layout">
        <aside className="phase5e-case-list" aria-label="Finance case list">
          <label>
            Search cases
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Agreement, customer or machine" />
          </label>
          <div className="phase5e-case-scroll">
            {filteredCases.map((item) => (
              <button
                type="button"
                key={`${item.case_type}:${item.case_id}`}
                className={`${item.case_type}:${item.case_id}` === selectedKey ? "is-active" : ""}
                onClick={() => {
                  const id = String(item.case_id);
                  setSelectedKey(`${item.case_type}:${id}`);
                  loadCase(item.case_type, id);
                }}
                data-testid="phase5e-case-option"
              >
                <strong>{item.agreement_number || item.application_number}</strong>
                <span>{item.customer_name}</span>
                <small>{item.case_type === "agreement" ? "Activated agreement" : "Application evidence"}</small>
                <small>{item.asset_code} Â· {item.asset_name}</small>
                <em>{item.document_count || 0} private files</em>
              </button>
            ))}
          </div>
        </aside>

        <div className="phase5e-content">
          {loading ? <div className="phase5e-empty">Loading the protected Finance caseâ€¦</div> : null}
          {!loading && !financeCase ? <div className="phase5e-empty">Choose a Finance application or agreement to open its controlled case file.</div> : null}
          {!loading && financeCase ? (
            <>
              <section className="phase5e-summary" data-testid="phase5e-case-summary">
                <div><span>{selectedType === "agreement" ? "Agreement" : "Application"}</span><strong>{financeCase.agreement_number || financeCase.application_number}</strong></div>
                <div><span>Customer</span><strong>{financeCase.customer_name}</strong></div>
                <div><span>Exact machine</span><strong>{financeCase.asset_code} Â· {financeCase.asset_name}</strong></div>
                <div><span>{selectedType === "agreement" ? "Official balance" : "Case stage"}</span><strong>{selectedType === "agreement" ? money(financeCase.outstanding_balance) : "Application evidence"}</strong></div>
                <div><span>Documents</span><strong className={`phase5e-pill ${caseFile.readiness?.complete ? "is-success" : "is-pending"}`}>{caseFile.readiness?.complete ? "Complete" : "Incomplete"}</strong></div>
                <div><span>Delivery</span><strong className={`phase5e-pill ${delivered ? "is-success" : "is-pending"}`}>{selectedType === "agreement" ? (delivered ? "Delivered" : "Not delivered") : "After activation"}</strong></div>
              </section>

              <section className="phase5e-card" data-testid="phase5e-permissions">
                <div className="phase5e-section-heading">
                  <div><h2>Staff permissions</h2><p>Current role: <strong>{label(role)}</strong></p></div>
                </div>
                <div className="phase5e-permission-grid">
                  {permissionList.map(([name, allowed]) => (
                    <div key={name}><span>{name}</span><strong className={`phase5e-pill ${allowed ? "is-success" : "is-danger"}`}>{allowed ? "Allowed" : "Blocked"}</strong></div>
                  ))}
                </div>
              </section>

              <section className="phase5e-card" data-testid="phase5e-required-documents">
                <div className="phase5e-section-heading"><div><h2>Required document checklist</h2><p>Delivery stays locked until every required category is independently verified and approved.</p></div></div>
                <div className="phase5e-checklist">
                  {(caseFile.readiness?.required || []).map((item) => (
                    <div key={item.category}><span>{label(item.category)}</span><strong className={`phase5e-pill ${item.complete ? "is-success" : "is-pending"}`}>{item.complete ? "Complete" : "Still required"}</strong></div>
                  ))}
                </div>
              </section>

              {documentCapabilities.private_documents_upload ? (
                <form className="phase5e-card phase5e-form" onSubmit={uploadDocument} data-testid="phase5e-upload-form">
                  <div className="phase5e-section-heading"><div><h2>{upload.replacement_of_document_id ? "Upload the replacement version" : "Upload encrypted private evidence"}</h2><p>PDF, JPEG, PNG and WebP files are encrypted on the server. No public file URL is created.</p></div></div>
                  <div className="phase5e-form-grid">
                    <label>Category<select value={upload.document_category} onChange={(event) => setUpload((current) => ({ ...current, document_category: event.target.value }))}>{CATEGORY_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                    <label>Document type<input value={upload.document_type} onChange={(event) => setUpload((current) => ({ ...current, document_type: event.target.value }))} placeholder="Example: Ghana Card" /></label>
                    <label>Private file<input id="phase5e-private-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setUpload((current) => ({ ...current, file: event.target.files?.[0] || null }))} /></label>
                  </div>
                  <button type="submit" disabled={working === "upload"} data-testid="phase5e-upload-document">{working === "upload" ? "Encryptingâ€¦" : "Encrypt and store"}</button>
                </form>
              ) : null}

              <section className="phase5e-card" data-testid="phase5e-document-table">
                <div className="phase5e-section-heading"><div><h2>Private documents and independent decisions</h2><p>Original encrypted evidence remains preserved after rejection or archival.</p></div></div>
                <div className="phase5e-table-wrap">
                  <table>
                    <thead><tr><th>Document</th><th>Uploader</th><th>Review</th><th>Approval</th><th>Protected actions</th></tr></thead>
                    <tbody>
                      {documents.map((item) => (
                        <tr key={item.id} data-testid="phase5e-document-row">
                          <td><strong>{label(item.document_category)}</strong><span>{item.document_number}</span><small>{item.original_file_name}</small><small>{item.document_status === "archived" ? "Archived evidence" : "Encrypted Â· private access"}</small></td>
                          <td><span>{item.uploaded_by_name || `Staff ${item.uploaded_by || "â€”"}`}</span><small>{dateTime(item.uploaded_at)}</small></td>
                          <td><strong className={`phase5e-pill ${statusClass(item.review_status)}`}>{label(item.review_status)}</strong><small>{item.reviewed_by_name || "Not reviewed"}</small></td>
                          <td><strong className={`phase5e-pill ${statusClass(item.approval_status)}`}>{label(item.approval_status)}</strong><small>{item.approved_by_name || "Not approved"}</small></td>
                          <td className="phase5e-actions">
                            <button type="button" className="phase5e-secondary" onClick={() => downloadDocument(item)} disabled={working === `download-${item.id}`}>Download</button>
                            {item.document_status === "active" ? <textarea value={notes[item.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Independent review or approval notes" /> : null}
                            {reviewCapabilities.independent_document_review && item.review_status === "pending" ? <div><button type="button" onClick={() => documentAction(item, "review", "verify", "Document independently verified.")} disabled={working === `review-${item.id}`}>Verify</button><button type="button" className="phase5e-danger" onClick={() => documentAction(item, "review", "reject", "Document review rejected.")}>Reject review</button></div> : null}
                            {reviewCapabilities.document_approval && item.review_status === "verified" && item.approval_status === "pending" ? <div><button type="button" onClick={() => documentAction(item, "approval", "approve", "Document approved.")}>Approve</button><button type="button" className="phase5e-danger" onClick={() => documentAction(item, "approval", "reject", "Document approval rejected.")}>Reject approval</button></div> : null}
                            {reviewCapabilities.document_archive && item.document_status === "active" ? <button type="button" className="phase5e-secondary" onClick={() => documentAction(item, "archive", "archive", "Document archived for replacement.")}>Archive/replace</button> : null}
                          </td>
                        </tr>
                      ))}
                      {!documents.length ? <tr><td colSpan="5">No private documents have been uploaded.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedType === "agreement" ? (
              <section className="phase5e-card" data-testid="phase5e-authorization-panel">
                <div className="phase5e-section-heading"><div><h2>Delivery authorization</h2><p>Backend checks: approved documents, exact asset reservation, payment threshold, no active Hire contract, no prior delivery and unchanged financial snapshot.</p></div></div>
                <div className="phase5e-thresholds">
                  <div><span>Document readiness</span><strong>{caseFile.readiness?.complete ? "Complete" : "Incomplete"}</strong></div>
                  <div><span>Financial threshold</span><strong>{caseFile.deliveryThreshold?.satisfied ? "Satisfied" : "Not satisfied"}</strong></div>
                  <div><span>Authorization validity</span><strong>{caseFile.authorizationPolicy?.delivery_authorization_valid_hours || 0} hours</strong></div>
                </div>
                {authorizationCapabilities.delivery_authorization_request && !pendingAuthorization && !liveAuthorization && !delivered ? <div className="phase5e-action-box"><textarea value={authorizationReason} onChange={(event) => setAuthorizationReason(event.target.value)} placeholder="Why the approved customer and exact machine are ready for delivery" /><button type="button" onClick={requestAuthorization} data-testid="phase5e-request-delivery">Request independent authorization</button></div> : null}
                {pendingAuthorization ? <div className="phase5e-action-box" data-testid="phase5e-pending-authorization"><strong>{pendingAuthorization.authorization_number}</strong><p>Requested by {pendingAuthorization.requested_by_name || pendingAuthorization.requested_by}. A different manager must decide it.</p>{authorizationCapabilities.delivery_authorization_decision ? <><textarea value={authorizationDecisionReason} onChange={(event) => setAuthorizationDecisionReason(event.target.value)} placeholder="Independent authorization reason" /><div><button type="button" onClick={() => decideAuthorization(pendingAuthorization.id, "authorize")} data-testid="phase5e-authorize-delivery">Authorize</button><button type="button" className="phase5e-danger" onClick={() => decideAuthorization(pendingAuthorization.id, "reject")}>Reject</button></div></> : null}</div> : null}
                {liveAuthorization ? <div className="phase5e-action-box is-authorized"><strong>{liveAuthorization.authorization_number}</strong><p>Authorized by {liveAuthorization.decided_by_name || liveAuthorization.decided_by}; expires {dateTime(liveAuthorization.expires_at)}.</p>{authorizationCapabilities.delivery_authorization_revoke ? <><textarea value={authorizationDecisionReason} onChange={(event) => setAuthorizationDecisionReason(event.target.value)} placeholder="Revocation reason" /><button type="button" className="phase5e-danger" onClick={() => revokeAuthorization(liveAuthorization.id)}>Revoke authorization</button></> : null}</div> : null}
                <div className="phase5e-history-grid">{authorizations.map((item) => <div key={item.id}><strong>{item.authorization_number}</strong><span className={`phase5e-pill ${statusClass(item.effective_status)}`}>{label(item.effective_status)}</span><small>Requested {dateTime(item.requested_at)}</small></div>)}</div>
              </section>
              ) : null}

              {selectedType === "agreement" && liveAuthorization && CONFIRMATION_ROLES.has(role) && !delivered ? (
                <form className="phase5e-card phase5e-form" onSubmit={confirmDelivery} data-testid="phase5e-delivery-confirmation-panel">
                  <div className="phase5e-section-heading"><div><h2>Confirm physical handover</h2><p>The confirmer must differ from the authorizing manager. Delivery, authorization consumption and confirmation commit together.</p></div></div>
                  <div className="phase5e-form-grid">
                    <label>Receiving person<input value={delivery.receiving_person} onChange={(event) => setDelivery((current) => ({ ...current, receiving_person: event.target.value }))} required /></label>
                    <label>Receiving phone<input value={delivery.receiving_phone} onChange={(event) => setDelivery((current) => ({ ...current, receiving_phone: event.target.value }))} /></label>
                    <label>Destination<input value={delivery.destination} onChange={(event) => setDelivery((current) => ({ ...current, destination: event.target.value }))} /></label>
                    <label>Condition<select value={delivery.condition_status} onChange={(event) => setDelivery((current) => ({ ...current, condition_status: event.target.value }))}><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option><option value="under_inspection">Under inspection</option></select></label>
                    <label>Meter reading<input type="number" min="0" step="0.01" value={delivery.meter_reading} onChange={(event) => setDelivery((current) => ({ ...current, meter_reading: event.target.value }))} required /></label>
                    <label>Fuel level %<input type="number" min="0" max="100" step="0.01" value={delivery.fuel_level_percent} onChange={(event) => setDelivery((current) => ({ ...current, fuel_level_percent: event.target.value }))} required /></label>
                    <label className="phase5e-wide">Attachments and tools<textarea value={delivery.attachments_tools} onChange={(event) => setDelivery((current) => ({ ...current, attachments_tools: event.target.value }))} /></label>
                    <label className="phase5e-wide">Confirmation notes<textarea value={delivery.notes} onChange={(event) => setDelivery((current) => ({ ...current, notes: event.target.value }))} /></label>
                  </div>
                  <button type="submit" disabled={working === "confirm-delivery"} data-testid="phase5e-confirm-delivery">{working === "confirm-delivery" ? "Confirmingâ€¦" : "Confirm authorized delivery"}</button>
                </form>
              ) : null}

              <section className="phase5e-card" data-testid="phase5e-activity-log">
                <div className="phase5e-section-heading"><div><h2>Finance case activity</h2><p>Append-only evidence across upload, download, review, approval, authorization, revocation and handover.</p></div></div>
                <div className="phase5e-activity-list">{activity.map((item) => <article key={item.id} data-testid="phase5e-activity-row"><div><strong>{label(item.action_type)}</strong><span>{item.description}</span></div><small>{item.actor_name || item.actor_role || "System"} Â· {dateTime(item.created_at)}</small></article>)}{!activity.length ? <p>No protected activity has been recorded.</p> : null}</div>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

