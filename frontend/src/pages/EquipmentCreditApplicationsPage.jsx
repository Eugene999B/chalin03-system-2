import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentCreditApplications.css";

const API = "/equipment-catalogue/sales/credit-applications";
const SALES_API = "/equipment-catalogue/sales";

const REVIEWER_ROLES = new Set([
  "admin",
  "administrator",
  "manager",
  "system_administrator",
  "super_admin",
]);

const STATUS_FILTERS = [
  ["all", "All applications"],
  ["draft", "Draft"],
  ["submitted", "Submitted"],
  ["under_review", "Under review"],
  ["changes_requested", "Changes requested"],
  ["approved", "Approved"],
  ["declined", "Declined"],
];

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const money = (value) =>
  `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const label = (value) =>
  String(value || "Not available")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const errorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const booleanValue = (value) =>
  [true, 1, "1", "true", "yes"].includes(value);

function initialForm() {
  return {
    quotation_id: "",
    application: {
      application_date: today(),
      proposed_deposit: "",
      proposed_frequency: "monthly",
      proposed_installment_count: "12",
      monthly_salary_income: "0",
      monthly_business_income: "0",
      monthly_other_income: "0",
      monthly_business_costs: "0",
      monthly_household_expenses: "0",
      existing_monthly_debt: "0",
      assessment_notes: "",
      customer_consent_confirmed: false,
    },
    kyc: {
      customer_name_snapshot: "",
      customer_phone_snapshot: "",
      customer_email_snapshot: "",
      customer_address_snapshot: "",
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
      identity_document_url: "",
      address_evidence_url: "",
      income_evidence_url: "",
      bank_statement_url: "",
      business_registration_url: "",
      guarantor_document_url: "",
      customer_consent_confirmed: false,
      credit_assessment_consent_confirmed: false,
      identity_verified: false,
      address_verified: false,
      income_verified: false,
      guarantor_verified: false,
      verification_notes: "",
    },
  };
}

function StatusPill({ value, className = "" }) {
  return (
    <span className={`credit-app__status is-${String(value || "unknown")} ${className}`}>
      {label(value)}
    </span>
  );
}

function Field({ title, hint, wide = false, children }) {
  return (
    <label className={`credit-app__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Check({ checked, onChange, title, description }) {
  return (
    <label className="credit-app__check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

function Drawer({ title, subtitle, close, children, size = "large" }) {
  return (
    <div className="credit-app__backdrop" role="presentation" onMouseDown={close}>
      <section
        className={`credit-app__drawer is-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="credit-app__drawer-header">
          <div>
            <p>Equipment Installment Finance</p>
            <h2>{title}</h2>
            <span>{subtitle}</span>
          </div>
          <button type="button" onClick={close} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className="credit-app__drawer-body">{children}</div>
      </section>
    </div>
  );
}

function Metric({ title, value, note, icon }) {
  return (
    <article className="credit-app__metric">
      <span aria-hidden="true">{icon}</span>
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        <p>{note}</p>
      </div>
    </article>
  );
}

function DetailRow({ title, value }) {
  return (
    <div className="credit-app__detail-row">
      <span>{title}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

export default function EquipmentCreditApplicationsPage() {
  const { effectivePermissions = [], user } = useAuth();
  const { selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const role = String(user?.role || "").toLowerCase();
  const canManage =
    effectivePermissions.includes("fleet.assets.manage") || REVIEWER_ROLES.has(role);
  const canReview = canManage && REVIEWER_ROLES.has(role);

  const [readiness, setReadiness] = useState({ ready: null, missing_tables: [] });
  const [applications, setApplications] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drawer, setDrawer] = useState("");
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [actionDialog, setActionDialog] = useState(null);

  const locationName =
    selectedContext?.name ||
    (automaticAccess && !selectedContextId
      ? "All authorised equipment locations"
      : "Choose an equipment location");

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");

    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const nextReadiness = readinessResponse.data?.readiness || { ready: true };
      setReadiness(nextReadiness);
      if (!nextReadiness.ready) {
        setLoading(false);
        return;
      }
    } catch (error) {
      const responseReadiness = error?.response?.data?.readiness;
      if (
        error?.response?.data?.code === "EQUIPMENT_CREDIT_FOUNDATION_REQUIRED" ||
        responseReadiness?.ready === false
      ) {
        setReadiness(responseReadiness || { ready: false, missing_tables: [] });
        setLoading(false);
        return;
      }
      setProblem(errorMessage(error, "Could not check the credit-application foundation."));
      setLoading(false);
      return;
    }

    try {
      const [applicationResponse, quotationResponse] = await Promise.all([
        axiosClient.get(API),
        axiosClient.get(`${SALES_API}/quotations`),
      ]);
      setApplications(applicationResponse.data?.applications || []);
      setQuotations(quotationResponse.data?.quotations || []);
    } catch (error) {
      setProblem(errorMessage(error, "Could not load equipment credit applications."));
    } finally {
      setLoading(false);
    }
  }, [selectedContextId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 5500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const approvedQuotations = useMemo(
    () =>
      quotations.filter(
        (quotation) =>
          ["approved", "accepted"].includes(quotation.status) &&
          quotation.proposed_frequency &&
          Number(quotation.proposed_installment_count || 0) > 0 &&
          !applications.some(
            (application) =>
              Number(application.quotation_id) === Number(quotation.id) &&
              !["declined", "withdrawn"].includes(application.application_status)
          )
      ),
    [applications, quotations]
  );

  const visibleApplications = useMemo(() => {
    const term = search.trim().toLowerCase();
    return applications.filter((application) => {
      if (
        statusFilter !== "all" &&
        application.application_status !== statusFilter
      ) {
        return false;
      }
      if (!term) return true;
      return [
        application.application_number,
        application.customer_name,
        application.customer_phone,
        application.quotation_number,
        application.asset_code,
        application.asset_name,
        application.make,
        application.model,
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [applications, search, statusFilter]);

  const metrics = useMemo(() => {
    const pending = applications.filter((application) =>
      ["submitted", "under_review"].includes(application.application_status)
    ).length;
    const changes = applications.filter(
      (application) => application.application_status === "changes_requested"
    ).length;
    const approved = applications.filter(
      (application) => application.application_status === "approved"
    ).length;
    const proposedExposure = applications
      .filter((application) =>
        ["submitted", "under_review", "approved"].includes(
          application.application_status
        )
      )
      .reduce((total, application) => total + Number(application.financed_amount || 0), 0);

    return { pending, changes, approved, proposedExposure };
  }, [applications]);

  function updateApplication(field, value) {
    setForm((current) => ({
      ...current,
      application: { ...current.application, [field]: value },
    }));
  }

  function updateKyc(field, value) {
    setForm((current) => ({
      ...current,
      kyc: { ...current.kyc, [field]: value },
    }));
  }

  function chooseQuotation(quotationId) {
    const quotation = approvedQuotations.find(
      (item) => String(item.id) === String(quotationId)
    );
    setForm((current) => ({
      ...current,
      quotation_id: quotationId,
      application: {
        ...current.application,
        proposed_deposit: String(quotation?.deposit_required || ""),
        proposed_frequency: quotation?.proposed_frequency || "monthly",
        proposed_installment_count: String(
          quotation?.proposed_installment_count || 12
        ),
      },
      kyc: {
        ...current.kyc,
        customer_name_snapshot:
          quotation?.customer_name || current.kyc.customer_name_snapshot,
        customer_phone_snapshot:
          quotation?.customer_phone || current.kyc.customer_phone_snapshot,
        customer_email_snapshot:
          quotation?.customer_email || current.kyc.customer_email_snapshot,
        customer_address_snapshot:
          quotation?.customer_address || current.kyc.customer_address_snapshot,
        residential_address:
          quotation?.customer_address || current.kyc.residential_address,
      },
    }));
  }

  function openCreate() {
    if (!selectedContextId) {
      setProblem("Choose a specific equipment location before creating a credit application.");
      return;
    }
    setEditingId(null);
    setForm(initialForm());
    setDrawer("form");
  }

  async function fetchDetail(applicationId) {
    const response = await axiosClient.get(`${API}/${applicationId}`);
    return response.data || null;
  }

  async function openDetail(application) {
    setProblem("");
    setDrawer("detail");
    setDetail(null);
    try {
      setDetail(await fetchDetail(application.id));
    } catch (error) {
      setDrawer("");
      setProblem(errorMessage(error, "Could not load the credit application."));
    }
  }

  async function openEdit(application) {
    setProblem("");
    try {
      const response = await fetchDetail(application.id);
      const item = response.application || application;
      const kyc = response.kyc || {};
      setEditingId(application.id);
      setForm({
        quotation_id: String(item.quotation_id || ""),
        application: {
          application_date: String(item.application_date || today()).slice(0, 10),
          proposed_deposit: String(item.proposed_deposit ?? ""),
          proposed_frequency: item.proposed_frequency || "monthly",
          proposed_installment_count: String(item.proposed_installment_count || 12),
          monthly_salary_income: String(item.monthly_salary_income ?? 0),
          monthly_business_income: String(item.monthly_business_income ?? 0),
          monthly_other_income: String(item.monthly_other_income ?? 0),
          monthly_business_costs: String(item.monthly_business_costs ?? 0),
          monthly_household_expenses: String(item.monthly_household_expenses ?? 0),
          existing_monthly_debt: String(item.existing_monthly_debt ?? 0),
          assessment_notes: item.assessment_notes || "",
          customer_consent_confirmed:
            booleanValue(kyc.customer_consent_confirmed) || Boolean(item.customer_consent_at),
        },
        kyc: {
          ...initialForm().kyc,
          ...Object.fromEntries(
            Object.entries(kyc).map(([key, value]) => [
              key,
              typeof value === "number" && key.endsWith("_verified")
                ? booleanValue(value)
                : value ?? "",
            ])
          ),
          date_of_birth: kyc.date_of_birth
            ? String(kyc.date_of_birth).slice(0, 10)
            : "",
          customer_consent_confirmed: booleanValue(
            kyc.customer_consent_confirmed
          ),
          credit_assessment_consent_confirmed: booleanValue(
            kyc.credit_assessment_consent_confirmed
          ),
          identity_verified: booleanValue(kyc.identity_verified),
          address_verified: booleanValue(kyc.address_verified),
          income_verified: booleanValue(kyc.income_verified),
          guarantor_verified: booleanValue(kyc.guarantor_verified),
        },
      });
      setDrawer("form");
    } catch (error) {
      setProblem(errorMessage(error, "Could not prepare the application for editing."));
    }
  }

  async function saveApplication(event) {
    event.preventDefault();
    if (!selectedContextId) {
      setProblem("Choose a specific equipment location before saving a credit application.");
      return;
    }
    if (!editingId && !form.quotation_id) {
      setProblem("Choose an approved installment quotation.");
      return;
    }

    setSaving(true);
    setProblem("");
    try {
      const payload = {
        quotation_id: form.quotation_id,
        application: {
          ...form.application,
          customer_consent_confirmed:
            form.kyc.customer_consent_confirmed ||
            form.application.customer_consent_confirmed,
        },
        kyc: form.kyc,
      };
      const response = editingId
        ? await axiosClient.put(`${API}/${editingId}`, payload)
        : await axiosClient.post(API, payload);
      setDrawer("");
      setNotice(
        response.data?.message ||
          (editingId ? "Credit application updated." : "Credit application created.")
      );
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "The credit application could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function performAction(application, suffix, payload, fallbackMessage) {
    if (!selectedContextId) {
      setProblem("Choose a specific equipment location before changing this application.");
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      const response = await axiosClient.post(`${API}/${application.id}/${suffix}`, payload);
      setActionDialog(null);
      setDrawer("");
      setNotice(response.data?.message || fallbackMessage);
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "The credit action could not be completed."));
    } finally {
      setSaving(false);
    }
  }

  function requestAction(application, kind, action = "") {
    const config = {
      assess: {
        title: "Recalculate affordability",
        message:
          "Recalculate income, commitments, installment burden, risk and recommendation using the saved application data?",
      },
      submit: {
        title: "Submit for independent review",
        message:
          "Submission locks ordinary editing until a manager requests changes. KYC and affordability must be complete.",
      },
      verify: {
        title: "Verify KYC evidence",
        message:
          "Confirm that identity, address, income and required guarantor evidence have been independently checked.",
      },
      reject_kyc: {
        title: "Reject KYC evidence",
        message:
          "Record why the KYC evidence is insufficient. The application will return for changes.",
      },
      start_review: {
        title: "Start manager review",
        message: "Move this submitted application into controlled manager review.",
      },
      request_changes: {
        title: "Request application changes",
        message: "Record the exact corrections required before another submission.",
      },
      approve: {
        title: "Approve credit application",
        message:
          "Approval records a credit decision only. It will not create an agreement, schedule, payment, equipment lock or ownership transfer.",
      },
      decline: {
        title: "Decline credit application",
        message: "Record the business reason for declining this application.",
      },
    }[kind];

    setActionDialog({ application, kind, action: action || kind, reason: "", ...config });
  }

  async function confirmAction(event) {
    event.preventDefault();
    const item = actionDialog;
    if (!item) return;
    if (["reject_kyc", "request_changes", "decline"].includes(item.kind) && !item.reason.trim()) {
      setProblem("Enter the reason before completing this decision.");
      return;
    }

    if (item.kind === "assess") {
      await performAction(item.application, "assess", {}, "Affordability recalculated.");
      return;
    }
    if (item.kind === "submit") {
      await performAction(
        item.application,
        "submit",
        { notes: item.reason },
        "Application submitted."
      );
      return;
    }
    if (["verify", "reject_kyc"].includes(item.kind)) {
      await performAction(
        item.application,
        "kyc/verify",
        {
          verification_status: item.kind === "verify" ? "verified" : "rejected",
          reason: item.reason,
        },
        "KYC decision recorded."
      );
      return;
    }

    await performAction(
      item.application,
      "review",
      { action: item.action, reason: item.reason },
      "Review decision recorded."
    );
  }

  const selectedApplication = detail?.application;
  const selectedKyc = detail?.kyc;

  return (
    <main className="credit-app">
      <section className="credit-app__hero">
        <div>
          <p>Credit application, KYC and affordability</p>
          <h1>Approve the customer before activating the agreement</h1>
          <span>{locationName}</span>
        </div>
        <div className="credit-app__hero-actions">
          <Link to="/equipment-installment-finance">Existing finance accounts</Link>
          {canManage ? (
            <button
              type="button"
              onClick={openCreate}
              disabled={!selectedContextId || readiness.ready !== true}
            >
              + New credit application
            </button>
          ) : null}
        </div>
      </section>

      <section className="credit-app__boundary">
        <span aria-hidden="true">🛡️</span>
        <div>
          <strong>Controlled finance boundary</strong>
          <p>
            An approved application is a credit decision only. This page cannot create
            agreements, payment schedules, payments, delivery evidence, equipment locks
            or ownership transfers.
          </p>
        </div>
      </section>

      {problem ? <div className="credit-app__alert is-error">{problem}</div> : null}
      {notice ? <div className="credit-app__alert is-success">{notice}</div> : null}
      {!selectedContextId ? (
        <div className="credit-app__alert is-warning">
          Choose a specific equipment location before creating, editing, submitting or
          reviewing a credit application.
        </div>
      ) : null}

      {readiness.ready === false ? (
        <section className="credit-app__foundation">
          <span aria-hidden="true">🏗️</span>
          <div>
            <p>Foundation awaiting controlled migration</p>
            <h2>Credit applications are not active in this database yet</h2>
            <span>
              The additive KYC and affordability migration must be backed up, approved
              and applied before staff can record applications.
            </span>
            {readiness.missing_tables?.length ? (
              <small>Missing: {readiness.missing_tables.join(", ")}</small>
            ) : null}
          </div>
        </section>
      ) : null}

      {readiness.ready === true ? (
        <>
          <section className="credit-app__metrics">
            <Metric
              icon="📥"
              title="Awaiting review"
              value={metrics.pending}
              note="Submitted or under manager review"
            />
            <Metric
              icon="🛠️"
              title="Changes required"
              value={metrics.changes}
              note="Returned for KYC or affordability correction"
            />
            <Metric
              icon="✅"
              title="Approved decisions"
              value={metrics.approved}
              note="Not yet activated as agreements"
            />
            <Metric
              icon="💼"
              title="Proposed exposure"
              value={money(metrics.proposedExposure)}
              note="Submitted, reviewed and approved financed amount"
            />
          </section>

          <section className="credit-app__toolbar">
            <label>
              <span>Search applications</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Application, customer, quotation or machine"
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                {STATUS_FILTERS.map(([value, title]) => (
                  <option key={value} value={value}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </section>

          {loading ? <div className="credit-app__loading">Loading credit applications…</div> : null}

          {!loading ? (
            <section className="credit-app__list" aria-label="Credit applications">
              <header>
                <div>
                  <p>Application register</p>
                  <h2>{visibleApplications.length} record(s)</h2>
                </div>
                <small>{approvedQuotations.length} approved quotation(s) available</small>
              </header>

              {!visibleApplications.length ? (
                <div className="credit-app__empty">
                  <span aria-hidden="true">📝</span>
                  <h3>No matching credit applications</h3>
                  <p>
                    Create an application from an approved installment quotation, then
                    complete KYC and affordability before manager approval.
                  </p>
                </div>
              ) : null}

              <div className="credit-app__cards">
                {visibleApplications.map((application) => (
                  <article className="credit-app__card" key={application.id}>
                    <div className="credit-app__card-image">
                      {application.main_image_url ? (
                        <img src={application.main_image_url} alt={application.asset_name || "Equipment"} />
                      ) : (
                        <span aria-hidden="true">🚜</span>
                      )}
                    </div>
                    <div className="credit-app__card-main">
                      <div className="credit-app__card-top">
                        <div>
                          <small>{application.application_number}</small>
                          <h3>{application.customer_name}</h3>
                          <p>
                            {application.asset_code || "Equipment"} · {application.asset_name || "Machine"}
                          </p>
                        </div>
                        <StatusPill value={application.application_status} />
                      </div>

                      <div className="credit-app__risk-row">
                        <span>
                          KYC <StatusPill value={application.kyc_status} />
                        </span>
                        <span>
                          Affordability <StatusPill value={application.affordability_status} />
                        </span>
                        <span>
                          Risk <StatusPill value={application.risk_band} />
                        </span>
                      </div>

                      <div className="credit-app__facts">
                        <div><span>Quoted</span><strong>{money(application.quoted_total)}</strong></div>
                        <div><span>Deposit</span><strong>{money(application.proposed_deposit)}</strong></div>
                        <div><span>Financed</span><strong>{money(application.financed_amount)}</strong></div>
                        <div><span>Monthly surplus</span><strong>{money(application.net_monthly_surplus)}</strong></div>
                        <div><span>Debt-service ratio</span><strong>{Number(application.debt_service_ratio_percent || 0).toFixed(1)}%</strong></div>
                        <div><span>Risk score</span><strong>{application.risk_score ?? "—"}</strong></div>
                      </div>

                      <div className="credit-app__card-actions">
                        <button type="button" onClick={() => openDetail(application)}>
                          View file
                        </button>
                        {canManage && ["draft", "changes_requested"].includes(application.application_status) ? (
                          <button type="button" onClick={() => openEdit(application)}>
                            Edit KYC &amp; affordability
                          </button>
                        ) : null}
                        {canManage && !["approved", "declined", "withdrawn"].includes(application.application_status) ? (
                          <button type="button" onClick={() => requestAction(application, "assess")}>
                            Recalculate
                          </button>
                        ) : null}
                        {canManage && ["draft", "changes_requested"].includes(application.application_status) ? (
                          <button className="is-primary" type="button" onClick={() => requestAction(application, "submit")}>
                            Submit
                          </button>
                        ) : null}
                        {canReview && application.application_status === "submitted" ? (
                          <button className="is-primary" type="button" onClick={() => requestAction(application, "start_review", "start_review")}>
                            Start review
                          </button>
                        ) : null}
                        {canReview && ["submitted", "under_review"].includes(application.application_status) && application.kyc_status !== "verified" ? (
                          <button type="button" onClick={() => requestAction(application, "verify")}>
                            Verify KYC
                          </button>
                        ) : null}
                        {canReview && ["submitted", "under_review"].includes(application.application_status) ? (
                          <button type="button" onClick={() => requestAction(application, "reject_kyc")}>
                            Reject KYC
                          </button>
                        ) : null}
                        {canReview && application.application_status === "under_review" ? (
                          <>
                            <button type="button" onClick={() => requestAction(application, "request_changes", "request_changes")}>
                              Request changes
                            </button>
                            <button type="button" onClick={() => requestAction(application, "decline", "decline")}>
                              Decline
                            </button>
                            <button className="is-approve" type="button" onClick={() => requestAction(application, "approve", "approve")}>
                              Approve decision
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {drawer === "form" ? (
        <Drawer
          title={editingId ? "Update credit application" : "New credit application"}
          subtitle="Complete customer identity, affordability, evidence and consent before submission."
          close={() => setDrawer("")}
        >
          <form className="credit-app__form" onSubmit={saveApplication}>
            <section className="credit-app__form-section">
              <header><span>1</span><div><h3>Quotation and proposed terms</h3><p>The approved installment quotation remains the commercial starting point.</p></div></header>
              <div className="credit-app__form-grid">
                <Field title="Approved installment quotation" wide>
                  <select
                    required={!editingId}
                    disabled={Boolean(editingId)}
                    value={form.quotation_id}
                    onChange={(event) => chooseQuotation(event.target.value)}
                  >
                    <option value="">Choose quotation</option>
                    {approvedQuotations.map((quotation) => (
                      <option key={quotation.id} value={quotation.id}>
                        {quotation.quotation_number} · {quotation.customer_name} · {money(quotation.total_amount)}
                      </option>
                    ))}
                    {editingId && form.quotation_id ? (
                      <option value={form.quotation_id}>Current approved quotation</option>
                    ) : null}
                  </select>
                </Field>
                <Field title="Application date"><input required type="date" value={form.application.application_date} onChange={(event) => updateApplication("application_date", event.target.value)} /></Field>
                <Field title="Proposed deposit"><input required type="number" min="0" step="0.01" value={form.application.proposed_deposit} onChange={(event) => updateApplication("proposed_deposit", event.target.value)} /></Field>
                <Field title="Payment frequency"><select value={form.application.proposed_frequency} onChange={(event) => updateApplication("proposed_frequency", event.target.value)}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></Field>
                <Field title="Installment count"><input required type="number" min="1" max="240" value={form.application.proposed_installment_count} onChange={(event) => updateApplication("proposed_installment_count", event.target.value)} /></Field>
              </div>
            </section>

            <section className="credit-app__form-section">
              <header><span>2</span><div><h3>Customer identity and KYC</h3><p>Capture the verified identity, residence and employment profile.</p></div></header>
              <div className="credit-app__form-grid">
                <Field title="Customer name"><input required value={form.kyc.customer_name_snapshot} onChange={(event) => updateKyc("customer_name_snapshot", event.target.value)} /></Field>
                <Field title="Phone"><input required value={form.kyc.customer_phone_snapshot} onChange={(event) => updateKyc("customer_phone_snapshot", event.target.value)} /></Field>
                <Field title="Email"><input type="email" value={form.kyc.customer_email_snapshot} onChange={(event) => updateKyc("customer_email_snapshot", event.target.value)} /></Field>
                <Field title="Nationality"><input value={form.kyc.nationality} onChange={(event) => updateKyc("nationality", event.target.value)} /></Field>
                <Field title="ID type"><select value={form.kyc.id_type} onChange={(event) => updateKyc("id_type", event.target.value)}><option value="Ghana Card">Ghana Card</option><option value="Passport">Passport</option><option value="Driver Licence">Driver Licence</option><option value="Voter ID">Voter ID</option><option value="Other">Other</option></select></Field>
                <Field title="ID number"><input required value={form.kyc.id_number} onChange={(event) => updateKyc("id_number", event.target.value)} /></Field>
                <Field title="Date of birth"><input required type="date" value={form.kyc.date_of_birth} onChange={(event) => updateKyc("date_of_birth", event.target.value)} /></Field>
                <Field title="Employment type"><select required value={form.kyc.employment_type} onChange={(event) => updateKyc("employment_type", event.target.value)}><option value="">Choose type</option><option value="salaried">Salaried</option><option value="self_employed">Self-employed</option><option value="contractor">Contractor</option><option value="pensioner">Pensioner</option><option value="farmer">Farmer</option><option value="other">Other</option></select></Field>
                <Field title="Occupation"><input value={form.kyc.occupation} onChange={(event) => updateKyc("occupation", event.target.value)} /></Field>
                <Field title="Employer or business"><input value={form.kyc.employer_business_name} onChange={(event) => updateKyc("employer_business_name", event.target.value)} /></Field>
                <Field title="Business registration number"><input value={form.kyc.business_registration_number} onChange={(event) => updateKyc("business_registration_number", event.target.value)} /></Field>
                <Field title="Years in employment or business"><input type="number" min="0" max="100" step="0.1" value={form.kyc.years_in_employment_business} onChange={(event) => updateKyc("years_in_employment_business", event.target.value)} /></Field>
                <Field title="Residential address" wide><textarea required rows="2" value={form.kyc.residential_address} onChange={(event) => updateKyc("residential_address", event.target.value)} /></Field>
                <Field title="Years at residence"><input type="number" min="0" max="100" step="0.1" value={form.kyc.years_at_residence} onChange={(event) => updateKyc("years_at_residence", event.target.value)} /></Field>
                <Field title="Work address"><input value={form.kyc.work_address} onChange={(event) => updateKyc("work_address", event.target.value)} /></Field>
                <Field title="Emergency contact"><input required value={form.kyc.emergency_contact_name} onChange={(event) => updateKyc("emergency_contact_name", event.target.value)} /></Field>
                <Field title="Emergency phone"><input required value={form.kyc.emergency_contact_phone} onChange={(event) => updateKyc("emergency_contact_phone", event.target.value)} /></Field>
                <Field title="Relationship"><input required value={form.kyc.emergency_contact_relationship} onChange={(event) => updateKyc("emergency_contact_relationship", event.target.value)} /></Field>
              </div>
            </section>

            <section className="credit-app__form-section">
              <header><span>3</span><div><h3>Affordability and commitments</h3><p>Use monthly-equivalent income, business costs, household expenses and existing debt.</p></div></header>
              <div className="credit-app__form-grid">
                <Field title="Monthly salary income"><input type="number" min="0" step="0.01" value={form.application.monthly_salary_income} onChange={(event) => updateApplication("monthly_salary_income", event.target.value)} /></Field>
                <Field title="Monthly business income"><input type="number" min="0" step="0.01" value={form.application.monthly_business_income} onChange={(event) => updateApplication("monthly_business_income", event.target.value)} /></Field>
                <Field title="Monthly other income"><input type="number" min="0" step="0.01" value={form.application.monthly_other_income} onChange={(event) => updateApplication("monthly_other_income", event.target.value)} /></Field>
                <Field title="Monthly business costs"><input type="number" min="0" step="0.01" value={form.application.monthly_business_costs} onChange={(event) => updateApplication("monthly_business_costs", event.target.value)} /></Field>
                <Field title="Monthly household expenses"><input type="number" min="0" step="0.01" value={form.application.monthly_household_expenses} onChange={(event) => updateApplication("monthly_household_expenses", event.target.value)} /></Field>
                <Field title="Existing monthly debt"><input type="number" min="0" step="0.01" value={form.application.existing_monthly_debt} onChange={(event) => updateApplication("existing_monthly_debt", event.target.value)} /></Field>
                <Field title="Assessment notes" wide><textarea rows="3" value={form.application.assessment_notes} onChange={(event) => updateApplication("assessment_notes", event.target.value)} placeholder="Explain seasonal income, exceptional costs or other facts the reviewer should consider." /></Field>
              </div>
            </section>

            <section className="credit-app__form-section">
              <header><span>4</span><div><h3>Guarantor, evidence and consent</h3><p>Higher financed amounts may require a complete guarantor record.</p></div></header>
              <div className="credit-app__form-grid">
                <Field title="Guarantor name"><input value={form.kyc.guarantor_name} onChange={(event) => updateKyc("guarantor_name", event.target.value)} /></Field>
                <Field title="Guarantor phone"><input value={form.kyc.guarantor_phone} onChange={(event) => updateKyc("guarantor_phone", event.target.value)} /></Field>
                <Field title="Guarantor relationship"><input value={form.kyc.guarantor_relationship} onChange={(event) => updateKyc("guarantor_relationship", event.target.value)} /></Field>
                <Field title="Guarantor ID type"><input value={form.kyc.guarantor_id_type} onChange={(event) => updateKyc("guarantor_id_type", event.target.value)} /></Field>
                <Field title="Guarantor ID number"><input value={form.kyc.guarantor_id_number} onChange={(event) => updateKyc("guarantor_id_number", event.target.value)} /></Field>
                <Field title="Guarantor address" wide><textarea rows="2" value={form.kyc.guarantor_address} onChange={(event) => updateKyc("guarantor_address", event.target.value)} /></Field>
                <Field title="Identity document URL"><input type="url" value={form.kyc.identity_document_url} onChange={(event) => updateKyc("identity_document_url", event.target.value)} /></Field>
                <Field title="Address evidence URL"><input type="url" value={form.kyc.address_evidence_url} onChange={(event) => updateKyc("address_evidence_url", event.target.value)} /></Field>
                <Field title="Income evidence URL"><input type="url" value={form.kyc.income_evidence_url} onChange={(event) => updateKyc("income_evidence_url", event.target.value)} /></Field>
                <Field title="Bank statement URL"><input type="url" value={form.kyc.bank_statement_url} onChange={(event) => updateKyc("bank_statement_url", event.target.value)} /></Field>
                <Field title="Business registration URL"><input type="url" value={form.kyc.business_registration_url} onChange={(event) => updateKyc("business_registration_url", event.target.value)} /></Field>
                <Field title="Guarantor document URL"><input type="url" value={form.kyc.guarantor_document_url} onChange={(event) => updateKyc("guarantor_document_url", event.target.value)} /></Field>
              </div>
              <div className="credit-app__checks">
                <Check checked={form.kyc.customer_consent_confirmed} onChange={(event) => updateKyc("customer_consent_confirmed", event.target.checked)} title="Customer consent confirmed" description="The customer consented to the application and use of the supplied information." />
                <Check checked={form.kyc.credit_assessment_consent_confirmed} onChange={(event) => updateKyc("credit_assessment_consent_confirmed", event.target.checked)} title="Credit-assessment consent confirmed" description="The customer consented to affordability, risk and supporting-evidence review." />
              </div>
            </section>

            <div className="credit-app__form-actions">
              <button type="button" onClick={() => setDrawer("")}>Cancel</button>
              <button className="is-primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Update and recalculate" : "Create draft application"}
              </button>
            </div>
          </form>
        </Drawer>
      ) : null}

      {drawer === "detail" ? (
        <Drawer
          title={selectedApplication?.application_number || "Credit application file"}
          subtitle="Customer, equipment, KYC, affordability and decision history."
          close={() => setDrawer("")}
        >
          {!detail ? <div className="credit-app__loading">Loading application file…</div> : null}
          {detail ? (
            <div className="credit-app__detail">
              <section className="credit-app__detail-identity">
                <div className="credit-app__detail-image">
                  {selectedApplication.main_image_url ? <img src={selectedApplication.main_image_url} alt={selectedApplication.asset_name || "Equipment"} /> : <span aria-hidden="true">🚜</span>}
                </div>
                <div>
                  <p>{selectedApplication.quotation_number}</p>
                  <h3>{selectedApplication.customer_name}</h3>
                  <span>{selectedApplication.asset_code} · {selectedApplication.asset_name} · {selectedApplication.make || ""} {selectedApplication.model || ""}</span>
                  <div><StatusPill value={selectedApplication.application_status} /><StatusPill value={selectedApplication.kyc_status} /><StatusPill value={selectedApplication.affordability_status} /><StatusPill value={selectedApplication.risk_band} /></div>
                </div>
              </section>

              <section className="credit-app__detail-grid">
                <DetailRow title="Quoted total" value={money(selectedApplication.quoted_total)} />
                <DetailRow title="Proposed deposit" value={money(selectedApplication.proposed_deposit)} />
                <DetailRow title="Financed amount" value={money(selectedApplication.financed_amount)} />
                <DetailRow title="Proposed installment" value={money(selectedApplication.proposed_installment_amount)} />
                <DetailRow title="Frequency" value={label(selectedApplication.proposed_frequency)} />
                <DetailRow title="Installment count" value={selectedApplication.proposed_installment_count} />
                <DetailRow title="Monthly income" value={money(selectedApplication.total_monthly_income)} />
                <DetailRow title="Monthly commitments" value={money(selectedApplication.total_monthly_commitments)} />
                <DetailRow title="Net monthly surplus" value={money(selectedApplication.net_monthly_surplus)} />
                <DetailRow title="Debt-service ratio" value={`${Number(selectedApplication.debt_service_ratio_percent || 0).toFixed(2)}%`} />
                <DetailRow title="Commitment ratio" value={`${Number(selectedApplication.total_commitment_ratio_percent || 0).toFixed(2)}%`} />
                <DetailRow title="Deposit ratio" value={`${Number(selectedApplication.deposit_ratio_percent || 0).toFixed(2)}%`} />
              </section>

              <section className="credit-app__detail-section">
                <header><h3>KYC file</h3><StatusPill value={selectedApplication.kyc_status} /></header>
                <div className="credit-app__detail-grid">
                  <DetailRow title="ID" value={`${selectedKyc?.id_type || "—"} · ${selectedKyc?.id_number || "—"}`} />
                  <DetailRow title="Date of birth" value={selectedKyc?.date_of_birth ? String(selectedKyc.date_of_birth).slice(0, 10) : "—"} />
                  <DetailRow title="Employment" value={`${label(selectedKyc?.employment_type)} · ${selectedKyc?.occupation || "—"}`} />
                  <DetailRow title="Employer or business" value={selectedKyc?.employer_business_name} />
                  <DetailRow title="Residential address" value={selectedKyc?.residential_address} />
                  <DetailRow title="Emergency contact" value={`${selectedKyc?.emergency_contact_name || "—"} · ${selectedKyc?.emergency_contact_phone || "—"}`} />
                  <DetailRow title="Guarantor" value={`${selectedKyc?.guarantor_name || "Not recorded"} · ${selectedKyc?.guarantor_phone || "—"}`} />
                  <DetailRow title="Consent" value={booleanValue(selectedKyc?.customer_consent_confirmed) && booleanValue(selectedKyc?.credit_assessment_consent_confirmed) ? "Both consents confirmed" : "Consent incomplete"} />
                </div>
              </section>

              <section className="credit-app__detail-section">
                <header><h3>Assessment recommendation</h3><StatusPill value={selectedApplication.affordability_status} /></header>
                <p className="credit-app__recommendation">{selectedApplication.assessment_recommendation || "No recommendation recorded."}</p>
                {selectedApplication.assessment_notes ? <pre>{selectedApplication.assessment_notes}</pre> : null}
              </section>

              <section className="credit-app__detail-section">
                <header><h3>Decision history</h3><span>{detail.decisions?.length || 0} event(s)</span></header>
                <div className="credit-app__timeline">
                  {(detail.decisions || []).map((decision) => (
                    <article key={decision.id}>
                      <span aria-hidden="true" />
                      <div>
                        <strong>{label(decision.action_type)}</strong>
                        <small>{decision.decided_by_name || "System"} · {decision.created_at ? new Date(decision.created_at).toLocaleString("en-GH") : ""}</small>
                        <p>{decision.notes || "No notes recorded."}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              {selectedApplication.application_status === "approved" ? (
                <section className="credit-app__approved-boundary">
                  <span aria-hidden="true">✅</span>
                  <div><strong>Credit decision approved</strong><p>Agreement activation remains a separate controlled release. No machine is reserved or locked by this approval.</p></div>
                </section>
              ) : null}
            </div>
          ) : null}
        </Drawer>
      ) : null}

      {actionDialog ? (
        <Drawer
          title={actionDialog.title}
          subtitle={actionDialog.application.application_number}
          close={() => setActionDialog(null)}
          size="small"
        >
          <form className="credit-app__decision" onSubmit={confirmAction}>
            <p>{actionDialog.message}</p>
            <Field
              title="Decision notes or reason"
              wide
              hint={
                ["reject_kyc", "request_changes", "decline"].includes(actionDialog.kind)
                  ? "Required for this decision."
                  : "Optional unless approving a manual-review application."
              }
            >
              <textarea
                rows="5"
                value={actionDialog.reason}
                onChange={(event) =>
                  setActionDialog((current) => ({ ...current, reason: event.target.value }))
                }
              />
            </Field>
            <div className="credit-app__form-actions">
              <button type="button" onClick={() => setActionDialog(null)}>Cancel</button>
              <button className="is-primary" type="submit" disabled={saving}>
                {saving ? "Recording…" : "Confirm action"}
              </button>
            </div>
          </form>
        </Drawer>
      ) : null}
    </main>
  );
}
