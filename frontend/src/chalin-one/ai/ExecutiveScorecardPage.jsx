import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../../api/axiosClient";
import { getAiStatus } from "./aiApi";
import "./executiveScorecard.css";

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH_START = `${TODAY.slice(0, 7)}-01`;

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function decimal(value, places = 0) {
  return numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

function percent(value) {
  return `${numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function shortDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString("en-GH", { day: "2-digit", month: "short" });
}

function permissionsFrom(status) {
  return new Set(
    Array.isArray(status?.permissions?.permissions)
      ? status.permissions.permissions
      : []
  );
}

function MetricCard({ label, value, note, tone = "navy" }) {
  return (
    <article className={`ces-metric ces-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function TrendChart({ rows }) {
  const width = 900;
  const height = 250;
  const pad = 28;
  const chartWidth = width - pad * 2;
  const chartHeight = height - pad * 2;
  const values = rows.flatMap((row) => [
    numberValue(row.recorded_revenue),
    numberValue(row.cash_received),
    numberValue(row.operating_cost),
  ]);
  const maxValue = Math.max(...values, 1);

  function points(key) {
    if (!rows.length) return "";
    return rows
      .map((row, index) => {
        const x =
          pad +
          (rows.length === 1
            ? chartWidth / 2
            : (index / (rows.length - 1)) * chartWidth);
        const y = pad + chartHeight - (numberValue(row[key]) / maxValue) * chartHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }

  if (!rows.length) {
    return <div className="ces-empty">No trend activity was recorded for this period.</div>;
  }

  return (
    <div className="ces-trend-wrap">
      <div className="ces-legend" aria-label="Trend legend">
        <span><i className="ces-dot ces-revenue" />Recorded revenue</span>
        <span><i className="ces-dot ces-cash" />Cash received</span>
        <span><i className="ces-dot ces-cost" />Operating cost</span>
      </div>
      <svg
        className="ces-trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Executive daily financial trend"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = pad + chartHeight - ratio * chartHeight;
          return (
            <line
              key={ratio}
              x1={pad}
              x2={width - pad}
              y1={y}
              y2={y}
              className="ces-grid-line"
            />
          );
        })}
        <polyline points={points("recorded_revenue")} className="ces-line ces-line-revenue" />
        <polyline points={points("cash_received")} className="ces-line ces-line-cash" />
        <polyline points={points("operating_cost")} className="ces-line ces-line-cost" />
      </svg>
      <div className="ces-axis">
        <span>{shortDate(rows[0]?.date)}</span>
        <span>Peak scale {money(maxValue)}</span>
        <span>{shortDate(rows.at(-1)?.date)}</span>
      </div>
    </div>
  );
}

function BusinessHealth({ label, value, note, status = "stable" }) {
  return (
    <article className="ces-business-card">
      <div>
        <span>{label}</span>
        <i data-state={status}>{status.replaceAll("_", " ")}</i>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function priorityRank(value) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[
    String(value || "low").toLowerCase()
  ] ?? 4;
}

export default function ExecutiveScorecardPage() {
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState({ from: MONTH_START, to: TODAY });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (nextFilters = filters, signal) => {
    setLoading(true);
    setError("");
    try {
      const [aiStatus, response] = await Promise.all([
        getAiStatus({ signal }),
        axiosClient.get("/group-executive/summary", {
          params: {
            from: nextFilters.from,
            to: nextFilters.to,
            branch_scope: "all",
          },
          signal,
          timeout: 120000,
        }),
      ]);
      const permissions = permissionsFrom(aiStatus);
      if (
        aiStatus?.flags?.chalinExecutive !== true ||
        !permissions.has("ai.executive.use")
      ) {
        throw new Error("Chalin Executive is disabled or not granted to this account.");
      }
      setStatus(aiStatus);
      setSummary(response.data?.summary || null);
    } catch (requestError) {
      if (requestError?.name === "CanceledError" || requestError?.code === "ERR_CANCELED") {
        return;
      }
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Executive scorecard could not be loaded."
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    load(filters, controller.signal);
    return () => controller.abort();
    // Initial scorecard load only; filter changes are applied explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(days) {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - Math.max(0, days - 1));
    const next = {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
    setFilters(next);
    load(next);
  }

  const group = summary?.group || {};
  const spare = summary?.spare_parts || {};
  const mining = summary?.mining || {};
  const hire = summary?.hire || {};
  const fleet = summary?.fleet || {};
  const cash = summary?.cash_control || {};
  const alerts = useMemo(
    () => [...(summary?.alerts || [])].sort(
      (left, right) => priorityRank(left.severity) - priorityRank(right.severity)
    ),
    [summary]
  );
  const recommendations = summary?.recommendations || [];
  const trendRows = summary?.financial_trend || [];
  const alertCounts = summary?.alert_counts || {};
  const critical = numberValue(alertCounts.critical);
  const high = numberValue(alertCounts.high);

  const pulse = critical > 0
    ? { label: "Critical review", state: "critical" }
    : high > 0 || numberValue(cash.variance_count) > 0
      ? { label: "Attention required", state: "warning" }
      : { label: "Controls stable", state: "stable" };

  return (
    <main className="ces-shell">
      <header className="ces-topbar">
        <div>
          <span className="ces-kicker">CHALIN ONE · Chalin Executive</span>
          <h1>Executive Intelligence Scorecard</h1>
          <p>
            Deterministic management intelligence from existing CHALIN records. This surface does not depend on the AI provider and cannot execute business changes.
          </p>
        </div>
        <div className="ces-top-actions">
          <span className="ces-live-pill" data-state={pulse.state}>{pulse.label}</span>
          <span className="ces-provider-pill">Provider: {status?.provider?.key || "disabled"}</span>
          <Link className="ces-button ces-button-secondary" to="/intelligence">Back to Intelligence</Link>
        </div>
      </header>

      <section className="ces-filterbar" aria-label="Executive scorecard period">
        <div className="ces-presets">
          <button type="button" onClick={() => applyPreset(1)}>Today</button>
          <button type="button" onClick={() => applyPreset(7)}>7 days</button>
          <button type="button" onClick={() => applyPreset(30)}>30 days</button>
        </div>
        <label>
          From
          <input
            type="date"
            value={filters.from}
            max={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.to}
            min={filters.from}
            max={TODAY}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        <button
          className="ces-button ces-button-primary"
          type="button"
          disabled={loading}
          onClick={() => load(filters)}
        >
          {loading ? "Refreshing…" : "Apply period"}
        </button>
      </section>

      {error ? (
        <section className="ces-error" role="alert">
          <strong>Executive scorecard unavailable</strong>
          <p>{error}</p>
          <small>Group-wide executive records remain restricted to the original System Administrator.</small>
        </section>
      ) : null}

      {loading && !summary ? (
        <section className="ces-loading" role="status">
          <span className="ces-spinner" />
          <strong>Building executive scorecard…</strong>
          <small>Consolidating authorized finance, operations, cash-control and risk records.</small>
        </section>
      ) : null}

      {summary ? (
        <>
          <section className="ces-metric-grid" aria-label="Group executive metrics">
            <MetricCard label="Recorded revenue" value={money(group.recorded_revenue)} note="Spare Parts sales + Hire invoiced" tone="navy" />
            <MetricCard label="Cash received" value={money(group.cash_received)} note={`Collection rate ${percent(group.collection_rate)}`} tone="green" />
            <MetricCard label="Operating cost" value={money(group.operating_cost)} note={`Cost ratio ${percent(group.cost_ratio)}`} tone="amber" />
            <MetricCard label="Receivables" value={money(group.outstanding_receivables)} note={`Receivable ratio ${percent(group.receivable_ratio)}`} tone="red" />
            <MetricCard label="Indicative balance" value={money(group.indicative_balance)} note="Management view, not statutory profit" tone={numberValue(group.indicative_balance) >= 0 ? "green" : "red"} />
            <MetricCard label="Management alerts" value={decimal(alertCounts.total)} note={`${decimal(critical)} critical · ${decimal(high)} high`} tone={critical > 0 ? "red" : high > 0 ? "amber" : "green"} />
          </section>

          <section className="ces-section">
            <div className="ces-section-heading">
              <div>
                <span>Business pulse</span>
                <h2>What is happening across CHALIN 03</h2>
              </div>
              <small>{summary.period?.from} → {summary.period?.to}</small>
            </div>
            <div className="ces-business-grid">
              <BusinessHealth
                label="Spare Parts"
                value={money(spare.sales_total)}
                note={`${decimal(spare.sales_count)} sales · ${decimal(spare.low_stock_count)} low-stock · ${money(spare.debt_balance)} debt`}
                status={numberValue(spare.low_stock_count) > 0 || numberValue(spare.debt_balance) > 0 ? "attention" : "stable"}
              />
              <BusinessHealth
                label="Mining Operations"
                value={money(mining.operating_cost)}
                note={`${decimal(mining.active_sites)} active site(s) · ${decimal(mining.open_incidents)} open incidents · ${decimal(mining.working_hours, 1)} working hours`}
                status={numberValue(mining.serious_open_incidents) > 0 ? "critical" : numberValue(mining.open_incidents) > 0 ? "attention" : "stable"}
              />
              <BusinessHealth
                label="Equipment Hire"
                value={money(hire.invoiced_total)}
                note={`${decimal(hire.active_contracts)} active contract(s) · ${money(hire.invoice_balance)} outstanding · ${money(hire.overdue_balance)} overdue`}
                status={numberValue(hire.overdue_balance) > 0 ? "attention" : "stable"}
              />
              <BusinessHealth
                label="Shared Fleet"
                value={`${decimal(fleet.total_assets)} assets`}
                note={`${decimal(fleet.available_assets)} available · ${decimal(fleet.service_due_count)} service due · ${decimal(fleet.open_maintenance_count)} open maintenance`}
                status={numberValue(fleet.service_due_count) > 0 || numberValue(fleet.open_maintenance_count) > 0 ? "attention" : "stable"}
              />
              <BusinessHealth
                label="Cash Control"
                value={`${decimal(cash.closing_count)} closings`}
                note={`${decimal(cash.variance_count)} variance · ${decimal(cash.awaiting_verification_count)} awaiting verification · ${decimal(cash.changed_after_close_count)} changed after close`}
                status={numberValue(cash.changed_after_close_count) > 0 ? "critical" : numberValue(cash.variance_count) > 0 || numberValue(cash.awaiting_verification_count) > 0 ? "attention" : "stable"}
              />
            </div>
          </section>

          <section className="ces-section">
            <div className="ces-section-heading">
              <div>
                <span>Trend intelligence</span>
                <h2>Revenue, cash and operating-cost movement</h2>
              </div>
              <small>Live deterministic records</small>
            </div>
            <TrendChart rows={trendRows} />
          </section>

          <section className="ces-dual-grid">
            <article className="ces-section">
              <div className="ces-section-heading">
                <div>
                  <span>Priority radar</span>
                  <h2>Management alerts</h2>
                </div>
                <strong>{decimal(alertCounts.total)}</strong>
              </div>
              <div className="ces-list">
                {alerts.slice(0, 10).map((alert, index) => (
                  <div className="ces-list-item" key={`${alert.category}-${alert.title}-${index}`}>
                    <i data-state={String(alert.severity || "low").toLowerCase()}>{alert.severity || "low"}</i>
                    <div>
                      <strong>{alert.title}</strong>
                      <p>{alert.detail}</p>
                      <small>{alert.category}</small>
                    </div>
                  </div>
                ))}
                {alerts.length === 0 ? <div className="ces-empty">No management alerts were raised.</div> : null}
              </div>
            </article>

            <article className="ces-section">
              <div className="ces-section-heading">
                <div>
                  <span>Recommended focus</span>
                  <h2>Management actions to review</h2>
                </div>
                <small>Human-controlled</small>
              </div>
              <div className="ces-list">
                {recommendations.slice(0, 10).map((item, index) => (
                  <div className="ces-list-item" key={`${item.area}-${item.title}-${index}`}>
                    <i data-state={String(item.priority || "low").toLowerCase()}>{item.priority || "low"}</i>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <small>{item.area}</small>
                    </div>
                  </div>
                ))}
                {recommendations.length === 0 ? <div className="ces-empty">No recommendation was generated from the current records.</div> : null}
              </div>
            </article>
          </section>

          <footer className="ces-footnote">
            <strong>Governance boundary:</strong> this scorecard reads the existing Group Executive Control summary. It does not send private records to an AI provider, does not bypass the original-administrator restriction and cannot approve or execute changes.
          </footer>
        </>
      ) : null}
    </main>
  );
}
