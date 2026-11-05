import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/installmentCompletionPhaseOne.css";
import "../styles/equipmentFinanceProductionHotfix.css";

const API = "/equipment-catalogue/sales/operational-polish";
const PAGE_SIZE = 25;

function clean(value) {
  return String(value || "").trim();
}

function label(value) {
  return clean(value || "Not recorded")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

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

function caseKey(item) {
  return `${item.case_type}:${item.case_id}`;
}

function parseIdentity(value) {
  const [type, rawId] = String(value || "").split(":");
  const id = Number(rawId);
  return ["application", "agreement"].includes(type) && Number.isSafeInteger(id) && id > 0
    ? { type, id }
    : null;
}

function requestedIdentity(search) {
  const params = new URLSearchParams(search);
  const type = params.get("case_type");
  const id = Number(params.get("case_id"));
  return ["application", "agreement"].includes(type) && Number.isSafeInteger(id) && id > 0
    ? { type, id }
    : null;
}

function applicationIdFor(caseData, identity) {
  const candidate = Number(
    caseData?.case?.application_id ||
      caseData?.case?.credit_application_id ||
      (identity?.type === "application" ? identity.id : 0)
  );
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

export default function EquipmentFinanceCaseOperationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialIdentity = useMemo(
    () => requestedIdentity(location.search),
    [location.search]
  );
  const [cases, setCases] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState(
    initialIdentity ? `${initialIdentity.type}:${initialIdentity.id}` : ""
  );
  const [caseData, setCaseData] = useState(null);
  const [loadingCases, setLoadingCases] = useState(true);
  const [loadingCase, setLoadingCase] = useState(false);
  const [problem, setProblem] = useState("");

  const identity = useMemo(() => parseIdentity(selectedKey), [selectedKey]);

  const loadCases = useCallback(async () => {
    setLoadingCases(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/cases`, {
        params: {
          page,
          page_size: PAGE_SIZE,
          search: search.trim() || undefined,
        },
      });
      const nextCases = response.data?.cases || [];
      setCases(nextCases);
      setPagination(response.data?.pagination || { page, total_pages: 1, total: nextCases.length });
      setSelectedKey((current) => {
        if (current) return current;
        return nextCases[0] ? caseKey(nextCases[0]) : "";
      });
    } catch (error) {
      setProblem(errorMessage(error, "Could not load Finance cases."));
    } finally {
      setLoadingCases(false);
    }
  }, [page, search]);

  const loadCase = useCallback(async (nextIdentity) => {
    if (!nextIdentity) {
      setCaseData(null);
      return;
    }
    setLoadingCase(true);
    setProblem("");
    try {
      const response = await axiosClient.get(
        `${API}/cases/${nextIdentity.type}/${nextIdentity.id}`
      );
      setCaseData(response.data || null);
    } catch (error) {
      setCaseData(null);
      setProblem(errorMessage(error, "Could not open the selected Finance case."));
    } finally {
      setLoadingCase(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCases(), search ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [loadCases, search]);

  useEffect(() => {
    void loadCase(identity);
  }, [identity, loadCase]);

  function chooseCase(value) {
    const nextIdentity = parseIdentity(value);
    setSelectedKey(value);
    if (!nextIdentity) return;
    const params = new URLSearchParams({
      stage: "case-operations",
      case_type: nextIdentity.type,
      case_id: String(nextIdentity.id),
    });
    navigate(`/equipment-installment-finance/applications?${params.toString()}`, {
      replace: true,
    });
  }

  const record = caseData?.case || {};
  const applicationId = applicationIdFor(caseData, identity);
  const caseNumber =
    record.case_number || record.application_number || record.agreement_number || "Finance case";
  const assetName =
    record.asset_label ||
    [record.asset_code, record.asset_name].filter(Boolean).join(" — ") ||
    "Excavator not recorded";
  const status = record.status || record.application_status || record.agreement_status;
  const events = caseData?.events || [];
  const alerts = caseData?.alerts || [];
  const payments = caseData?.payments || [];
  const documents = caseData?.documents || [];
  const issuedDocuments = caseData?.issued_documents || [];

  return (
    <main className="installment-completion" data-testid="finance-case-operations">
      <header className="installment-completion__hero">
        <div>
          <p className="installment-completion__eyebrow">One selected case</p>
          <h1>Case Operations</h1>
          <p>
            Open one application or active agreement to see its timeline, customer, exact
            excavator, alerts, documents and payments. This page is not an approval inbox.
          </p>
        </div>
        <div className="installment-completion__actions">
          <Link to="/equipment-installment-finance/applications?stage=inbox">Task Inbox</Link>
          <Link to="/equipment-installment-finance/applications">Applications</Link>
          <Link className="is-primary" to="/equipment-installment-finance/applications?stage=collections">
            Active Installments
          </Link>
        </div>
      </header>

      {problem ? (
        <div className="installment-completion__notice is-error" role="alert">
          {problem}
        </div>
      ) : null}

      <section className="installment-completion__case-grid">
        <aside className="installment-completion__panel">
          <div className="installment-completion__section-heading">
            <div>
              <p className="installment-completion__eyebrow">Find a case</p>
              <h2>Applications and accounts</h2>
            </div>
          </div>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Customer, application, agreement or machine"
            aria-label="Search Finance cases"
          />
          {loadingCases ? <div className="installment-completion__empty">Loading cases…</div> : null}
          <div className="installment-completion__case-list">
            {cases.map((item) => (
              <button
                type="button"
                className={caseKey(item) === selectedKey ? "is-active" : ""}
                key={caseKey(item)}
                onClick={() => chooseCase(caseKey(item))}
              >
                <strong>{item.case_number}</strong>
                <span>{item.customer_name}</span>
                <small>{item.asset_label}</small>
                <small>{label(item.status)}</small>
              </button>
            ))}
          </div>
          {!loadingCases && !cases.length ? (
            <div className="installment-completion__empty">No matching Finance case.</div>
          ) : null}
          <div className="installment-completion__pagination">
            <button
              type="button"
              disabled={loadingCases || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span>Page {pagination.page || page} of {pagination.total_pages || 1}</span>
            <button
              type="button"
              disabled={loadingCases || page >= Number(pagination.total_pages || 1)}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </aside>

        <div className="installment-completion__case-summary">
          {loadingCase ? <div className="installment-completion__empty">Opening case operations…</div> : null}
          {!loadingCase && !caseData ? (
            <div className="installment-completion__empty">
              Choose an application or active installment to open its operations file.
            </div>
          ) : null}
          {!loadingCase && caseData ? (
            <>
              <div className="installment-completion__section-heading">
                <div>
                  <p className="installment-completion__eyebrow">{label(identity?.type)}</p>
                  <h2>{caseNumber}</h2>
                  <span>{record.customer_name || "Customer not recorded"}</span>
                </div>
                <strong>{label(status)}</strong>
              </div>

              <section className="installment-completion__machine">
                <div className="installment-completion__machine-image">
                  {applicationId ? (
                    <img
                      src={`/equipment-catalogue/sales/credit-applications/${applicationId}/image`}
                      alt={record.asset_name || "Finance excavator"}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : null}
                </div>
                <div>
                  <p className="installment-completion__eyebrow">Exact excavator</p>
                  <h2>{assetName}</h2>
                  <p>{record.serial_number || record.chassis_number || "Serial or chassis number not recorded"}</p>
                </div>
              </section>

              <section className="installment-completion__facts" aria-label="Finance case facts">
                <div><span>Customer</span><strong>{record.customer_name || "Not recorded"}</strong></div>
                <div><span>Phone</span><strong>{record.customer_phone || "Not recorded"}</strong></div>
                <div><span>Total / quoted</span><strong>{money(record.total_amount || record.quoted_total)}</strong></div>
                <div><span>Outstanding</span><strong>{money(record.outstanding_balance)}</strong></div>
                <div><span>Payments</span><strong>{payments.length}</strong></div>
                <div><span>Private documents</span><strong>{documents.length}</strong></div>
                <div><span>Issued documents</span><strong>{issuedDocuments.length}</strong></div>
                <div><span>Timeline events</span><strong>{events.length}</strong></div>
              </section>

              <div className="installment-completion__quick-links">
                {applicationId ? (
                  <Link to={`/equipment-installment-finance/applications?application=${applicationId}`}>
                    Open application decision file
                  </Link>
                ) : null}
                <Link to="/equipment-installment-finance/applications?stage=case-workspace">
                  Secure documents & delivery
                </Link>
                {identity?.type === "agreement" ? (
                  <Link to={`/equipment-installment-finance/applications?stage=collections&agreement=${identity.id}`}>
                    Account and payment history
                  </Link>
                ) : (
                  <Link to="/equipment-installment-finance/applications?stage=activation">
                    Agreement preparation
                  </Link>
                )}
              </div>

              {alerts.length ? (
                <section className="installment-completion__panel">
                  <div className="installment-completion__section-heading">
                    <div>
                      <p className="installment-completion__eyebrow">Attention required</p>
                      <h2>Case alerts</h2>
                    </div>
                    <strong>{alerts.length}</strong>
                  </div>
                  <div className="installment-completion__alerts">
                    {alerts.slice(0, 8).map((alert) => (
                      <article className={`is-${alert.severity || "warning"}`} key={alert.id}>
                        <small>{label(alert.severity)}</small>
                        <h3>{alert.title}</h3>
                        <p>{alert.message}</p>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="installment-completion__panel">
                <div className="installment-completion__section-heading">
                  <div>
                    <p className="installment-completion__eyebrow">Complete chronology</p>
                    <h2>Case timeline</h2>
                    <span>Applications, decisions, documents, payments and account events.</span>
                  </div>
                  <strong>{events.length}</strong>
                </div>
                {!events.length ? (
                  <div className="installment-completion__empty">No case event has been recorded.</div>
                ) : null}
                <div className="installment-completion__timeline">
                  {events.map((event) => (
                    <article key={event.id}>
                      <small>{dateTime(event.occurred_at)} · {label(event.type)}</small>
                      <h3>{event.title}</h3>
                      {event.description ? <p>{event.description}</p> : null}
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
