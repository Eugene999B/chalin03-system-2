import { useEffect, useState } from "react";
import { Link } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/groupExecutive.css";

const now = new Date();
const today = now.toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

function numberValue(value) {
  const number = Number(value);
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
  if (!value) return "-";
  const text = String(value).slice(0, 10);
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? text
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function dateTime(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function extractFilename(headers, fallback) {
  const disposition = headers?.["content-disposition"] || "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1].replace(/["']/g, ""));
  }

  const normalMatch = disposition.match(/filename="?([^";]+)"?/i);
  return normalMatch?.[1] || fallback;
}

function clampPercent(value) {
  return Math.max(0, Math.min(numberValue(value), 100));
}

function severityRank(value) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[
    String(value || "low").toLowerCase()
  ] ?? 4;
}

function MetricCard({ icon, label, value, note, tone = "navy" }) {
  return (
    <article className={`gec-kpi-card gec-kpi-${tone}`}>
      <div className="gec-kpi-topline">
        <span className="gec-kpi-icon" aria-hidden="true">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="gec-section-header">
      <div>
        <span className="gec-section-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action || null}
    </div>
  );
}

function SeverityBadge({ value }) {
  const severity = String(value || "low").toLowerCase();
  return (
    <span className={`gec-severity gec-severity-${severity}`}>
      {severity}
    </span>
  );
}

function ProgressLine({ label, value, displayValue, tone = "blue" }) {
  return (
    <div className="gec-progress-line">
      <div>
        <span>{label}</span>
        <strong>{displayValue}</strong>
      </div>
      <div className="gec-progress-track" aria-hidden="true">
        <span
          className={`gec-progress-fill gec-progress-${tone}`}
          style={{ width: `${clampPercent(value)}%` }}
        />
      </div>
    </div>
  );
}

function TrendChart({ rows }) {
  const width = 920;
  const height = 250;
  const padding = 24;
  const values = rows.flatMap((row) => [
    numberValue(row.recorded_revenue),
    numberValue(row.cash_received),
    numberValue(row.operating_cost),
  ]);
  const maxValue = Math.max(...values, 1);
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  function points(key) {
    if (!rows.length) return "";
    return rows
      .map((row, index) => {
        const x =
          padding +
          (rows.length === 1 ? chartWidth / 2 : (index / (rows.length - 1)) * chartWidth);
        const y =
          padding + chartHeight - (numberValue(row[key]) / maxValue) * chartHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }

  if (!rows.length) {
    return (
      <div className="gec-empty-state">
        No financial activity was recorded for this period.
      </div>
    );
  }

  const first = rows[0];
  const last = rows[rows.length - 1];

  return (
    <div className="gec-trend-wrap">
      <div className="gec-chart-legend">
        <span><i className="gec-legend-revenue" />Recorded revenue</span>
        <span><i className="gec-legend-received" />Payments received</span>
        <span><i className="gec-legend-cost" />Operating cost</span>
      </div>
      <svg
        className="gec-trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Daily recorded revenue, payments received and operating cost trend"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding + chartHeight - ratio * chartHeight;
          return (
            <line
              key={ratio}
              x1={padding}
              x2={width - padding}
              y1={y}
              y2={y}
              className="gec-chart-gridline"
            />
          );
        })}
        <polyline points={points("recorded_revenue")} className="gec-line-revenue" />
        <polyline points={points("cash_received")} className="gec-line-received" />
        <polyline points={points("operating_cost")} className="gec-line-cost" />
      </svg>
      <div className="gec-chart-axis-labels">
        <span>{shortDate(first.date)}</span>
        <span>Peak scale {money(maxValue)}</span>
        <span>{shortDate(last.date)}</span>
      </div>
    </div>
  );
}

function BusinessCard({
  icon,
  eyebrow,
  title,
  status,
  statusTone,
  metrics,
  path,
  actionLabel,
}) {
  return (
    <article className="gec-business-card">
      <div className="gec-business-card-head">
        <span className="gec-business-icon" aria-hidden="true">{icon}</span>
        <div>
          <span>{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <span className={`gec-business-status gec-business-status-${statusTone}`}>
          {status}
        </span>
      </div>
      <div className="gec-business-stat-grid">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
      <Link to={path}>{actionLabel} →</Link>
    </article>
  );
}

function EmptyTableRow({ columns, text }) {
  return (
    <tr>
      <td className="gec-empty-cell" colSpan={columns}>{text}</td>
    </tr>
  );
}

export default function GroupExecutiveControlPage() {
  const { user, branchCode, branchName, canAccessAllBranches } = useAuth();

  const [filters, setFilters] = useState({
    from: monthStart,
    to: today,
    branch_scope: canAccessAllBranches ? "all" : "selected",
  });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedStoreLabel = `${branchCode || user?.branch_code || "STORE"} — ${
    branchName || user?.branch_name || "Selected Store"
  }`;

  function buildQuery(nextFilters = filters) {
    return {
      from: nextFilters.from,
      to: nextFilters.to,
      branch_scope:
        canAccessAllBranches && nextFilters.branch_scope === "all"
          ? "all"
          : "selected",
    };
  }

  async function loadSummary(nextFilters = filters) {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.get("/group-executive/summary", {
        params: buildQuery(nextFilters),
        timeout: 120000,
      });
      setSummary(response.data?.summary || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Could not load Group Executive Control."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    // Initial load only. Later filters are deliberately applied by management.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(preset) {
    const end = new Date();
    const start = new Date(end);

    if (preset === "today") {
      // same day
    } else if (preset === "7days") {
      start.setDate(end.getDate() - 6);
    } else if (preset === "30days") {
      start.setDate(end.getDate() - 29);
    } else {
      start.setDate(1);
    }

    const nextFilters = {
      ...filters,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
    setFilters(nextFilters);
    loadSummary(nextFilters);
  }

  async function downloadWorkbook() {
    setDownloading(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.get("/group-executive/workbook.xlsx", {
        params: buildQuery(),
        responseType: "blob",
        timeout: 120000,
      });
      const filename = extractFilename(
        response.headers,
        `chalin03-group-executive-${filters.from}-to-${filters.to}.xlsx`
      );
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotice(`Executive workbook downloaded successfully: ${filename}`);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Could not download the Group Executive workbook."
      );
    } finally {
      setDownloading(false);
    }
  }

  if (loading && !summary) {
    return (
      <div className="gec-loading-page">
        <div className="gec-loader" />
        <strong>Preparing executive intelligence...</strong>
        <span>Consolidating finance, operations, cash control and risk.</span>
      </div>
    );
  }

  const group = summary?.group || {};
  const spare = summary?.spare_parts || {};
  const finance = summary?.installment_finance || {};
  const mining = summary?.mining || {};
  const hire = summary?.hire || {};
  const fleet = summary?.fleet || {};
  const cashControl = summary?.cash_control || {};
  const commandCentre = summary?.command_centre || {};
  const alertCounts = summary?.alert_counts || {};
  const trendRows = Array.isArray(summary?.financial_trend)
    ? summary.financial_trend
    : [];
  const alerts = [...(summary?.alerts || [])].sort(
    (left, right) => severityRank(left.severity) - severityRank(right.severity)
  );
  const recommendations = summary?.recommendations || [];
  const spareCollectionRate =
    numberValue(spare.sales_total) > 0
      ? (numberValue(spare.sales_received) / numberValue(spare.sales_total)) * 100
      : 0;
  const businessScopeLabel =
    summary?.business_scope?.label || "All Chalin 03 businesses";
  const sparePartsFilterLabel =
    summary?.business_scope?.spare_parts_filter ||
    (summary?.branch_scope?.mode === "all"
      ? "All Spare Parts stores"
      : selectedStoreLabel);
  const criticalAttention =
    numberValue(alertCounts.critical) +
    numberValue(cashControl.changed_after_close_count);
  const managementPulse =
    criticalAttention > 0
      ? { label: "Critical review", tone: "critical", note: "Immediate management action required" }
      : numberValue(alertCounts.high) > 0 || numberValue(cashControl.variance_count) > 0
        ? { label: "Attention required", tone: "warning", note: "Priority exceptions need follow-up" }
        : { label: "Controls stable", tone: "stable", note: "No critical exception detected" };

  const commandMetrics = [
    {
      label: "Owner protection",
      value:
        commandCentre.owner_security?.readiness_label ||
        "Setup required",
      note: `${decimal(
        commandCentre.owner_security?.unused_recovery_codes
      )} unused recovery codes`,
    },
    {
      label: "Locked accounts",
      value: decimal(commandCentre.accounts?.locked_accounts),
      note: "Staff security review",
    },
    {
      label: "Active sessions",
      value: decimal(commandCentre.accounts?.active_sessions),
      note: "Server-side sessions",
    },
    {
      label: "Latest backup age",
      value:
        commandCentre.backups?.latest_backup_age_hours === null ||
        commandCentre.backups?.latest_backup_age_hours === undefined
          ? "No backup"
          : `${decimal(
              commandCentre.backups.latest_backup_age_hours
            )}h`,
      note: `Maximum ${decimal(
        commandCentre.backups?.maximum_age_hours
      )}h`,
    },
    {
      label: "Unverified backups",
      value: decimal(commandCentre.backups?.unverified_backups),
      note: "Verification outstanding",
    },
    {
      label: "Active workers",
      value: decimal(commandCentre.workforce?.active_workers),
      note: "Current workforce records",
    },
    {
      label: "Expiring documents",
      value: decimal(
        commandCentre.workforce?.expiring_documents
      ),
      note: "Expired or within warning period",
    },
    {
      label: "Expiring licences",
      value: decimal(
        commandCentre.workforce?.expiring_licenses
      ),
      note: "Licence follow-up required",
    },
    {
      label: "Overdue property",
      value: decimal(
        commandCentre.workforce?.overdue_property_returns
      ),
      note: "Company property not returned",
    },
    {
      label: "Owner login failures",
      value: decimal(
        commandCentre.security?.failed_owner_logins_24h
      ),
      note: "Past 24 hours",
    },
    {
      label: "Critical privileged actions",
      value: decimal(
        commandCentre.security
          ?.critical_privileged_actions_7d
      ),
      note: "Past 7 days",
    },
    {
      label: "Server errors",
      value: decimal(
        commandCentre.system?.application_errors_24h
      ),
      note: "HTTP 500-level errors in 24 hours",
    },
  ];

  const portfolioCards = [
      {
        icon: "🧰",
        eyebrow: "Retail operations",
        title: "Spare Parts",
        status:
          numberValue(spare.low_stock_count) > 0 || numberValue(spare.debt_balance) > 0
            ? "Attention"
            : numberValue(spare.sales_total) > 0
              ? "Active"
              : "No activity",
        statusTone:
          numberValue(spare.low_stock_count) > 0 || numberValue(spare.debt_balance) > 0
            ? "warning"
            : "stable",
        metrics: [
          { label: "Sales", value: money(spare.sales_total) },
          { label: "Received", value: money(spare.sales_received) },
          { label: "Collection rate", value: percent(spareCollectionRate) },
          { label: "Current debt", value: money(spare.debt_balance) },
          { label: "Expenses", value: money(spare.expenses_total) },
          { label: "Low stock", value: decimal(spare.low_stock_count) },
        ],
        path: "/reports",
        actionLabel: "Open Spare Parts reports",
      },
      {
        icon: "💳",
        eyebrow: "Finance portfolio",
        title: "Equipment Installment Finance",
        status:
          numberValue(finance.critical_risk_accounts) > 0
            ? "Critical"
            : numberValue(finance.overdue_amount) > 0 ||
                numberValue(finance.high_risk_accounts) > 0
              ? "Attention"
              : numberValue(finance.active_accounts) > 0
                ? "Active"
                : "No activity",
        statusTone:
          numberValue(finance.critical_risk_accounts) > 0
            ? "critical"
            : numberValue(finance.overdue_amount) > 0 ||
                numberValue(finance.high_risk_accounts) > 0
              ? "warning"
              : "stable",
        metrics: [
          { label: "Active accounts", value: decimal(finance.active_accounts) },
          { label: "Outstanding", value: money(finance.outstanding_amount) },
          { label: "Overdue", value: money(finance.overdue_amount) },
          { label: "Collection rate", value: percent(finance.collection_rate) },
          { label: "Due next 7 days", value: money(finance.due_next_7_days) },
          {
            label: "High / critical risk",
            value: `${decimal(finance.high_risk_accounts)} / ${decimal(
              finance.critical_risk_accounts
            )}`,
          },
        ],
        path: "/equipment-installment-finance/collections",
        actionLabel: "Open Installment Finance",
      },
      {
        icon: "⛏️",
        eyebrow: "Site operations",
        title: "Mining Operations",
        status:
          numberValue(mining.serious_open_incidents) > 0
            ? "Critical"
            : numberValue(mining.open_incidents) > 0 ||
                numberValue(mining.unapproved_daily_logs) > 0
              ? "Attention"
              : numberValue(mining.working_hours) > 0 ||
                  numberValue(mining.operating_cost) > 0
                ? "Active"
                : "No activity",
        statusTone:
          numberValue(mining.serious_open_incidents) > 0
            ? "critical"
            : numberValue(mining.open_incidents) > 0 ||
                numberValue(mining.unapproved_daily_logs) > 0
              ? "warning"
              : "stable",
        metrics: [
          { label: "Active sites", value: decimal(mining.active_sites) },
          { label: "Working hours", value: decimal(mining.working_hours, 1) },
          { label: "Operating cost", value: money(mining.operating_cost) },
          { label: "Open incidents", value: decimal(mining.open_incidents) },
          { label: "Pending logs", value: decimal(mining.unapproved_daily_logs) },
          {
            label: "Serious incidents",
            value: decimal(mining.serious_open_incidents),
          },
        ],
        path: "/mining",
        actionLabel: "Open Mining Operations",
      },
      {
        icon: "🏗️",
        eyebrow: "Commercial operations",
        title: "Equipment Hire",
        status:
          numberValue(hire.overdue_balance) > 0 ||
          numberValue(hire.unapproved_work_logs) > 0
            ? "Attention"
            : numberValue(hire.invoiced_total) > 0 ||
                numberValue(hire.active_contracts) > 0
              ? "Active"
              : "No activity",
        statusTone:
          numberValue(hire.overdue_balance) > 0 ||
          numberValue(hire.unapproved_work_logs) > 0
            ? "warning"
            : "stable",
        metrics: [
          { label: "Invoiced", value: money(hire.invoiced_total) },
          { label: "Payments", value: money(hire.payments_total) },
          { label: "Outstanding", value: money(hire.invoice_balance) },
          { label: "Overdue", value: money(hire.overdue_balance) },
          { label: "Active contracts", value: decimal(hire.active_contracts) },
          {
            label: "Pending work logs",
            value: decimal(hire.unapproved_work_logs),
          },
        ],
        path: "/equipment-hire-operations",
        actionLabel: "Open Equipment Hire",
      },
      {
        icon: "🚜",
        eyebrow: "Shared support unit",
        title: "Fleet & Maintenance",
        status:
          numberValue(fleet.unavailable_assets) > 0 ||
          numberValue(fleet.service_due_count) > 0
            ? "Attention"
            : numberValue(fleet.total_assets) > 0
              ? "Ready"
              : "No assets",
        statusTone:
          numberValue(fleet.unavailable_assets) > 0 ||
          numberValue(fleet.service_due_count) > 0
            ? "warning"
            : "stable",
        metrics: [
          { label: "Assets", value: decimal(fleet.total_assets) },
          { label: "Available", value: decimal(fleet.available_assets) },
          { label: "Unavailable", value: decimal(fleet.unavailable_assets) },
          { label: "Service due", value: decimal(fleet.service_due_count) },
        ],
        path: "/fleet-assets",
        actionLabel: "Open Fleet Control",
      },
    ];

  return (
    <div className="gec-page">
      <section className="gec-hero">
        <div className="gec-hero-copy">
          <span className="gec-eyebrow">Chalin 03 Company Limited</span>
          <h1>Executive Intelligence & Control</h1>
          <p>
            A group-wide, read-only executive view across every Chalin 03
            business. Each business is analysed separately so sales, Finance
            exposure, Mining cost and Hire activity are not mixed into unclear totals.
          </p>
          <div className="gec-hero-meta">
            <span>📅 {shortDate(summary?.period?.from)} – {shortDate(summary?.period?.to)}</span>
            <span>🏢 {businessScopeLabel}</span>
            <span>🧰 Spare Parts filter: {sparePartsFilterLabel}</span>
            <span>🔒 Executive oversight · no operational editing</span>
          </div>
        </div>

        <div className={`gec-pulse-card gec-pulse-${managementPulse.tone}`}>
          <span>Management pulse</span>
          <strong>{managementPulse.label}</strong>
          <p>{managementPulse.note}</p>
          <div>
            <span><b>{decimal(alertCounts.critical)}</b> Critical</span>
            <span><b>{decimal(alertCounts.high)}</b> High</span>
            <span><b>{decimal(alertCounts.medium)}</b> Medium</span>
          </div>
          <small>Updated {dateTime(summary?.generated_at)}</small>
        </div>
      </section>

      <section className="gec-toolbar">
        <div className="gec-period-presets">
          <span>Quick period</span>
          <button type="button" onClick={() => applyPreset("today")}>Today</button>
          <button type="button" onClick={() => applyPreset("7days")}>7 days</button>
          <button type="button" onClick={() => applyPreset("month")}>This month</button>
          <button type="button" onClick={() => applyPreset("30days")}>30 days</button>
        </div>

        <div className="gec-filter-grid">
          <label>
            <span>From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </label>
          <label>
            <span>Spare Parts store filter</span>
            <select
              value={filters.branch_scope}
              onChange={(event) =>
                setFilters((current) => ({ ...current, branch_scope: event.target.value }))
              }
            >
              <option value="selected">Selected store</option>
              {canAccessAllBranches ? <option value="all">All stores</option> : null}
            </select>
            <small>
              Applies only to Spare Parts. Installment Finance, Mining and
              Equipment Hire remain group-wide.
            </small>
          </label>
          <button
            className="gec-button-primary"
            type="button"
            onClick={() => loadSummary()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Apply filters"}
          </button>
          <button
            className="gec-button-secondary"
            type="button"
            onClick={downloadWorkbook}
            disabled={downloading}
          >
            {downloading ? "Preparing Executive Workbook…" : "Download Executive Workbook"}
          </button>
        </div>
      </section>

      {error ? <div className="gec-message gec-message-error">{error}</div> : null}
      {notice ? <div className="gec-message gec-message-success">{notice}</div> : null}

      {summary ? (
        <>
          <section className="gec-section-card">
            <SectionHeader
              eyebrow="Group Command Centre"
              title="Security, backup, workforce and system readiness"
              description="Live management controls from Owner protection, staff accounts, professional backups, worker records and application-health evidence."
              action={
                <Link to="/group-executive-control/configuration">
                  Open Group Configuration →
                </Link>
              }
            />

            <div className="gec-control-grid">
              {commandMetrics.map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.note}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="gec-kpi-grid">
            <MetricCard
              icon="🧰"
              label="Spare Parts sales"
              value={money(spare.sales_total)}
              note={`${percent(spareCollectionRate)} collected · ${sparePartsFilterLabel}`}
              tone="gold"
            />
            <MetricCard
              icon="💳"
              label="Installment collections"
              value={money(finance.payments_amount_in_period)}
              note={`${decimal(finance.payments_in_period)} payment record(s) in the selected period`}
              tone="green"
            />
            <MetricCard
              icon="◎"
              label="Finance outstanding"
              value={money(finance.outstanding_amount)}
              note={`${decimal(finance.active_accounts)} active installment account(s)`}
              tone="navy"
            />
            <MetricCard
              icon="!"
              label="Finance overdue"
              value={money(finance.overdue_amount)}
              note={`${decimal(finance.overdue_accounts)} overdue account(s)`}
              tone={numberValue(finance.overdue_amount) > 0 ? "red" : "green"}
            />
            <MetricCard
              icon="🏗️"
              label="Equipment Hire invoiced"
              value={money(hire.invoiced_total)}
              note={`${decimal(hire.active_contracts)} active contract(s)`}
              tone="navy"
            />
            <MetricCard
              icon="⛏️"
              label="Mining operating cost"
              value={money(mining.operating_cost)}
              note={`${decimal(mining.working_hours, 1)} working hour(s)`}
              tone="amber"
            />
            <MetricCard
              icon="🧮"
              label="Cash-control exceptions"
              value={decimal(
                numberValue(cashControl.variance_count) +
                  numberValue(cashControl.changed_after_close_count)
              )}
              note={`${decimal(cashControl.variance_count)} variance(s) · ${decimal(
                cashControl.changed_after_close_count
              )} changed after close`}
              tone={
                numberValue(cashControl.changed_after_close_count) > 0
                  ? "red"
                  : "navy"
              }
            />
            <MetricCard
              icon="⚑"
              label="Management alerts"
              value={decimal(alertCounts.total)}
              note={`${decimal(alertCounts.critical)} critical · ${decimal(
                alertCounts.high
              )} high`}
              tone={numberValue(alertCounts.critical) > 0 ? "red" : "navy"}
            />
          </section>

          <section className="gec-command-grid">
            <article className="gec-section-card gec-financial-health">
              <SectionHeader
                eyebrow="Executive briefing"
                title="Business-by-business financial picture"
                description="The figures below stay separate by business so management can see exactly where sales, collections, portfolio exposure and operating cost come from."
              />
              <div className="gec-financial-callout">
                <span>Trading activity roll-up</span>
                <strong>{money(group.indicative_balance)}</strong>
                <small>
                  Spare Parts sales + Equipment Hire invoices less Spare Parts
                  expenses and Mining operating cost. Installment Finance
                  outstanding is shown separately because it is portfolio
                  exposure, not ordinary period revenue.
                </small>
              </div>
              <div className="gec-progress-stack">
                <ProgressLine
                  label="Spare Parts collection rate"
                  value={spareCollectionRate}
                  displayValue={percent(spareCollectionRate)}
                  tone="green"
                />
                <ProgressLine
                  label="Installment Finance collection rate"
                  value={finance.collection_rate}
                  displayValue={percent(finance.collection_rate)}
                  tone="green"
                />
                <ProgressLine
                  label="Finance portfolio currently overdue"
                  value={finance.overdue_share_of_outstanding}
                  displayValue={percent(finance.overdue_share_of_outstanding)}
                  tone="red"
                />
              </div>
              <div className="gec-brief-facts">
                <div>
                  <span>Spare Parts sales</span>
                  <strong>{money(spare.sales_total)}</strong>
                </div>
                <div>
                  <span>Installment collections in period</span>
                  <strong>{money(finance.payments_amount_in_period)}</strong>
                </div>
                <div>
                  <span>Installment outstanding portfolio</span>
                  <strong>{money(finance.outstanding_amount)}</strong>
                </div>
                <div>
                  <span>Equipment Hire invoiced</span>
                  <strong>{money(hire.invoiced_total)}</strong>
                </div>
                <div>
                  <span>Mining operating cost</span>
                  <strong>{money(mining.operating_cost)}</strong>
                </div>
                <div>
                  <span>Spare Parts expenses</span>
                  <strong>{money(spare.expenses_total)}</strong>
                </div>
              </div>
            </article>

            <article className="gec-section-card gec-risk-command">
              <SectionHeader
                eyebrow="Risk command centre"
                title="Priority exceptions"
                description="The highest-risk items requiring management attention."
                action={<Link to="/activity-log">Open Activity Log →</Link>}
              />
              {alerts.length ? (
                <div className="gec-priority-list">
                  {alerts.slice(0, 6).map((alert, index) => (
                    <article key={`${alert.category}-${alert.title}-${index}`}>
                      <SeverityBadge value={alert.severity} />
                      <div>
                        <span>{alert.category}</span>
                        <strong>{alert.title}</strong>
                        <p>{alert.detail}</p>
                      </div>
                      <Link to={alert.path || "/"}>Review</Link>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="gec-empty-state">No priority exception was detected.</div>
              )}
            </article>
          </section>

          <section className="gec-section-card">
            <SectionHeader
              eyebrow="Performance movement"
              title="Daily trading-operations trend"
              description="Daily Spare Parts sales, Equipment Hire invoices and captured operating cost. Installment Finance is shown separately as a portfolio so its outstanding balance is not mistaken for period revenue."
            />
            <TrendChart rows={trendRows} />
          </section>

          <section className="gec-section-card">
            <SectionHeader
              eyebrow="All businesses"
              title="Performance by business unit"
              description="Every major Chalin 03 business remains visible. Units with no activity stay on the dashboard as 'No activity' instead of disappearing or being mixed into another business."
            />
            <div className="gec-business-grid">
              {portfolioCards.map((card) => (
                <BusinessCard key={card.title} {...card} />
              ))}
            </div>
          </section>

          <section className="gec-section-card gec-cash-control-card">
            <SectionHeader
              eyebrow="Cash control and audit oversight"
              title="Daily Closing control status"
              description="Management evidence for physical counts, variances, independent verification and protected corrections."
              action={<Link to="/daily-closing">Open Daily Closing →</Link>}
            />
            <div className="gec-control-grid">
              <div><span>Closings completed</span><strong>{decimal(cashControl.closing_count)}</strong><small>Selected period</small></div>
              <div><span>Awaiting verification</span><strong>{decimal(cashControl.awaiting_verification_count)}</strong><small>Independent review pending</small></div>
              <div><span>Closings with variance</span><strong>{decimal(cashControl.variance_count)}</strong><small>{money(cashControl.absolute_variance)} absolute variance</small></div>
              <div><span>Cash shortages</span><strong>{decimal(cashControl.shortage_count)}</strong><small>{money(cashControl.shortage_total)} shortage value</small></div>
              <div><span>Changed after closing</span><strong>{decimal(cashControl.changed_after_close_count)}</strong><small>Reconciliation required</small></div>
              <div><span>Protected sale changes</span><strong>{decimal(cashControl.protected_sale_change_count)}</strong><small>{decimal(cashControl.protected_void_count)} protected voids</small></div>
              <div><span>Approved refunds</span><strong>{decimal(cashControl.refund_count)}</strong><small>{money(cashControl.refund_total)} refunded</small></div>
              <div><span>Latest closing</span><strong>{shortDate(cashControl.latest_closing_date)}</strong><small>{decimal(cashControl.legacy_unconfirmed_count)} legacy unconfirmed</small></div>
            </div>
          </section>

          <section className="gec-management-grid">
            <article className="gec-section-card">
              <SectionHeader
                eyebrow="Management action queue"
                title="Recommended next actions"
                description="Prioritized from current records; decisions remain with management."
              />
              <div className="gec-action-list">
                {recommendations.slice(0, 8).map((item, index) => (
                  <article key={`${item.area}-${item.title}-${index}`}>
                    <div>
                      <SeverityBadge value={item.priority} />
                      <span>{item.area}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                    <Link to={item.path || "/"}>Open related control →</Link>
                  </article>
                ))}
              </div>
            </article>

            <article className="gec-section-card">
              <SectionHeader
                eyebrow="Spare Parts governance"
                title="Store comparison"
                description="Period sales and expenses with current debt and stock position."
              />
              <div className="gec-table-wrap">
                <table className="gec-table">
                  <thead>
                    <tr>
                      <th>Store</th>
                      <th>Sales</th>
                      <th>Received</th>
                      <th>Expenses</th>
                      <th>Debt</th>
                      <th>Low stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.branch_comparison || []).length ? (
                      summary.branch_comparison.map((row) => (
                        <tr key={row.id}>
                          <td data-label="Store"><strong>{row.branch_code}</strong><span>{row.branch_name}</span></td>
                          <td data-label="Sales">{money(row.sales_total)}</td>
                          <td data-label="Received">{money(row.sales_received)}</td>
                          <td data-label="Expenses">{money(row.expenses_total)}</td>
                          <td data-label="Debt">{money(row.debt_balance)}</td>
                          <td data-label="Low stock">{decimal(row.low_stock_count)}</td>
                        </tr>
                      ))
                    ) : (
                      <EmptyTableRow columns={6} text="No store comparison is available." />
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <details className="gec-detail-review">
            <summary>
              <div>
                <span>Detailed operational review</span>
                <strong>
                  Installment Finance risk accounts, Mining sites, Hire balances
                  and Fleet utilization
                </strong>
              </div>
              <span>Open details</span>
            </summary>
            <div className="gec-detail-content">
              <section className="gec-detail-wide">
                <SectionHeader
                  eyebrow="Equipment Installment Finance"
                  title="Priority portfolio accounts"
                  description="Highest-priority accounts from the Finance risk model. These are review signals, not findings of misconduct."
                />
                <div className="gec-table-wrap">
                  <table className="gec-table">
                    <thead>
                      <tr>
                        <th>Agreement / customer</th>
                        <th>Machine</th>
                        <th>Outstanding</th>
                        <th>Overdue</th>
                        <th>Days past due</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(finance.urgent_accounts || []).length ? (
                        finance.urgent_accounts.map((row, index) => (
                          <tr key={`${row.agreement}-${index}`}>
                            <td data-label="Agreement / customer">
                              <strong>{row.agreement}</strong>
                              <span>{row.customer}</span>
                            </td>
                            <td data-label="Machine">{row.machine}</td>
                            <td data-label="Outstanding">{money(row.outstanding)}</td>
                            <td data-label="Overdue">{money(row.overdue)}</td>
                            <td data-label="Days past due">
                              {decimal(row.days_past_due)}
                            </td>
                            <td data-label="Risk">
                              <strong>{row.risk_band || "Review"}</strong>
                              <span>{row.recommended_action || ""}</span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <EmptyTableRow
                          columns={6}
                          text="No priority Installment Finance account is currently surfaced."
                        />
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <SectionHeader eyebrow="Mining" title="Site performance" />
                <div className="gec-table-wrap">
                  <table className="gec-table">
                    <thead><tr><th>Site</th><th>Production</th><th>Target</th><th>Hours</th><th>Expenses</th></tr></thead>
                    <tbody>
                      {(summary.mining_sites || []).length ? summary.mining_sites.map((row) => (
                        <tr key={row.id}>
                          <td data-label="Site"><strong>{row.site_code}</strong><span>{row.site_name}</span></td>
                          <td data-label="Production">{decimal(row.production_quantity, 2)} {row.production_unit}</td>
                          <td data-label="Target">{decimal(row.daily_target, 2)}</td>
                          <td data-label="Hours">{decimal(row.working_hours, 1)}</td>
                          <td data-label="Expenses">{money(row.expenses_total)}</td>
                        </tr>
                      )) : <EmptyTableRow columns={5} text="No Mining site activity is available." />}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <SectionHeader eyebrow="Equipment Hire" title="Top customer balances" />
                <div className="gec-table-wrap">
                  <table className="gec-table">
                    <thead><tr><th>Customer</th><th>Invoiced</th><th>Paid</th><th>Balance</th></tr></thead>
                    <tbody>
                      {(summary.hire_customers || []).length ? summary.hire_customers.slice(0, 12).map((row) => (
                        <tr key={row.id}>
                          <td data-label="Customer"><strong>{row.customer_name}</strong><span>{row.customer_code}</span></td>
                          <td data-label="Invoiced">{money(row.invoiced_total)}</td>
                          <td data-label="Paid">{money(row.paid_total)}</td>
                          <td data-label="Balance">{money(row.balance_total)}</td>
                        </tr>
                      )) : <EmptyTableRow columns={4} text="No Hire customer balance is available." />}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="gec-detail-wide">
                <SectionHeader eyebrow="Shared Fleet" title="Asset utilization" />
                <div className="gec-table-wrap">
                  <table className="gec-table">
                    <thead><tr><th>Asset</th><th>Status / location</th><th>Mining hours</th><th>Hire hours</th><th>Productive</th><th>Breakdown</th></tr></thead>
                    <tbody>
                      {(summary.fleet_utilization || []).length ? summary.fleet_utilization.map((row) => (
                        <tr key={row.id}>
                          <td data-label="Asset"><strong>{row.asset_code}</strong><span>{row.asset_name}</span></td>
                          <td data-label="Status / location"><strong>{row.current_status}</strong><span>{row.current_location || "Not set"}</span></td>
                          <td data-label="Mining hours">{decimal(row.mining_working_hours, 1)}</td>
                          <td data-label="Hire hours">{decimal(row.hire_billable_hours, 1)}</td>
                          <td data-label="Productive">{decimal(row.total_productive_hours, 1)}</td>
                          <td data-label="Breakdown">{decimal(row.breakdown_hours, 1)}</td>
                        </tr>
                      )) : <EmptyTableRow columns={6} text="No Fleet utilization record is available." />}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </details>

          <section className="gec-quick-links">
            <Link to="/equipment-installment-finance/collections"><span>💳</span><div><strong>Installment Finance</strong><small>Portfolio, arrears and collections</small></div></Link>
            <Link to="/advanced-accounting-intelligence"><span>📈</span><div><strong>Accounting Intelligence</strong><small>Audit and financial review</small></div></Link>
            <Link to="/daily-closing"><span>🧮</span><div><strong>Daily Closing</strong><small>Counts, variance and verification</small></div></Link>
            <Link to="/activity-log"><span>🛡️</span><div><strong>Activity Log</strong><small>Accountability and evidence</small></div></Link>
            <Link to="/operations-documents-accounting"><span>📑</span><div><strong>Operations Documents</strong><small>Statements and controlled reports</small></div></Link>
            <Link to="/backup"><span>💾</span><div><strong>Backup & Recovery</strong><small>Administrator data protection</small></div></Link>
          </section>
        </>
      ) : null}
    </div>
  );
}
