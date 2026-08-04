import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/installmentCompletionPhaseOne.css";

const API = "/equipment-catalogue/sales/operational-polish";
const PAGE_SIZE = 25;

function label(value) {
  return String(value || "Not recorded")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateTime(value) {
  if (!value) return "No due date";
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

function itemIdentity(item) {
  const agreementId = Number(item?.agreement_id || 0);
  if (Number.isSafeInteger(agreementId) && agreementId > 0) {
    return { type: "agreement", id: agreementId };
  }
  const applicationId = Number(item?.application_id || 0);
  if (Number.isSafeInteger(applicationId) && applicationId > 0) {
    return { type: "application", id: applicationId };
  }
  return null;
}

export default function EquipmentFinanceTaskInboxPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState({
    inbox: { items: [], summary: {}, pagination: {} },
  });

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/bootstrap`, {
        params: {
          page: 1,
          page_size: 1,
          inbox_page: page,
          inbox_page_size: PAGE_SIZE,
        },
      });
      setResult(response.data || { inbox: { items: [], summary: {}, pagination: {} } });
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the Finance work queue."));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (result.inbox?.items || []).filter((item) => {
      if (priority !== "all" && String(item.priority || "normal") !== priority) {
        return false;
      }
      if (!term) return true;
      return [
        item.title,
        item.description,
        item.source,
        item.customer_name,
        item.application_number,
        item.agreement_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [priority, result.inbox?.items, search]);

  function openItem(item) {
    const identity = itemIdentity(item);
    if (!identity) {
      setProblem("This queue item is not linked to a Finance application or agreement.");
      return;
    }
    const params = new URLSearchParams({
      stage: "case-operations",
      case_type: identity.type,
      case_id: String(identity.id),
    });
    navigate(`/equipment-installment-finance/applications?${params.toString()}`);
  }

  const summary = result.inbox?.summary || {};
  const pagination = result.inbox?.pagination || {};

  return (
    <main className="installment-completion" data-testid="finance-task-approval-inbox">
      <header className="installment-completion__hero">
        <div>
          <p className="installment-completion__eyebrow">Action queue only</p>
          <h1>Task & Approval Inbox</h1>
          <p>
            This page contains work requiring action for your Finance access role. It is not
            the application register and it is not the full history of a customer case.
          </p>
        </div>
        <div className="installment-completion__actions">
          <Link to="/equipment-installment-finance/applications">Application register</Link>
          <Link className="is-primary" to="/equipment-installment-finance/applications?stage=start">
            Start New Installment
          </Link>
        </div>
      </header>

      {problem ? (
        <div className="installment-completion__notice is-error" role="alert">
          {problem}
        </div>
      ) : null}

      <section className="installment-completion__metrics" aria-label="Finance inbox totals">
        <article className="installment-completion__metric">
          <span>Queued work</span>
          <strong>{loading ? "…" : Number(summary.total || 0)}</strong>
        </article>
        <article className="installment-completion__metric">
          <span>Approvals / verification</span>
          <strong>{loading ? "…" : Number(summary.approvals || 0)}</strong>
        </article>
        <article className="installment-completion__metric">
          <span>Critical</span>
          <strong>{loading ? "…" : Number(summary.critical || 0)}</strong>
        </article>
        <article className="installment-completion__metric">
          <span>Data quality</span>
          <strong>{loading ? "…" : Number(summary.data_quality || 0)}</strong>
        </article>
      </section>

      <section className="installment-completion__panel">
        <div className="installment-completion__section-heading">
          <div>
            <p className="installment-completion__eyebrow">Your next actions</p>
            <h2>Tasks, approvals and exceptions</h2>
            <span>Open a queue item to continue work in that case’s dedicated operations file.</span>
          </div>
          <button type="button" onClick={loadInbox} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh inbox"}
          </button>
        </div>

        <div className="installment-completion__toolbar">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this page of tasks"
            aria-label="Search Finance inbox"
          />
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            aria-label="Filter Finance inbox by priority"
          >
            <option value="all">All priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <span>{visibleItems.length} visible</span>
        </div>

        {loading ? <div className="installment-completion__empty">Loading action queue…</div> : null}
        {!loading && !visibleItems.length ? (
          <div className="installment-completion__empty">
            No task or approval matches this page and filter.
          </div>
        ) : null}

        <div className="installment-completion__inbox">
          {visibleItems.map((item) => (
            <article className={`is-${item.priority || "normal"}`} key={item.id}>
              <div>
                <small>{label(item.source)} · {label(item.priority || "normal")}</small>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <small>{dateTime(item.due_at)}</small>
              </div>
              <div className="installment-completion__card-actions">
                <button type="button" onClick={() => openItem(item)}>
                  Open case operation
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="installment-completion__pagination">
          <button
            type="button"
            disabled={loading || !pagination.has_previous_page}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span>
            Page {pagination.page || page} of {pagination.total_pages || 1}
          </span>
          <button
            type="button"
            disabled={loading || !pagination.has_next_page}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </div>
      </section>
    </main>
  );
}
