import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinanceDocumentCompletion.css";

const API = "/equipment-catalogue/sales";
const ACCOUNTS_API = `${API}/finance-lifecycle/accounts`;
const PROFESSIONAL_API = `${API}/professional`;
const COMPLETION_API = `${PROFESSIONAL_API}/completion-documents`;
const DOCUMENTS_API = `${PROFESSIONAL_API}/documents`;

const GROUPS = [
  {
    code: "agreement",
    title: "Agreement & Approval Pack",
    description: "Legally controlled copies for the customer, company file and management approval.",
    types: [
      "installment_agreement",
      "customer_agreement_copy",
      "company_agreement_copy",
      "boss_approval_pack",
    ],
  },
  {
    code: "payments",
    title: "Payments & Customer Account",
    description: "Schedules, exact-payment receipts, statements and overdue notices.",
    types: ["payment_schedule", "payment_receipt", "customer_statement", "arrears_notice"],
  },
  {
    code: "machine",
    title: "Machine, Guarantor & Handover",
    description: "Photo evidence, guarantor undertaking and physical machine handover records.",
    types: ["machine_annexure", "guarantor_undertaking", "delivery_handover_note"],
  },
  {
    code: "completion",
    title: "Changes, Settlement & Ownership",
    description: "Approved amendments and documents available at the end of the account lifecycle.",
    types: ["amendment_agreement", "settlement_confirmation", "ownership_transfer"],
  },
];

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString("en-GH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
}

function label(value) {
  return String(value || "Not recorded")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function safeFileNameFromDisposition(disposition, fallback) {
  const match = String(disposition || "").match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function overdueAmount(schedule = []) {
  const today = new Date().toISOString().slice(0, 10);
  return schedule.reduce((total, row) => {
    const due = String(row.due_date || "").slice(0, 10);
    return due && due < today ? total + Number(row.balance || 0) : total;
  }, 0);
}

function documentAvailability(type, snapshot, selectedPaymentId) {
  if (!snapshot) return { available: false, note: "Choose an installment account first." };
  const agreement = snapshot.agreement || {};
  if (type === "payment_receipt") {
    return selectedPaymentId
      ? { available: true, note: "Uses the exact committed payment and its allocation." }
      : { available: false, note: "Choose the exact payment receipt first." };
  }
  if (type === "guarantor_undertaking" && !agreement.guarantor_name) {
    return { available: false, note: "No guarantor is recorded on this agreement." };
  }
  if (type === "arrears_notice" && overdueAmount(snapshot.schedule) <= 0.01) {
    return { available: false, note: "This account has no overdue schedule balance." };
  }
  if (["settlement_confirmation", "ownership_transfer"].includes(type)) {
    if (Number(agreement.outstanding_balance || 0) > 0.01) {
      return { available: false, note: "Available only after the official balance reaches zero." };
    }
  }
  if (type === "amendment_agreement") {
    return {
      available: true,
      note: "The server will use the latest approved or applied numbered amendment.",
    };
  }
  if (type === "delivery_handover_note") {
    return {
      available: true,
      note: "Uses the controlled delivery record when handover has been confirmed.",
    };
  }
  return { available: true, note: "Issued from the selected immutable account snapshot." };
}

function DocumentCard({
  definition,
  snapshot,
  selectedPaymentId,
  canManage,
  working,
  onIssue,
}) {
  const availability = documentAvailability(definition.code, snapshot, selectedPaymentId);
  return (
    <article className={`finance-docs__document-card ${availability.available ? "" : "is-disabled"}`}>
      <div className="finance-docs__document-icon" aria-hidden="true">
        {definition.category === "receipt"
          ? "▤"
          : definition.category === "agreement"
            ? "✍"
            : definition.category === "completion"
              ? "✓"
              : "▦"}
      </div>
      <div className="finance-docs__document-copy">
        <small>{definition.short_title}</small>
        <h3>{definition.title}</h3>
        <p>{availability.note}</p>
        <span>{definition.formats.map((format) => format.toUpperCase()).join(" · ")}</span>
      </div>
      <div className="finance-docs__document-actions">
        {definition.formats.includes("pdf") ? (
          <button
            type="button"
            className="is-primary"
            disabled={!canManage || !availability.available || Boolean(working)}
            onClick={() => onIssue(definition.code, "pdf")}
          >
            {working === `${definition.code}:pdf` ? "Issuing…" : "Issue PDF"}
          </button>
        ) : null}
        {definition.formats.includes("word") ? (
          <button
            type="button"
            disabled={!canManage || !availability.available || Boolean(working)}
            onClick={() => onIssue(definition.code, "word")}
          >
            {working === `${definition.code}:word` ? "Issuing…" : "Issue Word"}
          </button>
        ) : null}
        {definition.formats.includes("thermal") ? (
          <button
            type="button"
            disabled={!canManage || !availability.available || Boolean(working)}
            onClick={() => onIssue(definition.code, "thermal")}
          >
            {working === `${definition.code}:thermal` ? "Issuing…" : "Thermal Receipt"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function EquipmentFinanceDocumentCentrePage() {
  const location = useLocation();
  const requestedAgreement = new URLSearchParams(location.search).get("agreement");
  const { effectivePermissions = [], user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canManage =
    effectivePermissions.includes("fleet.assets.manage") ||
    ["admin", "administrator", "system_administrator", "super_admin"].includes(role);

  const [accounts, setAccounts] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [agreementId, setAgreementId] = useState(requestedAgreement || "");
  const [snapshot, setSnapshot] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [working, setWorking] = useState("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const loadBase = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const [accountsResponse, optionsResponse] = await Promise.all([
        axiosClient.get(ACCOUNTS_API),
        axiosClient.get(`${COMPLETION_API}/options`),
      ]);
      const nextAccounts = accountsResponse.data?.accounts || [];
      setAccounts(nextAccounts);
      setDefinitions(optionsResponse.data?.documents || []);
      setAgreementId((current) => current || String(nextAccounts[0]?.agreement_id || ""));
    } catch (error) {
      setProblem(errorMessage(error, "Could not prepare the Finance Document Centre."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgreement = useCallback(async (selectedAgreementId) => {
    if (!selectedAgreementId) {
      setSnapshot(null);
      setDocuments([]);
      setSelectedPaymentId("");
      return;
    }
    setPreviewLoading(true);
    setProblem("");
    try {
      const [previewResponse, documentResponse] = await Promise.all([
        axiosClient.get(`${PROFESSIONAL_API}/agreements/${selectedAgreementId}/preview`),
        axiosClient.get(DOCUMENTS_API, {
          params: { agreement_id: selectedAgreementId, limit: 500 },
        }),
      ]);
      const nextSnapshot = previewResponse.data?.snapshot || null;
      setSnapshot(nextSnapshot);
      setDocuments(documentResponse.data?.documents || []);
      setSelectedPaymentId((current) => {
        if (current && nextSnapshot?.payments?.some((item) => String(item.id) === current)) {
          return current;
        }
        return nextSnapshot?.payments?.at(-1)?.id
          ? String(nextSnapshot.payments.at(-1).id)
          : "";
      });
    } catch (error) {
      setProblem(errorMessage(error, "Could not open the selected agreement document file."));
      setSnapshot(null);
      setDocuments([]);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  useEffect(() => {
    loadAgreement(agreementId);
  }, [agreementId, loadAgreement]);

  const selectedAccount = accounts.find(
    (account) => String(account.agreement_id) === String(agreementId)
  );
  const definitionsByCode = useMemo(
    () => new Map(definitions.map((item) => [item.code, item])),
    [definitions]
  );
  const primaryPhoto = useMemo(() => {
    return (
      snapshot?.media?.find((item) => item.evidence_type === "main")?.file_url ||
      snapshot?.media?.find((item) => item.is_primary)?.file_url ||
      snapshot?.agreement?.main_image_url ||
      ""
    );
  }, [snapshot]);

  async function downloadDocument(documentId, format, fallbackName) {
    const response = await axiosClient.get(`${COMPLETION_API}/${documentId}/download`, {
      params: { format },
      responseType: "blob",
    });
    const fileName = safeFileNameFromDisposition(
      response.headers?.["content-disposition"],
      fallbackName
    );
    const url = URL.createObjectURL(response.data);
    if (format === "print") {
      const printWindow = window.open(url, "_blank", "noopener,noreferrer");
      if (!printWindow) {
        URL.revokeObjectURL(url);
        throw new Error("The browser blocked the print document. Allow pop-ups and try again.");
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function issueDocument(documentType, format) {
    if (!agreementId) return;
    const key = `${documentType}:${format}`;
    setWorking(key);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(`${COMPLETION_API}/issue`, {
        agreement_id: Number(agreementId),
        document_type: documentType,
        format,
        payment_id:
          documentType === "payment_receipt" && selectedPaymentId
            ? Number(selectedPaymentId)
            : null,
      });
      const document = response.data?.document;
      setNotice(response.data?.message || "Professional Finance document issued.");
      if (document?.id) {
        await downloadDocument(
          document.id,
          format,
          `${document.document_number}.${format === "word" ? "doc" : "pdf"}`
        );
      }
      await loadAgreement(agreementId);
    } catch (error) {
      setProblem(errorMessage(error, "Could not issue the selected Finance document."));
    } finally {
      setWorking("");
    }
  }

  async function downloadExisting(document, format) {
    setWorking(`download:${document.id}:${format}`);
    setProblem("");
    try {
      await downloadDocument(
        document.id,
        format,
        `${document.document_number}.${format === "word" ? "doc" : "pdf"}`
      );
    } catch (error) {
      setProblem(errorMessage(error, "Could not download the issued Finance document."));
    } finally {
      setWorking("");
    }
  }

  return (
    <main className="finance-docs" data-testid="finance-document-centre">
      <header className="finance-docs__hero">
        <div className="finance-docs__brand-mark" aria-hidden="true">C03</div>
        <div>
          <p>Professional agreements, receipts and customer records</p>
          <h1>Finance Document Centre</h1>
          <span>
            Issue beautifully branded, checksum-protected Chalin 03 documents from the exact
            reconciled customer, machine, schedule, payment and lifecycle evidence.
          </span>
        </div>
        <div className="finance-docs__hero-actions">
          <Link to="/equipment-installment-finance/applications?stage=accounts">Active Installments</Link>
          <Link to="/equipment-installment-finance/applications?stage=collections">Payments Centre</Link>
          <Link to="/equipment-installment-finance/applications?stage=case-workspace">Secure Evidence</Link>
        </div>
      </header>

      {problem ? <div className="finance-docs__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-docs__notice is-success" role="status">{notice}</div> : null}
      {!canManage ? (
        <div className="finance-docs__notice">
          Your access is read-only. You may download issued documents, but issuing a new immutable
          document requires authorised Finance management access.
        </div>
      ) : null}

      <section className="finance-docs__account-picker">
        <label>
          <span>Select installment account</span>
          <select
            value={agreementId}
            onChange={(event) => setAgreementId(event.target.value)}
            disabled={loading}
          >
            <option value="">Choose customer agreement</option>
            {accounts.map((account) => (
              <option key={account.agreement_id} value={account.agreement_id}>
                {account.agreement_number} — {account.customer_name} — {account.asset_code} {account.asset_name}
              </option>
            ))}
          </select>
        </label>
        {selectedAccount ? (
          <div className="finance-docs__account-actions">
            <Link to={`/equipment-installment-finance/applications?stage=customer-portfolios&customer=${selectedAccount.customer_id}`}>
              Customer Profile
            </Link>
            <Link to={`/equipment-installment-finance/applications?stage=case-operations&case_type=agreement&case_id=${selectedAccount.agreement_id}`}>
              Case History
            </Link>
          </div>
        ) : null}
      </section>

      {loading || previewLoading ? (
        <div className="finance-docs__empty">Preparing the protected document file…</div>
      ) : null}

      {!loading && !previewLoading && snapshot ? (
        <>
          <section className="finance-docs__summary">
            <div className="finance-docs__machine-preview">
              {primaryPhoto ? (
                <img src={primaryPhoto} alt={snapshot.agreement?.asset_name || "Excavator"} />
              ) : (
                <span>No machine photo available</span>
              )}
            </div>
            <div className="finance-docs__summary-content">
              <p>{snapshot.agreement?.agreement_number}</p>
              <h2>{snapshot.agreement?.kyc_customer_name || snapshot.agreement?.customer_name_snapshot}</h2>
              <span>{snapshot.agreement?.asset_code} — {snapshot.agreement?.asset_name}</span>
              <div className="finance-docs__facts">
                <div><span>Purchase price</span><strong>{money(snapshot.agreement?.total_amount)}</strong></div>
                <div><span>Total paid</span><strong>{money(snapshot.agreement?.amount_paid)}</strong></div>
                <div><span>Official balance</span><strong>{money(snapshot.agreement?.outstanding_balance)}</strong></div>
                <div><span>Overdue</span><strong>{money(overdueAmount(snapshot.schedule))}</strong></div>
                <div><span>Schedule</span><strong>{snapshot.schedule?.length || 0} payment(s)</strong></div>
                <div><span>Snapshot</span><strong>{snapshot.reconciliation?.consistent ? "Reconciled" : "Mismatch"}</strong></div>
              </div>
            </div>
          </section>

          <section className="finance-docs__receipt-selector">
            <div>
              <p>Exact payment receipt</p>
              <h2>Choose the payment before issuing a receipt</h2>
              <span>Thermal and A4 receipts use the same committed payment and allocation evidence.</span>
            </div>
            <select value={selectedPaymentId} onChange={(event) => setSelectedPaymentId(event.target.value)}>
              <option value="">Choose payment receipt</option>
              {(snapshot.payments || []).map((payment) => (
                <option key={payment.id} value={payment.id}>
                  {payment.receipt_number || payment.payment_number} — {dateLabel(payment.payment_date)} — {money(payment.amount)}
                </option>
              ))}
            </select>
          </section>

          {GROUPS.map((group) => (
            <section className="finance-docs__group" key={group.code}>
              <div className="finance-docs__section-heading">
                <div>
                  <p>{group.code}</p>
                  <h2>{group.title}</h2>
                  <span>{group.description}</span>
                </div>
              </div>
              <div className="finance-docs__document-grid">
                {group.types.map((type) => {
                  const definition = definitionsByCode.get(type);
                  return definition ? (
                    <DocumentCard
                      key={type}
                      definition={definition}
                      snapshot={snapshot}
                      selectedPaymentId={selectedPaymentId}
                      canManage={canManage}
                      working={working}
                      onIssue={issueDocument}
                    />
                  ) : null;
                })}
              </div>
            </section>
          ))}
        </>
      ) : null}

      <section className="finance-docs__history">
        <div className="finance-docs__section-heading">
          <div>
            <p>Immutable document history</p>
            <h2>Issued documents</h2>
            <span>Every document keeps its original data snapshot, template version and SHA-256 checksum.</span>
          </div>
          <strong>{documents.length}</strong>
        </div>
        <div className="finance-docs__history-list">
          {documents.map((item) => {
            const definition = definitionsByCode.get(item.document_type);
            const formats = definition?.formats || ["pdf", "word", "print"];
            return (
              <article key={item.id}>
                <div>
                  <small>{definition?.short_title || label(item.document_type)}</small>
                  <h3>{item.document_number}</h3>
                  <p>{item.customer_name_snapshot} · {item.asset_name_snapshot}</p>
                  <span>Issued {dateLabel(item.issued_at)} · Terms {item.template_version}</span>
                  <code>{String(item.snapshot_checksum || "").slice(0, 20)}…</code>
                </div>
                <div className="finance-docs__history-actions">
                  {formats.includes("pdf") ? (
                    <button type="button" onClick={() => downloadExisting(item, "pdf")} disabled={Boolean(working)}>PDF</button>
                  ) : null}
                  {formats.includes("word") ? (
                    <button type="button" onClick={() => downloadExisting(item, "word")} disabled={Boolean(working)}>Word</button>
                  ) : null}
                  {formats.includes("print") ? (
                    <button type="button" onClick={() => downloadExisting(item, "print")} disabled={Boolean(working)}>Print</button>
                  ) : null}
                  {formats.includes("thermal") ? (
                    <button type="button" onClick={() => downloadExisting(item, "thermal")} disabled={Boolean(working)}>Thermal</button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!documents.length ? (
            <div className="finance-docs__empty">No professional document has been issued for this agreement yet.</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
