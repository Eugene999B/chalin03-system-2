import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinanceOperationalPolish.css";

const API = "/equipment-catalogue/sales/operational-polish";
const TABS = new Set(["inbox", "case", "documents", "alerts", "schedule", "amendments", "receipts"]);
const CASE_TABS = new Set(["case", "documents", "alerts", "schedule", "amendments", "receipts"]);
const CASE_PAGE_SIZE = 25;
const INBOX_PAGE_SIZE = 25;
const DOCUMENT_CATEGORIES = [
  ["kyc_identity", "Buyer identity evidence"],
  ["kyc_address", "Proof of address"],
  ["kyc_income", "Income evidence"],
  ["guarantor_identity", "Guarantor identity evidence"],
  ["guarantor_undertaking", "Guarantor undertaking"],
  ["agreement_attachment", "Agreement attachment"],
  ["other", "Other controlled evidence"],
];

const EMPTY_TASK = {
  title: "",
  description: "",
  priority: "normal",
  assigned_role: "",
  due_at: "",
  approval_required: false,
};
const EMPTY_UPLOAD = {
  document_category: "kyc_identity",
  document_label: "Buyer identity evidence",
  file: null,
  notes: "",
  is_sensitive: true,
};
const EMPTY_SCHEDULE = {
  simulation_name: "",
  purchase_price: "",
  deposit: "",
  finance_charge: "0",
  installment_count: "12",
  payment_frequency: "monthly",
  first_due_date: "",
  custom_interval_days: "30",
  simulated_payment: "0",
};
const EMPTY_AMENDMENT = {
  amendment_type: "case_correction",
  reason: "",
  effective_date: "",
  fields: [{ key: "customer_phone", value: "" }],
};

function clean(value) {
  return String(value || "").trim();
}

function label(value) {
  return clean(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-GH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function dateOnly(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString("en-GH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
}

function message(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function caseKey(item) {
  return `${item.case_type}:${item.case_id}`;
}

function parseCaseKey(value) {
  const [caseType, rawId] = String(value || "").split(":");
  const caseId = Number(rawId);
  return ["application", "agreement"].includes(caseType) && Number.isInteger(caseId) && caseId > 0
    ? { caseType, caseId }
    : null;
}

async function downloadProtected(path, fallbackName = "finance-document") {
  const response = await axiosClient.get(path, { responseType: "blob" });
  const disposition = response.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = match?.[1] || fallbackName;
  const url = window.URL.createObjectURL(response.data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function Metric({ title, value, note, tone = "" }) {
  return (
    <article className={`finance-ops__metric ${tone ? `is-${tone}` : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function CasePicker({
  cases,
  selectedKey,
  onChange,
  search,
  setSearch,
  pagination,
  onPrevious,
  onNext,
  loading,
}) {
  return (
    <div className="finance-ops__case-picker">
      <label>
        <span>Search Finance case</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Agreement, application, customer, phone or excavator"
        />
      </label>
      <label>
        <span>Selected case</span>
        <select value={selectedKey} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose application or active installment</option>
          {cases.map((item) => (
            <option key={caseKey(item)} value={caseKey(item)}>
              {item.case_number} — {item.customer_name} — {item.asset_label}
            </option>
          ))}
        </select>
      </label>
      <div className="finance-ops__pagination" aria-label="Finance case pages">
        <button
          type="button"
          disabled={loading || !pagination?.has_previous_page}
          onClick={onPrevious}
        >
          Previous
        </button>
        <span>
          Page {pagination?.page || 1} of {pagination?.total_pages || 1}{" \u00b7 "}{pagination?.total || 0} cases
        </span>
        <button
          type="button"
          disabled={loading || !pagination?.has_next_page}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function Notice({ tone = "info", children }) {
  return <div className={`finance-ops__notice is-${tone}`}>{children}</div>;
}

export default function EquipmentFinanceOperationalPolishPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { effectivePermissions = [] } = useAuth();
  const canManage = effectivePermissions.includes("fleet.assets.manage");
  const requestedTab = new URLSearchParams(location.search).get("tab") || "inbox";
  const tab = TABS.has(requestedTab) ? requestedTab : "inbox";
  const requestedCaseKey = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const caseType = params.get("case_type");
    const caseId = Number(params.get("case_id"));
    return ["application", "agreement"].includes(caseType) && Number.isInteger(caseId) && caseId > 0
      ? `${caseType}:${caseId}`
      : "";
  }, [location.search]);

  const [bootstrap, setBootstrap] = useState({
    cases: [],
    inbox: { items: [], summary: {} },
    alerts: [],
    policy: {},
    pagination: { page: 1, total_pages: 1, total: 0 },
  });
  const [caseData, setCaseData] = useState(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [casePage, setCasePage] = useState(1);
  const [inboxPage, setInboxPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [caseLoading, setCaseLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [uploadForm, setUploadForm] = useState(EMPTY_UPLOAD);
  const [scheduleForm, setScheduleForm] = useState(EMPTY_SCHEDULE);
  const [simulation, setSimulation] = useState(null);
  const [amendmentForm, setAmendmentForm] = useState(EMPTY_AMENDMENT);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [shareChannel, setShareChannel] = useState("sms");
  const [shareRecipient, setShareRecipient] = useState("");
  const bootstrapAbortRef = useRef(null);
  const caseAbortRef = useRef(null);

  const selectedIdentity = useMemo(() => parseCaseKey(selectedKey), [selectedKey]);

  const openTab = useCallback(
    (nextTab, identity = selectedIdentity) => {
      const params = new URLSearchParams();
      params.set("stage", "operations");
      params.set("tab", nextTab);
      if (identity) {
        params.set("case_type", identity.caseType);
        params.set("case_id", identity.caseId);
      }
      navigate(`/equipment-installment-finance/applications?${params.toString()}`);
    },
    [navigate, selectedIdentity]
  );

  const loadBootstrap = useCallback(async () => {
    bootstrapAbortRef.current?.abort();
    const controller = new AbortController();
    bootstrapAbortRef.current = controller;
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/bootstrap`, {
        params: {
          page: casePage,
          page_size: CASE_PAGE_SIZE,
          search: caseSearch.trim() || undefined,
          inbox_page: inboxPage,
          inbox_page_size: INBOX_PAGE_SIZE,
        },
        signal: controller.signal,
      });
      const next = response.data || {};
      setBootstrap({
        cases: next.cases || [],
        inbox: next.inbox || { items: [], summary: {} },
        alerts: next.alerts || [],
        policy: next.policy || {},
        settings: next.settings || null,
        pagination: next.pagination || { page: 1, total_pages: 1, total: 0 },
      });
      setSelectedKey((current) => {
        if (requestedCaseKey) return requestedCaseKey;
        if (current && next.cases?.some((item) => caseKey(item) === current)) return current;
        return next.cases?.[0] ? caseKey(next.cases[0]) : "";
      });
    } catch (error) {
      if (error?.code !== "ERR_CANCELED") {
        setProblem(message(error, "Could not load Finance operations."));
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [casePage, caseSearch, inboxPage, requestedCaseKey]);

  const loadCase = useCallback(async (identity = selectedIdentity) => {
    caseAbortRef.current?.abort();
    if (!identity) {
      setCaseData(null);
      setCaseLoading(false);
      return;
    }
    const controller = new AbortController();
    caseAbortRef.current = controller;
    setCaseLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(
        `${API}/cases/${identity.caseType}/${identity.caseId}`,
        { signal: controller.signal }
      );
      const data = response.data || {};
      setCaseData(data);
      const record = data.case || {};
      setScheduleForm((current) => ({
        ...current,
        purchase_price: current.purchase_price || String(record.total_amount || record.application_financed_amount || ""),
        deposit: current.deposit || String(record.deposit_required || record.proposed_deposit || ""),
        installment_count: current.installment_count || String(record.installment_count || record.proposed_installment_count || 12),
        payment_frequency: record.payment_frequency || record.proposed_frequency || current.payment_frequency,
        first_due_date: record.first_due_date ? String(record.first_due_date).slice(0, 10) : current.first_due_date,
      }));
      setSelectedPaymentId((current) =>
        data.payments?.some((payment) => String(payment.id) === String(current))
          ? current
          : data.payments?.[0]?.id
            ? String(data.payments[0].id)
            : ""
      );
    } catch (error) {
      if (error?.code !== "ERR_CANCELED") {
        setProblem(message(error, "Could not load the selected Finance case."));
      }
    } finally {
      if (!controller.signal.aborted) setCaseLoading(false);
    }
  }, [selectedIdentity]);

  useEffect(() => {
    const timer = window.setTimeout(loadBootstrap, caseSearch ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      bootstrapAbortRef.current?.abort();
    };
  }, [caseSearch, loadBootstrap]);

  useEffect(() => {
    if (!CASE_TABS.has(tab)) {
      caseAbortRef.current?.abort();
      setCaseLoading(false);
      return undefined;
    }
    if (selectedIdentity) loadCase(selectedIdentity);
    return () => caseAbortRef.current?.abort();
    // selectedIdentity is derived from selectedKey; reload only when the key or tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, tab]);

  useEffect(() => {
    setReceipt(null);
    setSelectedPaymentId("");
    setSimulation(null);
  }, [selectedKey]);

  async function runAction(key, action, successText, { reloadCase = true, reloadBootstrap = true } = {}) {
    setBusy(key);
    setProblem("");
    setNotice("");
    try {
      const result = await action();
      setNotice(result?.data?.message || successText);
      if (reloadBootstrap) await loadBootstrap();
      if (reloadCase && selectedIdentity) await loadCase(selectedIdentity);
      return result;
    } catch (error) {
      setProblem(message(error, "The Finance action could not be completed."));
      return null;
    } finally {
      setBusy("");
    }
  }

  function chooseCase(value, nextTab = tab) {
    setSelectedKey(value);
    const identity = parseCaseKey(value);
    if (identity) openTab(nextTab, identity);
  }

  function openInboxItem(item) {
    const type = item.agreement_id ? "agreement" : "application";
    const id = item.agreement_id || item.application_id;
    if (id) {
      setSelectedKey(`${type}:${id}`);
      openTab(item.action_tab || "case", { caseType: type, caseId: Number(id) });
    }
  }

  async function completeTask(item) {
    if (!item.stored_task_id) return;
    await runAction(
      `task:${item.stored_task_id}`,
      () => axiosClient.patch(`${API}/tasks/${item.stored_task_id}`, { task_status: "completed" }),
      "Task completed."
    );
  }

  async function createTask(event) {
    event.preventDefault();
    if (!selectedIdentity) return;
    const result = await runAction(
      "task:create",
      () =>
        axiosClient.post(`${API}/tasks`, {
          ...taskForm,
          case_type: selectedIdentity.caseType,
          case_id: selectedIdentity.caseId,
        }),
      "Task created."
    );
    if (result) setTaskForm(EMPTY_TASK);
  }

  async function uploadDocument(event) {
    event.preventDefault();
    if (!selectedIdentity || !uploadForm.file) {
      setProblem("Choose a case and a PDF or image file first.");
      return;
    }
    if (uploadForm.file.size > 8 * 1024 * 1024) {
      setProblem("The selected file exceeds the protected 8 MB limit.");
      return;
    }
    setBusy("document:upload");
    setProblem("");
    setNotice("");
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("The selected file could not be read."));
        reader.readAsDataURL(uploadForm.file);
      });
      const response = await axiosClient.post(
        `${API}/cases/${selectedIdentity.caseType}/${selectedIdentity.caseId}/documents`,
        {
          document_category: uploadForm.document_category,
          document_label: uploadForm.document_label,
          file_name: uploadForm.file.name,
          data_url: dataUrl,
          notes: uploadForm.notes,
          is_sensitive: uploadForm.is_sensitive,
        }
      );
      setNotice(response.data?.message || "Protected document uploaded.");
      setUploadForm(EMPTY_UPLOAD);
      await loadBootstrap();
      await loadCase(selectedIdentity);
    } catch (error) {
      setProblem(message(error, "Could not upload the protected Finance document."));
    } finally {
      setBusy("");
    }
  }

  async function reviewDocument(document, status) {
    const reason =
      status === "rejected"
        ? window.prompt("Record the document rejection reason:", "The uploaded evidence is unclear or incomplete.")
        : "Verified against the Finance case file.";
    if (!reason) return;
    await runAction(
      `document:${document.id}:${status}`,
      () =>
        axiosClient.patch(`${API}/documents/${document.id}/review`, {
          document_status: status,
          reason,
        }),
      `Document ${status}.`
    );
  }

  async function approveCaseDocument(document, status) {
    const reason =
      status === "rejected"
        ? window.prompt(
            "Record the independent approval rejection reason:",
            "The verified evidence does not satisfy the approval policy."
          )
        : "Approved after independent review of the Finance evidence.";
    if (!reason) return;
    await runAction(
      `document:${document.id}:approval:${status}`,
      () =>
        axiosClient.patch(`${API}/documents/${document.id}/approval`, {
          approval_status: status,
          reason,
        }),
      `Document ${status}.`
    );
  }

  async function calculateSchedule(event) {
    event.preventDefault();
    setBusy("schedule:calculate");
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/schedule/simulate`, scheduleForm);
      setSimulation(response.data?.simulation || null);
      setNotice("Schedule calculated without changing the live account.");
    } catch (error) {
      setProblem(message(error, "Could not calculate the schedule."));
    } finally {
      setBusy("");
    }
  }

  async function saveSimulation() {
    if (!selectedIdentity) return;
    const result = await runAction(
      "schedule:save",
      () =>
        axiosClient.post(`${API}/schedule/simulations`, {
          ...scheduleForm,
          case_type: selectedIdentity.caseType,
          case_id: selectedIdentity.caseId,
          simulation_name:
            scheduleForm.simulation_name || `${caseData?.case?.case_number || "Finance"} plan`,
        }),
      "Schedule simulation saved."
    );
    if (result) setSimulation(result.data?.simulation?.result || simulation);
  }

  function updateAmendmentField(index, property, value) {
    setAmendmentForm((current) => ({
      ...current,
      fields: current.fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, [property]: value } : field
      ),
    }));
  }

  function addAmendmentField() {
    setAmendmentForm((current) => ({
      ...current,
      fields: [...current.fields, { key: "", value: "" }],
    }));
  }

  async function submitAmendment(event) {
    event.preventDefault();
    if (!selectedIdentity) return;
    const proposedChanges = Object.fromEntries(
      amendmentForm.fields
        .map((field) => [clean(field.key), clean(field.value)])
        .filter(([key, value]) => key && value)
    );
    const result = await runAction(
      "amendment:create",
      () =>
        axiosClient.post(
          `${API}/cases/${selectedIdentity.caseType}/${selectedIdentity.caseId}/amendments`,
          {
            amendment_type: amendmentForm.amendment_type,
            reason: amendmentForm.reason,
            effective_date: amendmentForm.effective_date || null,
            proposed_changes: proposedChanges,
          }
        ),
      "Numbered amendment submitted."
    );
    if (result) setAmendmentForm(EMPTY_AMENDMENT);
  }

  async function decideAmendment(amendment, decision) {
    const reason = window.prompt(
      `Reason for ${decision}:`,
      decision === "approved"
        ? "Reviewed against the case evidence and approved."
        : "The proposed change is not supported by the case evidence."
    );
    if (!reason) return;
    await runAction(
      `amendment:${amendment.id}:${decision}`,
      () =>
        axiosClient.patch(`${API}/amendments/${amendment.id}/decision`, {
          decision,
          decision_reason: reason,
        }),
      `Amendment ${decision}.`
    );
  }

  async function applyApprovedAmendment(amendment) {
    if (
      !window.confirm(
        `Apply ${amendment.amendment_number}? Financial fields will remain original records and become a numbered variation.`
      )
    ) {
      return;
    }
    await runAction(
      `amendment:${amendment.id}:apply`,
      () => axiosClient.post(`${API}/amendments/${amendment.id}/apply`),
      "Approved amendment applied."
    );
  }

  async function loadReceipt(paymentId = selectedPaymentId) {
    if (!paymentId) return;
    setBusy(`receipt:${paymentId}`);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/payments/${paymentId}/receipt`);
      setReceipt(response.data || null);
      setShareRecipient(response.data?.thermal_receipt?.customer_phone || "");
    } catch (error) {
      setProblem(message(error, "Could not load the payment receipt."));
    } finally {
      setBusy("");
    }
  }

  async function issueReceipt() {
    if (!selectedPaymentId) return;
    await runAction(
      `receipt:${selectedPaymentId}:issue`,
      () => axiosClient.post(`${API}/payments/${selectedPaymentId}/receipt/issue`),
      "Thermal receipt issued.",
      { reloadCase: false, reloadBootstrap: false }
    );
    await loadReceipt(selectedPaymentId);
  }

  async function shareReceipt() {
    if (!selectedPaymentId) return;
    const result = await runAction(
      `receipt:${selectedPaymentId}:share`,
      () =>
        axiosClient.post(`${API}/payments/${selectedPaymentId}/share`, {
          channel: shareChannel,
          recipient: shareRecipient,
        }),
      "Receipt sharing evidence recorded.",
      { reloadCase: false, reloadBootstrap: true }
    );
    const share = result?.data?.share;
    if (share?.message && shareChannel === "copy") {
      await navigator.clipboard.writeText(share.message);
      setNotice("Receipt message copied and sharing evidence recorded.");
    }
    if (share?.launch_url) window.open(share.launch_url, "_blank", "noopener,noreferrer");
    await loadReceipt(selectedPaymentId);
  }

  async function retryBossAlert() {
    if (!selectedPaymentId) return;
    await runAction(
      `receipt:${selectedPaymentId}:boss`,
      () => axiosClient.post(`${API}/payments/${selectedPaymentId}/boss-alert/retry`),
      "Boss alert retry completed.",
      { reloadCase: false, reloadBootstrap: true }
    );
    await loadReceipt(selectedPaymentId);
  }

  async function shareIssuedDocument(document) {
    const channel = window.prompt(
      "Share channel: sms, whatsapp, email, copy, download or print",
      "whatsapp"
    );
    if (!channel) return;
    if (["download", "print"].includes(channel.toLowerCase())) {
      await downloadProtected(
        `/equipment-catalogue/sales/professional/documents/${document.id}/download?format=${
          channel.toLowerCase() === "print" ? "print" : document.document_format || "pdf"
        }`,
        document.document_number
      );
    }
    const recipient = ["sms", "whatsapp", "email"].includes(channel.toLowerCase())
      ? window.prompt("Recipient phone or email:", caseData?.case?.customer_phone || "")
      : "";
    const result = await runAction(
      `issued:${document.id}:share`,
      () =>
        axiosClient.post(`${API}/issued-documents/${document.id}/share`, {
          channel: channel.toLowerCase(),
          recipient,
        }),
      "Document sharing evidence recorded.",
      { reloadCase: true, reloadBootstrap: false }
    );
    const share = result?.data?.share;
    if (share?.message && channel.toLowerCase() === "copy") {
      await navigator.clipboard.writeText(share.message);
    }
    if (share?.launch_url) window.open(share.launch_url, "_blank", "noopener,noreferrer");
  }

  const tabs = [
    ["inbox", "Task & Approval Inbox"],
    ["case", "Case Timeline"],
    ["documents", "Secure Documents"],
    ["alerts", "Missing & Quality Alerts"],
    ["schedule", "Schedule Simulator"],
    ["amendments", "Corrections & Amendments"],
    ["receipts", "Receipts & Sharing"],
  ];

  const selectedCaseSummary = bootstrap.cases.find((item) => caseKey(item) === selectedKey);
  const visibleCaseAlerts = caseData?.alerts || [];

  return (
    <main className="finance-ops">
      <header className="finance-ops__hero">
        <div>
          <p>Phase 3 — Operational polish</p>
          <h1>Finance Operations Centre</h1>
          <span>
            Secure case evidence, complete chronology, approvals, data-quality controls,
            simulations, governed amendments and professional receipt follow-up.
          </span>
        </div>
        <div className="finance-ops__hero-actions">
          <button type="button" onClick={loadBootstrap} disabled={loading || Boolean(busy)}>
            Refresh controls
          </button>
          <button type="button" onClick={() => openTab("inbox")}>
            Open inbox ({bootstrap.inbox?.summary?.total || 0})
          </button>
        </div>
      </header>

      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {!canManage ? (
        <Notice>
          Your access is read-only. You can inspect cases, timelines, evidence and simulations,
          but controlled uploads, approvals, amendments and sharing require a Finance work role.
        </Notice>
      ) : null}

      <section className="finance-ops__metrics">
        <Metric
          title="Finance cases"
          value={bootstrap.pagination?.total || 0}
          note="Paginated applications and agreements"
        />
        <Metric
          title="Inbox items"
          value={bootstrap.inbox?.summary?.total || 0}
          note={`${bootstrap.inbox?.summary?.approvals || 0} approval or verification item(s)`}
          tone={(bootstrap.inbox?.summary?.critical || 0) > 0 ? "critical" : ""}
        />
        <Metric
          title="Critical work"
          value={bootstrap.inbox?.summary?.critical || 0}
          note="Requires immediate attention"
          tone="critical"
        />
        <Metric
          title="Quality alerts"
          value={bootstrap.inbox?.summary?.data_quality || 0}
          note="Missing documents or incomplete data"
          tone={(bootstrap.inbox?.summary?.data_quality || 0) > 0 ? "warning" : ""}
        />
      </section>

      <CasePicker
        cases={bootstrap.cases}
        selectedKey={selectedKey}
        onChange={chooseCase}
        search={caseSearch}
        setSearch={(value) => {
          setCaseSearch(value);
          setCasePage(1);
        }}
        pagination={bootstrap.pagination}
        onPrevious={() => setCasePage((current) => Math.max(1, current - 1))}
        onNext={() => setCasePage((current) => current + 1)}
        loading={loading}
      />

      {selectedCaseSummary ? (
        <section className="finance-ops__selected-case">
          <div>
            <small>{label(selectedCaseSummary.case_type)}</small>
            <strong>{selectedCaseSummary.case_number}</strong>
            <span>{selectedCaseSummary.customer_name} · {selectedCaseSummary.asset_label}</span>
          </div>
          <div>
            <span className={`finance-ops__status is-${selectedCaseSummary.status}`}>
              {label(selectedCaseSummary.status)}
            </span>
            {selectedCaseSummary.agreement_id ? (
              <strong>{money(selectedCaseSummary.outstanding_balance)} outstanding</strong>
            ) : null}
          </div>
        </section>
      ) : null}

      {caseData?.reconciliation?.consistent === false ? (
        <div className="finance-ops__notice is-warning" data-testid="operations-reconciliation-warning">
          This agreement does not reconcile with its active receipts, allocations, schedule and ledger. Financial and completion actions must remain blocked until the evidence is corrected.
        </div>
      ) : null}

      <nav className="finance-ops__tabs" aria-label="Finance operational sections">
        {tabs.map(([code, title]) => (
          <button
            type="button"
            key={code}
            className={tab === code ? "is-active" : ""}
            onClick={() => openTab(code)}
          >
            {title}
          </button>
        ))}
      </nav>

      {loading || caseLoading ? (
        <div className="finance-ops__empty">Loading protected Finance operations…</div>
      ) : null}

      {!loading && tab === "inbox" ? (
        <section className="finance-ops__panel">
          <div className="finance-ops__section-heading">
            <div>
              <p>One work queue</p>
              <h2>Tasks, approvals and exceptions</h2>
              <span>Highest risk and overdue work appears first.</span>
            </div>
          </div>
          {!bootstrap.inbox?.items?.length ? (
            <div className="finance-ops__empty">The Finance inbox is clear.</div>
          ) : (
            <div className="finance-ops__inbox-list">
              {bootstrap.inbox.items.map((item) => (
                <article key={item.id} className={`is-${item.priority || "normal"}`}>
                  <div>
                    <span>{label(item.source)} · {label(item.priority)}</span>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                    <small>{item.due_at ? `Due or recorded ${dateTime(item.due_at)}` : "No due date recorded"}</small>
                  </div>
                  <div>
                    <button type="button" onClick={() => openInboxItem(item)}>Open case</button>
                    {canManage && item.stored_task_id ? (
                      <button
                        type="button"
                        disabled={busy === `task:${item.stored_task_id}`}
                        onClick={() => completeTask(item)}
                      >
                        Complete task
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="finance-ops__pagination" aria-label="Finance inbox pages">
            <button
              type="button"
              disabled={loading || !bootstrap.inbox?.pagination?.has_previous_page}
              onClick={() => setInboxPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span>
              Page {bootstrap.inbox?.pagination?.page || 1}{" \u00b7 "}{bootstrap.inbox?.summary?.total || 0}
              {bootstrap.inbox?.summary?.total_is_lower_bound ? "+" : ""} queued
            </span>
            <button
              type="button"
              disabled={loading || !bootstrap.inbox?.pagination?.has_next_page}
              onClick={() => setInboxPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </section>
      ) : null}

      {!caseLoading && tab === "case" ? (
        <>
          {!caseData ? (
            <div className="finance-ops__empty">Choose a Finance case to open its full timeline.</div>
          ) : (
            <>
              <section className="finance-ops__panel">
                <div className="finance-ops__section-heading">
                  <div>
                    <p>Complete evidence chronology</p>
                    <h2>{caseData.case?.case_number}</h2>
                    <span>
                      Application, approval, agreement, deposit, payment, documents, alerts,
                      delivery, ownership, tasks and amendments in one ordered record.
                    </span>
                  </div>
                  <strong>{caseData.summary?.total_events || 0} events</strong>
                </div>
                <div className="finance-ops__case-facts">
                  <div><span>Customer</span><strong>{caseData.case?.customer_name}</strong></div>
                  <div><span>Phone</span><strong>{caseData.case?.customer_phone || "Missing"}</strong></div>
                  <div><span>Excavator</span><strong>{caseData.case?.asset_code} — {caseData.case?.asset_name}</strong></div>
                  <div><span>Outstanding</span><strong>{money(caseData.case?.outstanding_balance)}</strong></div>
                </div>
                {visibleCaseAlerts.length ? (
                  <div className="finance-ops__case-alerts">
                    {visibleCaseAlerts.slice(0, 5).map((alert) => (
                      <span className={`is-${alert.severity}`} key={alert.id}>
                        {alert.title}
                      </span>
                    ))}
                    {visibleCaseAlerts.length > 5 ? (
                      <button type="button" onClick={() => openTab("alerts")}>
                        +{visibleCaseAlerts.length - 5} more
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="finance-ops__timeline">
                  {caseData.events?.map((event) => (
                    <article key={event.id}>
                      <span className="finance-ops__timeline-dot" />
                      <div>
                        <small>{dateTime(event.occurred_at)} · {label(event.type)}</small>
                        <h3>{event.title}</h3>
                        {event.description ? <p>{event.description}</p> : null}
                        {event.status ? <span className="finance-ops__status">{label(event.status)}</span> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              {canManage ? (
                <form className="finance-ops__panel finance-ops__form" onSubmit={createTask}>
                  <div className="finance-ops__section-heading">
                    <div><p>Manual follow-up</p><h2>Add case task</h2></div>
                  </div>
                  <div className="finance-ops__form-grid">
                    <label><span>Task title</span><input required value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} /></label>
                    <label><span>Priority</span><select value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
                    <label><span>Assign role</span><input value={taskForm.assigned_role} onChange={(event) => setTaskForm((current) => ({ ...current, assigned_role: event.target.value }))} placeholder="credit_officer or finance_manager" /></label>
                    <label><span>Due date and time</span><input type="datetime-local" value={taskForm.due_at} onChange={(event) => setTaskForm((current) => ({ ...current, due_at: event.target.value }))} /></label>
                    <label className="is-wide"><span>Description</span><textarea value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} /></label>
                    <label className="finance-ops__check"><input type="checkbox" checked={taskForm.approval_required} onChange={(event) => setTaskForm((current) => ({ ...current, approval_required: event.target.checked }))} /><span>Task needs an approval decision</span></label>
                  </div>
                  <button type="submit" disabled={busy === "task:create"}>Create task</button>
                </form>
              ) : null}
            </>
          )}
        </>
      ) : null}

      {!caseLoading && tab === "documents" ? (
        <>
          {!caseData ? <div className="finance-ops__empty">Choose a Finance case first.</div> : null}
          {caseData && canManage ? (
            <form className="finance-ops__panel finance-ops__form" onSubmit={uploadDocument}>
              <div className="finance-ops__section-heading">
                <div>
                  <p>Private evidence storage</p>
                  <h2>Secure document upload</h2>
                  <span>PDF, JPEG, PNG or WebP · maximum 8 MB · signature and checksum verified.</span>
                </div>
              </div>
              <div className="finance-ops__form-grid">
                <label><span>Document category</span><select value={uploadForm.document_category} onChange={(event) => { const category = DOCUMENT_CATEGORIES.find(([code]) => code === event.target.value); setUploadForm((current) => ({ ...current, document_category: event.target.value, document_label: category?.[1] || current.document_label })); }}>{DOCUMENT_CATEGORIES.map(([code, title]) => <option key={code} value={code}>{title}</option>)}</select></label>
                <label><span>Document label</span><input required value={uploadForm.document_label} onChange={(event) => setUploadForm((current) => ({ ...current, document_label: event.target.value }))} /></label>
                <label className="is-wide"><span>Select protected file</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required onChange={(event) => setUploadForm((current) => ({ ...current, file: event.target.files?.[0] || null }))} /></label>
                <label className="is-wide"><span>Evidence note</span><textarea value={uploadForm.notes} onChange={(event) => setUploadForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <label className="finance-ops__check"><input type="checkbox" checked={uploadForm.is_sensitive} onChange={(event) => setUploadForm((current) => ({ ...current, is_sensitive: event.target.checked }))} /><span>Contains sensitive personal evidence</span></label>
              </div>
              <button type="submit" disabled={busy === "document:upload"}>{busy === "document:upload" ? "Checking and uploading…" : "Upload securely"}</button>
            </form>
          ) : null}
          {caseData ? (
            <section className="finance-ops__panel">
              <div className="finance-ops__section-heading"><div><p>Protected case file</p><h2>Uploaded evidence</h2></div><strong>{caseData.documents?.length || 0}</strong></div>
              <div className="finance-ops__document-grid">
                {caseData.documents?.map((document) => (
                  <article key={document.id}>
                    <div><span>{label(document.document_category)}</span><h3>{document.document_label}</h3><p>{document.original_file_name}</p><small>{Math.ceil(document.byte_size / 1024)} KB · SHA-256 {document.checksum_sha256.slice(0, 12)}…</small></div>
                    <span className={`finance-ops__status is-${document.document_status}`}>{label(document.document_status)}</span>
                    <div className="finance-ops__card-actions">
                      <button type="button" onClick={() => downloadProtected(document.download_path, document.original_file_name)}>Download</button>
                      {canManage && document.review_status === "pending" ? <><button type="button" onClick={() => reviewDocument(document, "verified")}>Verify</button><button type="button" onClick={() => reviewDocument(document, "rejected")}>Reject review</button></> : null}
                      {canManage && document.review_status === "verified" && document.approval_status === "pending" ? <><button type="button" onClick={() => approveCaseDocument(document, "approved")}>Approve</button><button type="button" onClick={() => approveCaseDocument(document, "rejected")}>Reject approval</button></> : null}
                    </div>
                  </article>
                ))}
              </div>
              <div className="finance-ops__section-heading finance-ops__section-heading--sub"><div><p>Immutable snapshots</p><h2>Issued Finance documents</h2></div></div>
              <div className="finance-ops__document-grid">
                {caseData.issued_documents?.map((document) => (
                  <article key={document.id}>
                    <div><span>{label(document.document_type)}</span><h3>{document.document_number}</h3><p>{document.document_format.toUpperCase()} · {document.template_version}</p><small>Checksum {document.snapshot_checksum.slice(0, 12)}…</small></div>
                    <div className="finance-ops__card-actions"><button type="button" onClick={() => downloadProtected(`/equipment-catalogue/sales/professional/documents/${document.id}/download?format=${document.document_format === "print" ? "pdf" : document.document_format}`, document.document_number)}>Download</button>{canManage ? <button type="button" onClick={() => shareIssuedDocument(document)}>Share</button> : null}</div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {!caseLoading && tab === "alerts" ? (
        <section className="finance-ops__panel">
          <div className="finance-ops__section-heading"><div><p>Completeness controls</p><h2>Missing documents and data quality</h2><span>Alerts disappear only when the underlying evidence is corrected.</span></div><strong>{visibleCaseAlerts.length}</strong></div>
          {!caseData ? <div className="finance-ops__empty">Choose a Finance case first.</div> : null}
          <div className="finance-ops__alert-grid">
            {visibleCaseAlerts.map((alert) => (
              <article className={`is-${alert.severity}`} key={alert.id}>
                <span>{label(alert.severity)}</span><h3>{alert.title}</h3><p>{alert.message}</p><strong>{alert.recommended_action}</strong>
                <button type="button" onClick={() => openTab(alert.code.startsWith("document_") ? "documents" : "case")}>Resolve in case</button>
              </article>
            ))}
          </div>
          {caseData && !visibleCaseAlerts.length ? <div className="finance-ops__empty is-success">No missing-document or data-quality alert remains for this case.</div> : null}
        </section>
      ) : null}

      {!caseLoading && tab === "schedule" ? (
        <>
          <form className="finance-ops__panel finance-ops__form" onSubmit={calculateSchedule}>
            <div className="finance-ops__section-heading"><div><p>Planning only</p><h2>Schedule calculator and payment simulation</h2><span>This never changes the live agreement or payment records.</span></div></div>
            <div className="finance-ops__form-grid">
              <label><span>Simulation name</span><input value={scheduleForm.simulation_name} onChange={(event) => setScheduleForm((current) => ({ ...current, simulation_name: event.target.value }))} /></label>
              <label><span>Purchase price</span><input inputMode="decimal" required value={scheduleForm.purchase_price} onChange={(event) => setScheduleForm((current) => ({ ...current, purchase_price: event.target.value }))} /></label>
              <label><span>Deposit</span><input inputMode="decimal" required value={scheduleForm.deposit} onChange={(event) => setScheduleForm((current) => ({ ...current, deposit: event.target.value }))} /></label>
              <label><span>Finance charge</span><input inputMode="decimal" value={scheduleForm.finance_charge} onChange={(event) => setScheduleForm((current) => ({ ...current, finance_charge: event.target.value }))} /></label>
              <label><span>Installments</span><input type="number" min="1" max="520" required value={scheduleForm.installment_count} onChange={(event) => setScheduleForm((current) => ({ ...current, installment_count: event.target.value }))} /></label>
              <label><span>Frequency</span><select value={scheduleForm.payment_frequency} onChange={(event) => setScheduleForm((current) => ({ ...current, payment_frequency: event.target.value }))}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="custom">Custom days</option></select></label>
              {scheduleForm.payment_frequency === "custom" ? <label><span>Custom interval days</span><input type="number" min="1" max="365" value={scheduleForm.custom_interval_days} onChange={(event) => setScheduleForm((current) => ({ ...current, custom_interval_days: event.target.value }))} /></label> : null}
              <label><span>First due date</span><input type="date" required value={scheduleForm.first_due_date} onChange={(event) => setScheduleForm((current) => ({ ...current, first_due_date: event.target.value }))} /></label>
              <label><span>Simulate a payment</span><input inputMode="decimal" value={scheduleForm.simulated_payment} onChange={(event) => setScheduleForm((current) => ({ ...current, simulated_payment: event.target.value }))} /></label>
            </div>
            <div className="finance-ops__form-actions"><button type="submit" disabled={busy === "schedule:calculate"}>Calculate safely</button>{simulation && selectedIdentity && canManage ? <button type="button" disabled={busy === "schedule:save"} onClick={saveSimulation}>Save simulation</button> : null}</div>
          </form>
          {simulation ? (
            <section className="finance-ops__panel">
              <div className="finance-ops__metrics"><Metric title="Total repayable" value={money(simulation.totals?.total_repayable)} note="Price plus finance charge" /><Metric title="Financed balance" value={money(simulation.totals?.financed_balance)} note="After deposit" /><Metric title="Typical installment" value={money(simulation.totals?.periodic_amount)} note="Final line absorbs rounding" /><Metric title="Unapplied simulation" value={money(simulation.totals?.simulated_payment_unapplied)} note="Would be rejected above balance" /></div>
              {simulation.warnings?.map((warning) => <Notice tone="warning" key={warning}>{warning}</Notice>)}
              <div className="finance-ops__table-wrap"><table><thead><tr><th>No.</th><th>Due date</th><th>Scheduled</th><th>Simulated paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>{simulation.schedule?.map((line) => <tr key={line.sequence_number}><td>{line.sequence_number}</td><td>{dateOnly(line.due_date)}</td><td>{money(line.scheduled_amount)}</td><td>{money(line.simulated_paid)}</td><td>{money(line.simulated_balance)}</td><td>{label(line.simulated_status)}</td></tr>)}</tbody></table></div>
            </section>
          ) : null}
          {caseData?.simulations?.length ? <section className="finance-ops__panel"><div className="finance-ops__section-heading"><div><p>Checksum protected</p><h2>Saved simulations</h2></div></div><div className="finance-ops__document-grid">{caseData.simulations.map((item) => <article key={item.id}><div><span>{item.integrity_valid ? "Integrity verified" : "Integrity problem"}</span><h3>{item.simulation_name}</h3><p>{item.created_by_name || "Finance staff"} · {dateTime(item.created_at)}</p></div><button type="button" disabled={!item.integrity_valid} onClick={() => setSimulation(item.result)}>Open simulation</button></article>)}</div></section> : null}
        </>
      ) : null}

      {!caseLoading && tab === "amendments" ? (
        <>
          {!caseData ? <div className="finance-ops__empty">Choose a Finance case first.</div> : null}
          {caseData && canManage ? (
            <form className="finance-ops__panel finance-ops__form" onSubmit={submitAmendment}>
              <div className="finance-ops__section-heading"><div><p>Never erase the original</p><h2>Controlled correction or amendment</h2><span>Contact corrections may update after approval. Money, schedules and payments become numbered variations only.</span></div></div>
              <div className="finance-ops__form-grid">
                <label><span>Amendment type</span><select value={amendmentForm.amendment_type} onChange={(event) => setAmendmentForm((current) => ({ ...current, amendment_type: event.target.value }))}><option value="case_correction">Case correction</option><option value="customer_details">Customer details</option><option value="guarantor_details">Guarantor details</option><option value="commercial_variation">Commercial variation</option><option value="schedule_variation">Schedule variation</option><option value="payment_correction_request">Payment correction request</option></select></label>
                <label><span>Effective date</span><input type="date" value={amendmentForm.effective_date} onChange={(event) => setAmendmentForm((current) => ({ ...current, effective_date: event.target.value }))} /></label>
                <label className="is-wide"><span>Reason and evidence</span><textarea required minLength="8" value={amendmentForm.reason} onChange={(event) => setAmendmentForm((current) => ({ ...current, reason: event.target.value }))} /></label>
              </div>
              <div className="finance-ops__amendment-fields">{amendmentForm.fields.map((field, index) => <div key={`${index}:${field.key}`}><label><span>Field</span><input required value={field.key} onChange={(event) => updateAmendmentField(index, "key", event.target.value)} placeholder="customer_phone or payment_frequency" /></label><label><span>Proposed value</span><input required value={field.value} onChange={(event) => updateAmendmentField(index, "value", event.target.value)} /></label></div>)}</div>
              <div className="finance-ops__form-actions"><button type="button" onClick={addAmendmentField}>+ Add field</button><button type="submit" disabled={busy === "amendment:create"}>Submit for approval</button></div>
            </form>
          ) : null}
          {caseData ? (
            <section className="finance-ops__panel">
              <div className="finance-ops__section-heading"><div><p>Numbered evidence</p><h2>Amendment register</h2></div><strong>{caseData.amendments?.length || 0}</strong></div>
              <div className="finance-ops__amendment-list">{caseData.amendments?.map((amendment) => <article key={amendment.id}><div><span>{amendment.amendment_number} · {label(amendment.risk_level)}</span><h3>{label(amendment.amendment_type)}</h3><p>{amendment.reason}</p><small>{amendment.integrity_valid ? "Checksum verified" : "Checksum mismatch"} · Requested {dateTime(amendment.requested_at)}</small></div><span className={`finance-ops__status is-${amendment.amendment_status}`}>{label(amendment.amendment_status)}</span><details><summary>Before and proposed values</summary><pre>{JSON.stringify({ before: amendment.before_snapshot, proposed: amendment.proposed_changes, applied: amendment.applied_result }, null, 2)}</pre></details>{canManage ? <div className="finance-ops__card-actions">{amendment.amendment_status === "pending_approval" ? <><button type="button" onClick={() => decideAmendment(amendment, "approved")}>Approve</button><button type="button" onClick={() => decideAmendment(amendment, "rejected")}>Reject</button></> : null}{amendment.amendment_status === "approved" ? <button type="button" onClick={() => applyApprovedAmendment(amendment)}>Apply approved amendment</button> : null}</div> : null}</article>)}</div>
            </section>
          ) : null}
        </>
      ) : null}

      {!caseLoading && tab === "receipts" ? (
        <>
          {!caseData?.case?.agreement_id ? <div className="finance-ops__empty">Choose an active agreement with recorded payments.</div> : null}
          {caseData?.case?.agreement_id ? (
            <section className="finance-ops__panel">
              <div className="finance-ops__section-heading"><div><p>Collections evidence</p><h2>Payment receipt, boss alert and sharing</h2></div></div>
              <div className="finance-ops__receipt-controls">
                <label><span>Payment</span><select value={selectedPaymentId} onChange={(event) => { setSelectedPaymentId(event.target.value); setReceipt(null); }}><option value="">Choose payment</option>{caseData.payments?.map((payment) => <option key={payment.id} value={payment.id}>{payment.receipt_number} — {money(payment.amount)} — {dateOnly(payment.payment_date)}</option>)}</select></label>
                <button type="button" disabled={!selectedPaymentId || busy === `receipt:${selectedPaymentId}`} onClick={() => loadReceipt()}>Open receipt</button>
              </div>
              {receipt?.thermal_receipt ? (
                <>
                  <article className="finance-thermal-receipt">
                    <header><strong>{receipt.thermal_receipt.company_name}</strong><span>{receipt.thermal_receipt.title}</span></header>
                    <dl><div><dt>Receipt</dt><dd>{receipt.thermal_receipt.receipt_number}</dd></div><div><dt>Date</dt><dd>{dateTime(receipt.thermal_receipt.payment_date)}</dd></div><div><dt>Customer</dt><dd>{receipt.thermal_receipt.customer_name}</dd></div><div><dt>Agreement</dt><dd>{receipt.thermal_receipt.agreement_number}</dd></div><div><dt>Excavator</dt><dd>{receipt.thermal_receipt.equipment}</dd></div><div className="is-total"><dt>Amount received</dt><dd>{money(receipt.thermal_receipt.amount_received)}</dd></div><div><dt>Method</dt><dd>{label(receipt.thermal_receipt.payment_method)}</dd></div><div><dt>Outstanding</dt><dd>{money(receipt.thermal_receipt.outstanding_balance)}</dd></div><div><dt>Received by</dt><dd>{receipt.thermal_receipt.received_by}</dd></div></dl>
                    <section><strong>Allocation</strong>{receipt.thermal_receipt.allocations?.map((allocation) => <p key={allocation.sequence_number}>Installment {allocation.sequence_number} · {dateOnly(allocation.due_date)} · {money(allocation.allocated_amount)} · {label(allocation.schedule_status)}</p>)}</section>
                    <footer>Integrity {receipt.receipt_checksum}</footer>
                  </article>
                  <div className="finance-ops__boss-status"><span>Boss payment alert</span><strong className={`finance-ops__status is-${receipt.boss_alert?.status}`}>{label(receipt.boss_alert?.status)}</strong><small>{receipt.boss_alert?.attempt_count || 0} attempt(s){receipt.boss_alert?.error ? ` · ${receipt.boss_alert.error}` : ""}</small></div>
                  <div className="finance-ops__receipt-actions"><button type="button" onClick={() => window.print()}>Print thermal receipt</button>{canManage && !receipt.issued_document ? <button type="button" onClick={issueReceipt}>Issue immutable receipt</button> : null}{canManage && ["failed", "pending", "not_recorded"].includes(receipt.boss_alert?.status) ? <button type="button" onClick={retryBossAlert}>Retry boss alert</button> : null}</div>
                  {canManage ? <div className="finance-ops__share-form"><label><span>Channel</span><select value={shareChannel} onChange={(event) => setShareChannel(event.target.value)}><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="copy">Copy message</option><option value="print">Print</option></select></label><label><span>Recipient</span><input value={shareRecipient} onChange={(event) => setShareRecipient(event.target.value)} placeholder="Phone or email" /></label><button type="button" onClick={shareReceipt}>Share receipt</button></div> : null}
                  {receipt.shares?.length ? <div className="finance-ops__share-history"><h3>Sharing history</h3>{receipt.shares.map((share) => <p key={share.id}><strong>{label(share.channel)}</strong> · {label(share.share_status)} · {share.recipient || "No recipient"} · {dateTime(share.requested_at)}</p>)}</div> : null}
                </>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
