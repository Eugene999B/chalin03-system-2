import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";
import "../styles/equipmentFinanceApplicationsModern.css";

const API = "/equipment-catalogue/sales/credit-applications";
const EDITABLE_STATUSES = new Set(["draft", "changes_requested"]);
const REVIEW_ROLES = new Set([
  "admin",
  "administrator",
  "manager",
  "system_admin",
  "system_administrator",
  "super_admin",
  "finance_manager",
  "equipment_business_manager",
]);
const PAGE_SIZE = 25;

function positiveApplicationId(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const applicationId = Number(normalized);
  return Number.isSafeInteger(applicationId) ? applicationId : null;
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "Not available")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateValue(value) {
  return value ? String(value).slice(0, 10) : "";
}

function errorMessage(error, fallback) {
  if (error?.code === "ERR_CANCELED") return "";
  return (
    error?.response?.data?.operator_message ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

function responseRequestId(error) {
  return (
    error?.response?.data?.request_id ||
    error?.response?.headers?.["x-request-id"] ||
    null
  );
}

function readinessProblems(readiness = {}) {
  return [
    ...(readiness.missing_tables || []).map((table) => `Missing table: ${table}`),
    ...(readiness.missing_columns || []).map(
      (item) => `Missing column: ${item.table}.${item.column}`
    ),
    ...(readiness.invalid_nullability || []).map(
      (item) =>
        `Location field must allow company-wide records: ${item.table}.${item.column}`
    ),
    ...(readiness.invalid_enums || []).map(
      (item) =>
        `Workflow values missing from ${item.table}.${item.column}: ${(
          item.missing_values || []
        ).join(", ")}`
    ),
    ...(readiness.capabilities?.window_functions_supported === false
      ? ["The production database rejected the current window-function query."]
      : []),
    ...(readiness.capabilities?.register_query_compiles === false
      ? ["The production database could not compile the application-register query."]
      : []),
  ];
}

function Pill({ value }) {
  const dangerous = ["declined", "rejected", "ineligible", "critical", "overdue", "withdrawn"].includes(value);
  const warning = ["submitted", "under_review", "manual_review", "high", "changes_requested", "incomplete"].includes(value);
  return (
    <span className={`finance-simple__pill ${dangerous ? "is-danger" : warning ? "is-warning" : "is-good"}`}>
      {label(value)}
    </span>
  );
}

function editPayload(detail) {
  const application = detail?.application || {};
  const kyc = detail?.kyc || {};
  return {
    offer: {
      selling_price: String(application.quoted_total ?? ""),
      deposit: String(application.proposed_deposit ?? ""),
      payment_frequency: application.proposed_frequency || "monthly",
      custom_interval_days: String(
        application.proposed_interval_days || application.quotation_interval_days || 30
      ),
      installment_count: String(application.proposed_installment_count || 12),
      first_due_date: dateValue(application.proposed_first_due_date),
      non_working_day_rule: application.proposed_non_working_day_rule || "exact",
      terms: application.quotation_terms || "",
      notes: application.quotation_notes || "",
    },
    kyc: {
      id_type: kyc.id_type || "",
      id_number: kyc.id_number || "",
      date_of_birth: dateValue(kyc.date_of_birth),
      nationality: kyc.nationality || "",
      employment_type: kyc.employment_type || "",
      occupation: kyc.occupation || "",
      residential_address: kyc.residential_address || "",
      work_address: kyc.work_address || "",
      guarantor_name: kyc.guarantor_name || "",
      guarantor_phone: kyc.guarantor_phone || "",
      guarantor_id_number: kyc.guarantor_id_number || "",
      customer_consent_confirmed: Boolean(kyc.customer_consent_confirmed),
      credit_assessment_consent_confirmed: Boolean(
        kyc.credit_assessment_consent_confirmed
      ),
      verification_notes: kyc.verification_notes || "",
    },
    affordability: {
      monthly_salary_income: String(application.monthly_salary_income ?? ""),
      monthly_business_income: String(application.monthly_business_income ?? ""),
      monthly_other_income: String(application.monthly_other_income ?? ""),
      monthly_business_costs: String(application.monthly_business_costs ?? ""),
      monthly_household_expenses: String(application.monthly_household_expenses ?? ""),
      existing_monthly_debt: String(application.existing_monthly_debt ?? ""),
    },
  };
}

function Field({ title, children, wide = false }) {
  return (
    <label className={`finance-simple__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
    </label>
  );
}

function LazyApplicationImage({ application }) {
  const [source, setSource] = useState("");
  const [visible, setVisible] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!application?.has_image) return undefined;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" }
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [application?.has_image, application?.id]);

  useEffect(() => {
    if (!application?.has_image || !visible) return undefined;
    const controller = new AbortController();
    let objectUrl = "";
    axiosClient
      .get(`${API}/${application.id}/image`, {
        responseType: "blob",
        signal: controller.signal,
      })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        setSource(objectUrl);
      })
      .catch((error) => {
        if (error?.code !== "ERR_CANCELED") setSource("");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [application?.has_image, application?.id, visible]);

  return application?.has_image ? (
    <div ref={containerRef} className="finance-simple__machine-image finance-applications-v2__thumb-frame">
      {source ? (
        <img
          src={source}
          alt={application.asset_name || "Excavator"}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span aria-hidden="true">🚜</span>
      )}
    </div>
  ) : (
    <div className="finance-applications-v2__thumb-frame finance-applications-v2__thumb-frame--empty" aria-label="No excavator photograph">
      <span aria-hidden="true">🚜</span>
      <small>No photo</small>
    </div>
  );
}

export default function EquipmentFinanceApplicationsPage() {
  const { effectivePermissions = [], user } = useAuth();
  const location = useLocation();
  const assignedRoles = [
    user?.workspace_role,
    user?.access_role,
    user?.role,
  ]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);
  const canManage =
    effectivePermissions.includes("fleet.assets.manage") ||
    assignedRoles.some((role) =>
      ["admin", "administrator", "system_admin", "system_administrator", "super_admin"].includes(role)
    );
  const canReview = assignedRoles.some((role) => REVIEW_ROLES.has(role));

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedApplicationId = positiveApplicationId(query.get("application"));

  const [applications, setApplications] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: PAGE_SIZE,
    total: 0,
    total_pages: 1,
  });
  const [summary, setSummary] = useState({});
  const [readiness, setReadiness] = useState({ ready: null, missing_tables: [] });
  const [listFailure, setListFailure] = useState(null);
  const [hasLoadedList, setHasLoadedList] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autosaveState, setAutosaveState] = useState("idle");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState(null);
  const [decision, setDecision] = useState(null);
  const [edit, setEdit] = useState(null);
  const listAbortRef = useRef(null);
  const detailAbortRef = useRef(null);
  const editRef = useRef(null);

  const loadList = useCallback(async () => {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setLoading(true);
    setProblem("");
    setListFailure(null);

    void axiosClient
      .get(`${API}/readiness`, { signal: controller.signal })
      .then((readinessResponse) => {
        if (controller.signal.aborted) return;
        const nextReadiness = readinessResponse.data?.readiness || {
          ready: readinessResponse.data?.status === "success",
        };
        setReadiness(nextReadiness);
      })
      .catch((error) => {
        if (error?.code === "ERR_CANCELED" || controller.signal.aborted) return;
        const payload = error?.response?.data || {};
        setReadiness(
          payload.readiness || {
            ready: false,
            degraded: true,
            code: payload.code || "FINANCE_READINESS_TIMEOUT",
            operator_message:
              payload.operator_message ||
              "The production Finance schema check did not finish before its deadline.",
            request_id: responseRequestId(error),
            missing_tables: [],
            missing_columns: [],
            invalid_nullability: [],
            invalid_enums: [],
          }
        );
      });

    try {
      const params = {
        page,
        page_size: PAGE_SIZE,
        status,
        search: search.trim() || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      };
      const response = await axiosClient.get(API, {
        params,
        signal: controller.signal,
      });
      const payload = response.data || {};
      if (payload.status !== "success") {
        setListFailure({
          code: payload.code || "FINANCE_APPLICATION_REGISTER_DEGRADED",
          message:
            payload.operator_message ||
            payload.message ||
            "The application register returned an unverified response.",
          request_id:
            payload.request_id || response.headers?.["x-request-id"] || null,
          readiness: payload.readiness || null,
        });
        if (payload.readiness) setReadiness(payload.readiness);
        return;
      }
      setApplications(payload.applications || []);
      setPagination(payload.pagination || {});
      setSummary(payload.summary || {});
      setHasLoadedList(true);
    } catch (error) {
      if (error?.code === "ERR_CANCELED") return;
      const payload = error?.response?.data || {};
      if (payload.readiness) setReadiness(payload.readiness);
      setListFailure({
        code: payload.code || "FINANCE_APPLICATION_REGISTER_FAILED",
        message: errorMessage(
          error,
          "Could not load the Finance application register."
        ),
        request_id: responseRequestId(error),
        readiness: payload.readiness || null,
      });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [dateFrom, dateTo, page, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(loadList, search ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadList, search]);

  const openDetail = useCallback(async (
    applicationOrId,
    { editAfterOpen = false } = {}
  ) => {
    const applicationId = positiveApplicationId(
      typeof applicationOrId === "object" ? applicationOrId?.id : applicationOrId
    );
    if (!applicationId) {
      setProblem("The selected Finance application reference is invalid.");
      return;
    }
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setDetailLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/${applicationId}`, {
        signal: controller.signal,
      });
      const nextDetail = response.data || null;
      setDetail(nextDetail);
      if (editAfterOpen && nextDetail?.editable) {
        const nextEdit = {
          application_id: nextDetail.application.id,
          known_version: Number(nextDetail.application.decision_version || 0),
          payload: editPayload(nextDetail),
          dirty: false,
        };
        editRef.current = nextEdit;
        setEdit(nextEdit);
        setAutosaveState("ready");
      }
    } catch (error) {
      if (error?.code !== "ERR_CANCELED") {
        setProblem(errorMessage(error, "Could not open the application file."));
      }
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (requestedApplicationId) {
      void openDetail(requestedApplicationId);
    }
  }, [openDetail, requestedApplicationId]);

  function closeDetail() {
    editRef.current = null;
    setDetail(null);
    setEdit(null);
  }

  function requestDecision(application, kind) {
    const titles = {
      assess: "Recalculate affordability",
      submit: "Submit for manager review",
      start_review: "Start manager review",
      verify: "Verify optional KYC evidence",
      reject_kyc: "Record a KYC issue",
      request_changes: "Request changes",
      approve: "Approve credit application",
      decline: "Decline credit application",
      withdraw: "Withdraw application",
      cancel: "Cancel draft",
    };
    setDecision({ application, kind, title: titles[kind], reason: "" });
  }

  async function confirmDecision(event) {
    event.preventDefault();
    if (!decision) return;
    const reasonRequired = [
      "reject_kyc",
      "request_changes",
      "decline",
      "withdraw",
      "cancel",
    ].includes(decision.kind);
    if (reasonRequired && !decision.reason.trim()) {
      setProblem("Enter the exact reason before completing this action.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      const { application, kind, reason } = decision;
      let response;
      if (kind === "assess") {
        response = await axiosClient.post(`${API}/${application.id}/assess`, {});
      } else if (kind === "submit") {
        response = await axiosClient.post(`${API}/${application.id}/submit`, {
          notes: reason,
          known_version: Number(application.decision_version || 0),
        });
      } else if (["verify", "reject_kyc"].includes(kind)) {
        response = await axiosClient.post(`${API}/${application.id}/kyc/verify`, {
          verification_status: kind === "verify" ? "verified" : "rejected",
          reason,
          known_version: Number(application.decision_version || 0),
        });
      } else if (["withdraw", "cancel"].includes(kind)) {
        response = await axiosClient.post(`${API}/${application.id}/${kind}`, {
          reason,
        });
      } else {
        response = await axiosClient.post(`${API}/${application.id}/review`, {
          action: kind,
          reason,
          known_version: Number(application.decision_version || 0),
        });
      }
      setDecision(null);
      setEdit(null);
      const nextActionLabel = response.data?.next_action?.label;
      setNotice(
        `${response.data?.message || "Application action completed."}${
          nextActionLabel ? ` Next action: ${nextActionLabel}` : ""
        }`
      );
      await loadList();
      if (!["withdraw", "cancel"].includes(kind)) await openDetail(application.id);
      else closeDetail();
    } catch (error) {
      setProblem(errorMessage(error, "Could not complete the application action."));
    } finally {
      setSaving(false);
    }
  }

  function beginEdit() {
    if (!detail?.application) return;
    const next = {
      application_id: detail.application.id,
      known_version: Number(detail.application.decision_version || 0),
      payload: editPayload(detail),
      dirty: false,
    };
    editRef.current = next;
    setEdit(next);
    setAutosaveState("ready");
  }

  function updateEdit(section, field, value) {
    setEdit((current) => {
      const next = {
        ...current,
        payload: {
          ...current.payload,
          [section]: { ...current.payload[section], [field]: value },
        },
        dirty: true,
      };
      editRef.current = next;
      return next;
    });
    setAutosaveState("pending");
  }

  const saveEdit = useCallback(async ({ manual = false } = {}) => {
    const current = editRef.current;
    if (!current?.dirty || saving) return;
    setSaving(true);
    setAutosaveState("saving");
    setProblem("");
    try {
      const response = await axiosClient.put(
        `${API}/${current.application_id}`,
        {
          ...current.payload,
          known_version: current.known_version,
          notes: manual ? "Draft saved explicitly by staff." : "Draft autosaved after editing.",
        }
      );
      const nextVersion = Number(
        response.data?.application?.decision_version ?? current.known_version + 1
      );
      const latest = editRef.current;
      const stillEditing =
        latest?.application_id === current.application_id;
      if (stillEditing) {
        const changedDuringSave = latest !== current;
        const next = {
          ...(changedDuringSave ? latest : current),
          known_version: nextVersion,
          dirty: changedDuringSave,
        };
        editRef.current = next;
        setEdit(next);
        setDetail(response.data || null);
        setAutosaveState(changedDuringSave ? "pending" : "saved");
        if (manual && !changedDuringSave) {
          setNotice(response.data?.message || "Draft saved.");
        }
      }
      await loadList();
    } catch (error) {
      if (error?.response?.data?.code === "FINANCE_APPLICATION_VERSION_CONFLICT") {
        setAutosaveState("conflict");
      } else {
        setAutosaveState("failed");
      }
      setProblem(errorMessage(error, "Could not save the Finance draft."));
    } finally {
      setSaving(false);
    }
  }, [loadList, saving]);

  useEffect(() => {
    if (!edit?.dirty) return undefined;
    const timer = window.setTimeout(() => saveEdit({ manual: false }), 900);
    return () => window.clearTimeout(timer);
  }, [edit, saveEdit]);

  const metrics = {
    drafts: Number(summary.drafts || 0),
    review: Number(summary.awaiting_review || 0),
    approved: Number(summary.approved || 0),
    exposure: Number(summary.proposed_exposure || 0),
  };
  const schemaProblems = readinessProblems(readiness);

  return (
    <main className="finance-simple finance-applications-v2">
      <header className="finance-simple__hero finance-applications-v2__hero">
        <div>
          <p>Applications &amp; approvals</p>
          <h1>Credit Applications</h1>
          <span>One compact register for finding, reviewing and approving equipment installment cases.</span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=guide">Approval guide</Link>
          {canManage ? <Link className="finance-simple__button is-primary" to="/equipment-installment-finance/applications?stage=start">+ New installment</Link> : null}
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}

      {listFailure ? (
        <section className="finance-simple__notice is-error" role="alert">
          <h2>Application register could not be verified</h2>
          <p>{listFailure.message}</p>
          <p><strong>Diagnostic code:</strong> {listFailure.code}</p>
          {listFailure.request_id ? <p><strong>Request ID:</strong> {listFailure.request_id}</p> : null}
          {hasLoadedList ? <p>The last verified register remains visible below.</p> : <p>No zero totals are being shown because the register has not completed successfully.</p>}
          <button type="button" onClick={loadList} disabled={loading}>{loading ? "Retrying…" : "Retry application check"}</button>
        </section>
      ) : null}

      {readiness.ready === false ? (
        <section className="finance-simple__section">
          <h2>Credit application foundation is not ready</h2>
          <p>{readiness.operator_message || "The production application, quotation or approval schema needs attention."}</p>
          {schemaProblems.length ? <ul>{schemaProblems.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          {readiness.database?.version ? <p><strong>Database version:</strong> {readiness.database.version}</p> : null}
          {readiness.migration ? <p><strong>Phase 1 migration record:</strong> {readiness.migration.recorded ? "present" : "not recorded"}</p> : null}
          {readiness.request_id ? <p><strong>Schema-check request ID:</strong> {readiness.request_id}</p> : null}
          <button type="button" onClick={loadList} disabled={loading}>{loading ? "Checking…" : "Retry schema check"}</button>
        </section>
      ) : null}

      {hasLoadedList ? (
        <section className="finance-simple__metrics finance-applications-v2__metrics">
          <article className="finance-simple__metric"><span>Drafts / changes</span><strong>{metrics.drafts}</strong></article>
          <article className="finance-simple__metric"><span>Awaiting review</span><strong>{metrics.review}</strong></article>
          <article className="finance-simple__metric"><span>Approved</span><strong>{metrics.approved}</strong></article>
          <article className="finance-simple__metric"><span>Proposed exposure</span><strong>{money(metrics.exposure)}</strong></article>
        </section>
      ) : null}

      <section className="finance-simple__section finance-applications-v2__register">
        <div className="finance-simple__toolbar finance-applications-v2__toolbar">
          <div>
            <p className="finance-simple__eyebrow">Application register</p>
            <h2>{hasLoadedList ? `${pagination.total || 0} cases` : "Register not yet verified"}</h2>
            <span className="finance-simple__muted">Open a case to see detailed information and decision controls.</span>
          </div>
          <div className="finance-simple__actions finance-applications-v2__filters">
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search customer, application or excavator" />
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="all">All statuses</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="changes_requested">Changes requested</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="withdrawn">Withdrawn / cancelled</option>
            </select>
            <input type="date" aria-label="From date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} />
            <input type="date" aria-label="To date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} />
            <button type="button" onClick={loadList} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          </div>
        </div>

        {loading ? <div className="finance-simple__empty">Loading credit applications…</div> : null}
        {!loading && hasLoadedList && !listFailure && !applications.length ? <div className="finance-simple__empty"><h3>No matching applications</h3><p>Use New Installment to create a recoverable company-wide draft.</p></div> : null}

        <div className="finance-applications-v2__list">
          {applications.map((application) => (
            <article className="finance-applications-v2__case" key={application.id}>
              <LazyApplicationImage application={application} />
              <div className="finance-applications-v2__case-main">
                <div className="finance-applications-v2__case-heading">
                  <div>
                    <span className="finance-applications-v2__case-number">{application.application_number}</span>
                    <h3>{application.customer_name}</h3>
                    <p>{application.asset_code} · {application.asset_name}</p>
                  </div>
                  <Pill value={application.application_status} />
                </div>
                <div className="finance-applications-v2__case-facts">
                  <div><span>Offer</span><strong>{application.quotation_number || "Automatic offer"}</strong></div>
                  <div><span>Financed</span><strong>{money(application.financed_amount)}</strong></div>
                  <div><span>Deposit</span><strong>{money(application.proposed_deposit)}</strong></div>
                  <div><span>KYC</span><strong><Pill value={application.kyc_status} /></strong></div>
                  <div><span>Affordability</span><strong><Pill value={application.affordability_status} /></strong></div>
                  <div><span>Risk</span><strong><Pill value={application.risk_band} /></strong></div>
                </div>
                <div className="finance-applications-v2__case-actions">
                  <button type="button" onClick={() => openDetail(application)}>Open case</button>
                  {canManage && EDITABLE_STATUSES.has(application.application_status) ? <button className="is-primary" type="button" onClick={() => openDetail(application, { editAfterOpen: true })}>{application.application_status === "draft" ? "Resume draft" : "Edit draft"}</button> : null}
                  {canManage && EDITABLE_STATUSES.has(application.application_status) ? <button type="button" onClick={() => requestDecision(application, "submit")}>Submit</button> : null}
                  {canReview && application.application_status === "submitted" ? <button className="is-primary" type="button" onClick={() => requestDecision(application, "start_review")}>Start review</button> : null}
                </div>
              </div>
            </article>
          ))}
        </div>

        {hasLoadedList ? (
          <div className="finance-simple__sticky-actions finance-applications-v2__pagination">
            <span>Page {pagination.page || page} of {pagination.total_pages || 1}</span>
            <div><button type="button" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" disabled={loading || page >= Number(pagination.total_pages || 1)} onClick={() => setPage((value) => value + 1)}>Next</button></div>
          </div>
        ) : null}
      </section>

      {detailLoading ? <div className="finance-applications-v2__loading" role="status">Opening application…</div> : null}

      {detail ? (
        <div className="finance-simple__dialog-backdrop finance-applications-v2__dialog-backdrop" role="presentation" onMouseDown={closeDetail}>
          <section className="finance-simple__dialog finance-applications-v2__dialog" role="dialog" aria-modal="true" aria-label="Credit application file" onMouseDown={(event) => event.stopPropagation()}>
            <header className="finance-applications-v2__dialog-head">
              <div><span>Application file</span><h2>{detail.application?.application_number}</h2><p>{detail.application?.customer_name} · {detail.application?.asset_code} · {detail.application?.asset_name}</p></div>
              <div className="finance-applications-v2__dialog-head-actions"><Pill value={detail.application?.application_status} /><button type="button" onClick={closeDetail}>Close</button></div>
            </header>

            <div className="finance-applications-v2__detail-top">
              <div className="finance-applications-v2__detail-photo"><LazyApplicationImage application={detail.application} /></div>
              <div className="finance-applications-v2__detail-overview">
                <div className="finance-applications-v2__info-card"><span>Customer</span><strong>{detail.application?.customer_name}</strong><small>{detail.application?.customer_phone || "No phone recorded"}</small></div>
                <div className="finance-applications-v2__info-card"><span>Excavator</span><strong>{detail.application?.asset_code}</strong><small>{detail.application?.asset_name}</small></div>
                <div className="finance-applications-v2__info-card"><span>Financed amount</span><strong>{money(detail.application?.financed_amount)}</strong><small>Deposit {money(detail.application?.proposed_deposit)}</small></div>
                <div className="finance-applications-v2__info-card"><span>Credit risk</span><strong>{label(detail.application?.risk_band)}</strong><small>Affordability {label(detail.application?.affordability_status)}</small></div>
              </div>
            </div>

            {!edit ? (
              <>
                <div className="finance-applications-v2__detail-sections">
                  <section className="finance-applications-v2__detail-card"><header><div><span>01</span><h3>Customer &amp; KYC</h3></div>{detail.kyc?.kyc_status ? <Pill value={detail.kyc.kyc_status} /> : null}</header><div className="finance-applications-v2__fact-grid"><div><span>ID</span><strong>{detail.kyc?.id_type || "Not recorded"}: {detail.kyc?.id_number || "Not recorded"}</strong></div><div><span>Employment</span><strong>{label(detail.kyc?.employment_type)} · {detail.kyc?.occupation || "Not recorded"}</strong></div><div><span>Address</span><strong>{detail.kyc?.residential_address || "Not recorded"}</strong></div><div><span>Guarantor</span><strong>{detail.kyc?.guarantor_name || "Not recorded"}</strong></div></div></section>
                  <section className="finance-applications-v2__detail-card"><header><div><span>02</span><h3>Commercial terms</h3></div><Pill value={detail.application?.application_status} /></header><div className="finance-applications-v2__fact-grid"><div><span>Quotation</span><strong>{detail.application?.quotation_number || "Automatic offer"}</strong></div><div><span>Selling price</span><strong>{money(detail.application?.quoted_total)}</strong></div><div><span>Deposit</span><strong>{money(detail.application?.proposed_deposit)}</strong></div><div><span>Financed</span><strong>{money(detail.application?.financed_amount)}</strong></div></div></section>
                  <section className="finance-applications-v2__detail-card"><header><div><span>03</span><h3>Assessment</h3></div></header><div className="finance-applications-v2__fact-grid"><div><span>KYC</span><strong><Pill value={detail.application?.kyc_status} /></strong></div><div><span>Affordability</span><strong><Pill value={detail.application?.affordability_status} /></strong></div><div><span>Income</span><strong>{money(Number(detail.application?.monthly_salary_income || 0) + Number(detail.application?.monthly_business_income || 0) + Number(detail.application?.monthly_other_income || 0))}</strong></div><div><span>Existing debt</span><strong>{money(detail.application?.existing_monthly_debt)}</strong></div></div></section>
                  <section className="finance-applications-v2__detail-card"><header><div><span>04</span><h3>Decision history</h3></div></header><div className="finance-applications-v2__history">{detail.decisions?.length ? detail.decisions.map((item) => <article key={item.id}><div><strong>{label(item.action_type)} → {label(item.to_status)}</strong><small>{item.decided_by_name || "System"}</small></div><p>{item.notes || "No decision note recorded."}</p></article>) : <p>No decisions recorded.</p>}</div></section>
                </div>

                <div className="finance-applications-v2__decision-actions">
                  {canManage && detail.editable ? <button className="is-primary" type="button" onClick={beginEdit}>Resume / edit draft</button> : null}
                  {canManage && detail.editable ? <button type="button" onClick={() => requestDecision(detail.application, "submit")}>Submit for review</button> : null}
                  {canManage && detail.application?.application_status === "draft" ? <button className="is-danger" type="button" onClick={() => requestDecision(detail.application, "cancel")}>Cancel draft</button> : null}
                  {canManage && detail.withdrawable ? <button className="is-danger" type="button" onClick={() => requestDecision(detail.application, "withdraw")}>Withdraw</button> : null}
                  {canReview && detail.application?.application_status === "submitted" ? <button type="button" onClick={() => requestDecision(detail.application, "start_review")}>Start review</button> : null}
                  {canReview && ["submitted", "under_review"].includes(detail.application?.application_status) && detail.application?.kyc_status !== "verified" ? <button type="button" onClick={() => requestDecision(detail.application, "verify")}>Review KYC</button> : null}
                  {canReview && detail.application?.application_status === "under_review" ? <><button type="button" onClick={() => requestDecision(detail.application, "request_changes")}>Request changes</button><button className="is-danger" type="button" onClick={() => requestDecision(detail.application, "decline")}>Decline</button><button className="is-primary" type="button" onClick={() => requestDecision(detail.application, "approve")}>Approve</button></> : null}
                </div>
              </>
            ) : (
              <form onSubmit={(event) => { event.preventDefault(); saveEdit({ manual: true }); }}>
                <div className="finance-simple__notice is-info"><strong>Draft recovery</strong> · {detail.application?.application_number} · changes autosave after 900 ms · status {label(autosaveState)}.</div>
                <div className="finance-applications-v2__edit-grid">
                  <Field title="Selling price"><input inputMode="decimal" value={edit.payload.offer.selling_price} onChange={(event) => updateEdit("offer", "selling_price", event.target.value)} /></Field>
                  <Field title="Deposit"><input inputMode="decimal" value={edit.payload.offer.deposit} onChange={(event) => updateEdit("offer", "deposit", event.target.value)} /></Field>
                  <Field title="Frequency"><select value={edit.payload.offer.payment_frequency} onChange={(event) => updateEdit("offer", "payment_frequency", event.target.value)}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="custom">Custom days</option></select></Field>
                  <Field title="Interval days"><input type="number" min="1" max="365" value={edit.payload.offer.custom_interval_days} onChange={(event) => updateEdit("offer", "custom_interval_days", event.target.value)} /></Field>
                  <Field title="Installment count"><input type="number" min="1" max="520" value={edit.payload.offer.installment_count} onChange={(event) => updateEdit("offer", "installment_count", event.target.value)} /></Field>
                  <Field title="First due date"><input type="date" value={edit.payload.offer.first_due_date} onChange={(event) => updateEdit("offer", "first_due_date", event.target.value)} /></Field>
                  <Field title="ID type"><input value={edit.payload.kyc.id_type} onChange={(event) => updateEdit("kyc", "id_type", event.target.value)} /></Field>
                  <Field title="ID number"><input value={edit.payload.kyc.id_number} onChange={(event) => updateEdit("kyc", "id_number", event.target.value)} /></Field>
                  <Field title="Employment / business type"><input value={edit.payload.kyc.employment_type} onChange={(event) => updateEdit("kyc", "employment_type", event.target.value)} /></Field>
                  <Field title="Occupation"><input value={edit.payload.kyc.occupation} onChange={(event) => updateEdit("kyc", "occupation", event.target.value)} /></Field>
                  <Field title="Residential address" wide><textarea value={edit.payload.kyc.residential_address} onChange={(event) => updateEdit("kyc", "residential_address", event.target.value)} /></Field>
                  <Field title="Guarantor name"><input value={edit.payload.kyc.guarantor_name} onChange={(event) => updateEdit("kyc", "guarantor_name", event.target.value)} /></Field>
                  <Field title="Guarantor phone"><input value={edit.payload.kyc.guarantor_phone} onChange={(event) => updateEdit("kyc", "guarantor_phone", event.target.value)} /></Field>
                  <Field title="Monthly salary income"><input inputMode="decimal" value={edit.payload.affordability.monthly_salary_income} onChange={(event) => updateEdit("affordability", "monthly_salary_income", event.target.value)} /></Field>
                  <Field title="Monthly business income"><input inputMode="decimal" value={edit.payload.affordability.monthly_business_income} onChange={(event) => updateEdit("affordability", "monthly_business_income", event.target.value)} /></Field>
                  <Field title="Monthly other income"><input inputMode="decimal" value={edit.payload.affordability.monthly_other_income} onChange={(event) => updateEdit("affordability", "monthly_other_income", event.target.value)} /></Field>
                  <Field title="Monthly business costs"><input inputMode="decimal" value={edit.payload.affordability.monthly_business_costs} onChange={(event) => updateEdit("affordability", "monthly_business_costs", event.target.value)} /></Field>
                  <Field title="Monthly household expenses"><input inputMode="decimal" value={edit.payload.affordability.monthly_household_expenses} onChange={(event) => updateEdit("affordability", "monthly_household_expenses", event.target.value)} /></Field>
                  <Field title="Existing monthly debt"><input inputMode="decimal" value={edit.payload.affordability.existing_monthly_debt} onChange={(event) => updateEdit("affordability", "existing_monthly_debt", event.target.value)} /></Field>
                </div>
                <div className="finance-simple__sticky-actions"><span>Optional fields can remain blank. The original application is preserved.</span><div><button type="button" onClick={() => setEdit(null)}>Cancel edit</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div></div>
              </form>
            )}
          </section>
        </div>
      ) : null}

      {decision ? (
        <div className="finance-simple__dialog-backdrop finance-applications-v2__decision-backdrop" role="presentation" onMouseDown={() => !saving && setDecision(null)}>
          <form className="finance-simple__dialog finance-applications-v2__decision-dialog" onSubmit={confirmDecision} onMouseDown={(event) => event.stopPropagation()}>
            <span className="finance-applications-v2__dialog-eyebrow">Application decision</span>
            <h2>{decision.title}</h2>
            <p>{decision.application?.application_number} · {decision.application?.customer_name}</p>
            {decision.kind !== "verify" && decision.kind !== "assess" ? <Field title="Reason / note" hint={["reject_kyc", "request_changes", "decline", "withdraw", "cancel"].includes(decision.kind) ? "Required" : "Optional"}><textarea value={decision.reason} onChange={(event) => setDecision((current) => ({ ...current, reason: event.target.value }))} autoFocus /></Field> : null}
            <div className="finance-applications-v2__decision-footer"><button type="button" onClick={() => setDecision(null)} disabled={saving}>Cancel</button><button className={decision.kind === "approve" ? "is-primary" : decision.kind === "decline" || decision.kind === "cancel" || decision.kind === "withdraw" ? "is-danger" : "is-primary"} type="submit" disabled={saving}>{saving ? "Working…" : "Confirm action"}</button></div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
