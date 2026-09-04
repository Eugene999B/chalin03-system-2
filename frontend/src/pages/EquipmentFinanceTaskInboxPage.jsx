import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/installmentCompletionPhaseOne.css";
import "../styles/equipmentFinanceTaskInbox.css";

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

function taskGroup(item) {
  const source = clean(item?.source).toLowerCase();
  const title = clean(item?.title).toLowerCase();
  if (source.includes("approval") || source.includes("review") || title.includes("approval") || title.includes("review")) {
    return "Approvals & review";
  }
  if (source.includes("data") || source.includes("quality") || title.includes("missing") || title.includes("incomplete") || title.includes("not issued")) {
    return "Data & document issues";
  }
  return "Operational tasks";
}

function shortCaseReference(item) {
  return clean(item?.application_number || item?.agreement_number || item?.customer_name) || "Linked Finance case";
}

export default function EquipmentFinanceTaskInboxPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState({ inbox: { items: [], summary: {}, pagination: {} } });

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/bootstrap`, {
        params: { page: 1, page_size: 1, inbox_page: page, inbox_page_size: PAGE_SIZE },
      });
      setResult(response.data || { inbox: { items: [], summary: {}, pagination: {} } });
    } catch (error) {
      setProblem(error?.response?.data?.message || error?.message || "Could not load the Finance work queue.");
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
      if (priority !== "all" && clean(item.priority || "normal") !== priority) return false;
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

  const groupedItems = useMemo(() => {
    const groups = new Map();
    for (const item of visibleItems) {
      const group = taskGroup(item);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    return Array.from(groups.entries());
  }, [visibleItems]);

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
    <main className="installment-completion task-inbox-page" data-testid="finance-task-approval-inbox">
      <header className="task-inbox__hero">
        <div>
          <p className="task-inbox__eyebrow">Finance work queue</p>
          <h1>Tasks & approvals</h1>
          <p>Start with the highest-impact work. Each row points to the exact customer application or agreement that needs attention.</p>
        </div>
        <div className="task-inbox__hero-actions">
          <Link to="/equipment-installment-finance/applications">Applications & Approvals</Link>
          <Link className="is-primary" to="/equipment-installment-finance/applications?stage=start">New installment</Link>
        </div>
      </header>

      {problem ? <div className="installment-completion__notice is-error" role="alert">{problem}</div> : null}

      <section className="task-inbox__snapshot" aria-label="Queue summary">
        <article><span>Needs action</span><strong>{loading ? "…" : Number(summary.total || 0)}</strong><small>All visible queue work</small></article>
        <article><span>Approval / review</span><strong>{loading ? "…" : Number(summary.approvals || 0)}</strong><small>Decision or verification work</small></article>
        <article><span>Critical</span><strong>{loading ? "…" : Number(summary.critical || 0)}</strong><small>Highest-priority exceptions</small></article>
        <article><span>Data / documents</span><strong>{loading ? "…" : Number(summary.data_quality || 0)}</strong><small>Records needing completion</small></article>
      </section>

      <section className="task-inbox__workspace">
        <div className="task-inbox__workspace-head">
          <div>
            <p className="task-inbox__eyebrow">Your queue</p>
            <h2>What needs attention now</h2>
            <span>Open one task to continue in the case’s dedicated operations file.</span>
          </div>
          <button type="button" onClick={loadInbox} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>

        <div className="task-inbox__filters">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, application or issue" aria-label="Search Finance task queue" />
          <div className="task-inbox__priority-filters" aria-label="Filter queue priority">
            {["all", "critical", "high", "normal", "low"].map((value) => (
              <button key={value} type="button" className={priority === value ? "is-selected" : ""} onClick={() => setPriority(value)}>
                {value === "all" ? "All" : label(value)}
              </button>
            ))}
          </div>
          <span className="task-inbox__visible-count">{visibleItems.length} shown</span>
        </div>

        {loading ? <div className="task-inbox__empty">Loading Finance tasks…</div> : null}
        {!loading && !visibleItems.length ? <div className="task-inbox__empty"><strong>No matching work.</strong><span>Nothing in this page matches the current search or priority filter.</span></div> : null}

        {!loading && groupedItems.length ? (
          <div className="task-inbox__groups">
            {groupedItems.map(([group, items]) => (
              <section className="task-inbox__group" key={group}>
                <header>
                  <div><h3>{group}</h3><span>{items.length} item{items.length === 1 ? "" : "s"}</span></div>
                </header>
                <div className="task-inbox__rows">
                  {items.map((item) => {
                    const level = clean(item.priority || "normal");
                    const identity = itemIdentity(item);
                    return (
                      <article className={`task-inbox__row is-${level}`} key={item.id}>
                        <div className="task-inbox__priority-mark" aria-hidden="true">!</div>
                        <div className="task-inbox__row-main">
                          <div className="task-inbox__row-meta">
                            <span>{label(item.source)}</span>
                            <b>{label(level)}</b>
                          </div>
                          <h4>{item.title}</h4>
                          <p>{item.description}</p>
                          <div className="task-inbox__row-context">
                            <span>{shortCaseReference(item)}</span>
                            <span>{dateTime(item.due_at)}</span>
                          </div>
                        </div>
                        <div className="task-inbox__row-action">
                          <button type="button" onClick={() => openItem(item)} disabled={!identity}>Open case</button>
                          {!identity ? <small>Case link unavailable</small> : <small>Continue in Case Operations</small>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        <footer className="task-inbox__pagination">
          <button type="button" disabled={loading || !pagination.has_previous_page} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
          <span>Page {pagination.page || page} of {pagination.total_pages || 1}</span>
          <button type="button" disabled={loading || !pagination.has_next_page} onClick={() => setPage((current) => current + 1)}>Next</button>
        </footer>
      </section>
    </main>
  );
}
