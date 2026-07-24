import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import axiosClient from "../api/axiosClient";

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoText(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatMoney(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatLabel(value) {
  return String(value || "other")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function EvidenceCard({ title, value, note }) {
  return (
    <article className="expense-funding-evidence__card">
      <span>{title}</span>
      <strong>{formatMoney(value)}</strong>
      <small>{note}</small>
    </article>
  );
}

export default function AdvancedAccountingExpenseFundingEvidence() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [target, setTarget] = useState(null);
  const [startDate, setStartDate] = useState(daysAgoText(29));
  const [endDate, setEndDate] = useState(todayText());
  const [evidence, setEvidence] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const updatePath = (event) => {
      setPathname(event?.detail?.pathname || window.location.pathname);
    };
    window.addEventListener("chalin:route-change", updatePath);
    window.addEventListener("popstate", updatePath);
    return () => {
      window.removeEventListener("chalin:route-change", updatePath);
      window.removeEventListener("popstate", updatePath);
    };
  }, []);

  useEffect(() => {
    if (pathname !== "/advanced-accounting-intelligence") {
      setTarget(null);
      return undefined;
    }

    function findTarget() {
      setTarget(document.querySelector(".advanced-mobile-safe"));
    }

    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  async function loadEvidence() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get(
        "/accounting-intelligence/expense-funding",
        { params: { start_date: startDate, end_date: endDate } }
      );
      setEvidence(response.data?.expense_funding_evidence || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Failed to load expense funding evidence."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (target) loadEvidence();
    // The user can refresh after changing the evidence date range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const channels = useMemo(() => evidence?.closing_deductions || {}, [evidence]);

  if (!target) return null;

  return createPortal(
    <section className="expense-funding-evidence">
      <style>{`
        .expense-funding-evidence {
          margin: 22px 0 34px;
          padding: 22px;
          border: 1px solid #bfdbfe;
          border-radius: 22px;
          background: linear-gradient(135deg, #eff6ff, #ffffff 62%, #f0fdf4);
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
        }
        .expense-funding-evidence__head {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-end;
          margin-bottom: 18px;
        }
        .expense-funding-evidence__head h2 { margin: 4px 0 7px; }
        .expense-funding-evidence__head p { margin: 0; color: #475569; max-width: 760px; }
        .expense-funding-evidence__controls {
          display: grid;
          grid-template-columns: repeat(3, minmax(130px, auto));
          gap: 8px;
          align-items: end;
        }
        .expense-funding-evidence__controls label { font-size: 12px; font-weight: 800; color: #334155; }
        .expense-funding-evidence__controls input,
        .expense-funding-evidence__controls button {
          width: 100%; min-height: 42px; margin-top: 5px; border-radius: 10px;
        }
        .expense-funding-evidence__controls input { border: 1px solid #cbd5e1; padding: 8px 10px; }
        .expense-funding-evidence__controls button { border: 0; background: #0f3d73; color: white; font-weight: 900; padding: 9px 14px; }
        .expense-funding-evidence__grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin: 16px 0;
        }
        .expense-funding-evidence__card {
          padding: 15px; border-radius: 15px; background: white; border: 1px solid #dbeafe;
        }
        .expense-funding-evidence__card span,
        .expense-funding-evidence__card small { display: block; color: #64748b; }
        .expense-funding-evidence__card strong { display: block; margin: 7px 0; font-size: 21px; color: #0f172a; }
        .expense-funding-evidence__table { overflow-x: auto; }
        .expense-funding-evidence table { width: 100%; border-collapse: collapse; min-width: 760px; }
        .expense-funding-evidence th,
        .expense-funding-evidence td { text-align: left; padding: 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        .expense-funding-evidence th { color: #334155; background: #f8fafc; }
        .expense-funding-evidence__note { margin-top: 14px; padding: 12px; border-radius: 12px; background: #fff7ed; color: #9a3412; font-weight: 750; }
        .expense-funding-evidence__error { padding: 12px; border-radius: 12px; background: #fef2f2; color: #991b1b; }
        @media (max-width: 820px) {
          .expense-funding-evidence { padding: 15px; border-radius: 16px; }
          .expense-funding-evidence__head { flex-direction: column; align-items: stretch; }
          .expense-funding-evidence__controls { grid-template-columns: 1fr; }
          .expense-funding-evidence__grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="expense-funding-evidence__head">
        <div>
          <small>Expense funding control</small>
          <h2>Daily Closing & Accounting Evidence</h2>
          <p>
            All valid expenses reduce profit. Only expenses funded from today&apos;s
            sales receipts reduce the matching Daily Closing payment channel.
          </p>
        </div>
        <div className="expense-funding-evidence__controls">
          <label>
            Start date
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            End date
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <button type="button" onClick={loadEvidence} disabled={loading}>
            {loading ? "Loading…" : "Refresh Evidence"}
          </button>
        </div>
      </div>

      {error && <div className="expense-funding-evidence__error">{error}</div>}

      {evidence && (
        <>
          <div className="expense-funding-evidence__grid">
            <EvidenceCard title="All operating expenses" value={evidence.total_expenses} note={`${evidence.expense_count || 0} expense record(s)`} />
            <EvidenceCard title="Deducted from today's receipts" value={evidence.receipts_funded_expenses} note="Reduces Daily Closing" />
            <EvidenceCard title="Accounting only" value={evidence.externally_funded_expenses} note="Reduces profit, not today's closing" />
            <EvidenceCard title="Cash closing deduction" value={channels.cash} note={`MoMo ${formatMoney(channels.momo)} · Bank ${formatMoney(channels.bank)} · Other ${formatMoney(channels.other)}`} />
          </div>

          <div className="expense-funding-evidence__table">
            <table>
              <thead>
                <tr>
                  <th>Funding source</th>
                  <th>Records</th>
                  <th>Total expense</th>
                  <th>Daily Closing deduction</th>
                  <th>Accounting only</th>
                </tr>
              </thead>
              <tbody>
                {(evidence.by_funding_source || []).map((row) => (
                  <tr key={row.funding_source}>
                    <td>{formatLabel(row.funding_source)}</td>
                    <td>{row.expense_count}</td>
                    <td>{formatMoney(row.total)}</td>
                    <td>{formatMoney(row.closing_deduction)}</td>
                    <td>{formatMoney(row.accounting_only)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="expense-funding-evidence__note">
            {evidence.accounting_note}
          </div>
        </>
      )}
    </section>,
    target
  );
}
