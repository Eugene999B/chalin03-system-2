import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import CustomerFeatureControlsPanel from "../components/CustomerFeatureControlsPanel";
import UsersSettingsPage from "./UsersSettingsPage";

const IMPORTANT_RULES = new Set([
  "group.executive.management_attention",
  "group.executive.auditor_attention",
  "spare_parts.low_stock",
  "spare_parts.overdue_debt",
  "mining.fuel_variance",
  "mining.incident_open",
  "hire.approval_pending",
  "hire.deposit_pending",
]);

const RULE_INFO = {
  "group.executive.management_attention": {
    icon: "◈",
    title: "Management intelligence",
    when: "Every day",
    cadence: "One daily management analysis",
    detail:
      "Summarises critical and high-priority issues from the last 24 hours and highlights the most important exceptions for administrators.",
    delivery: "Administrators + registered owner contact",
    smsDefault: true,
  },
  "group.executive.auditor_attention": {
    icon: "✓",
    title: "Auditor attention",
    when: "After 7 days without an audit sign-off",
    cadence: "Checked every 15 minutes",
    detail:
      "Creates an audit-attention message when no recent audit sign-off is recorded. It becomes more urgent after longer periods without review.",
    delivery: "Auditors",
    smsDefault: true,
  },
  "spare_parts.low_stock": {
    icon: "▣",
    title: "Spare Parts low stock",
    when: "When stock reaches its restock level",
    cadence: "Checked every 15 minutes",
    detail: "Flags products that are at or below their configured low-stock threshold.",
    delivery: "Manager / selected role",
  },
  "spare_parts.overdue_debt": {
    icon: "₵",
    title: "Overdue customer debt",
    when: "When a balance passes its due date",
    cadence: "Checked every 15 minutes",
    detail: "Keeps overdue customer balances visible until the condition is cleared.",
    delivery: "Manager / selected role",
  },
  "mining.fuel_variance": {
    icon: "◒",
    title: "Mining fuel variance",
    when: "When reconciliation variance needs review",
    cadence: "Checked every 15 minutes",
    detail: "Highlights material fuel reconciliation differences for independent review.",
    delivery: "Manager / selected role",
  },
  "mining.incident_open": {
    icon: "!",
    title: "Mining serious incident",
    when: "When a high or critical incident remains open",
    cadence: "Checked every 15 minutes",
    detail: "Keeps serious safety incidents visible until the underlying condition is cleared.",
    delivery: "Manager / selected role",
  },
  "hire.approval_pending": {
    icon: "◫",
    title: "Equipment Hire approval",
    when: "While commercial approval is pending",
    cadence: "Checked every 15 minutes",
    detail: "Tracks equipment-hire approvals that still need an independent decision.",
    delivery: "Manager / selected role",
  },
  "hire.deposit_pending": {
    icon: "◇",
    title: "Equipment Hire deposit action",
    when: "While a deposit action needs approval",
    cadence: "Checked every 15 minutes",
    detail: "Keeps pending deposit refund or forfeiture decisions visible until resolved.",
    delivery: "Accountant / selected role",
  },
};

function humanDuration(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "No timed escalation";
  if (value % 1440 === 0) return `${value / 1440} day${value === 1440 ? "" : "s"}`;
  if (value % 60 === 0) return `${value / 60} hour${value === 60 ? "" : "s"}`;
  return `${value} min`;
}

function formatDateTime(value) {
  if (!value) return "No run recorded yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No run recorded yet";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(rule) {
  return rule?.is_enabled ? "on" : "off";
}

export default function UsersSettingsControlRoomPage() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [latestRun, setLatestRun] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const visibleRules = useMemo(
    () => rules.filter((rule) => IMPORTANT_RULES.has(rule.rule_code)),
    [rules]
  );

  const intelligenceOn = visibleRules.some((rule) => rule.rule_code.startsWith("group.executive.") && rule.is_enabled);
  const enabledCount = visibleRules.filter((rule) => rule.is_enabled).length;
  const smsCount = visibleRules.filter((rule) => rule.sms_allowed).length;

  async function loadIntelligence() {
    setLoading(true);
    setError("");
    try {
      const [rulesResponse, summaryResponse, runsResponse] = await Promise.all([
        axiosClient.get("/notifications/rules"),
        axiosClient.get("/notifications/summary"),
        axiosClient.get("/notifications/sync-runs"),
      ]);

      const nextRules = (rulesResponse.data?.rules || []).filter((rule) =>
        IMPORTANT_RULES.has(rule.rule_code)
      );
      const runs = runsResponse.data?.sync_runs || [];

      setRules(nextRules);
      setSummary(summaryResponse.data || null);
      setLatestRun(runs[0] || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Intelligence controls could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void loadIntelligence();
  }, [open]);

  async function saveRule(rule, changes) {
    setSavingId(rule.id);
    setMessage("");
    setError("");
    try {
      const response = await axiosClient.patch(
        `/notifications/rules/${rule.id}`,
        changes
      );
      const saved = response.data?.rule || { ...rule, ...changes };
      setRules((current) =>
        current.map((item) => (item.id === rule.id ? { ...item, ...saved } : item))
      );
      setMessage(`${rule.rule_name} updated.`);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The intelligence setting could not be saved."
      );
    } finally {
      setSavingId(null);
    }
  }

  async function runNow() {
    setRunning(true);
    setMessage("");
    setError("");
    try {
      const response = await axiosClient.post("/notifications/sync", {
        workspace_code: "group",
      });
      setMessage(
        response.data?.message ||
          "Intelligence analysis completed. Due management and audit alerts were processed."
      );
      await loadIntelligence();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The intelligence analysis could not be completed."
      );
    } finally {
      setRunning(false);
    }
  }

  const criticalCount =
    Number(summary?.critical || summary?.summary?.critical || 0) || 0;
  const highCount = Number(summary?.high || summary?.summary?.high || 0) || 0;
  const unreadCount = Number(summary?.unread || summary?.summary?.unread || 0) || 0;

  return (
    <>
      <CustomerFeatureControlsPanel />

      <section className="intelligence-launch-card">
        <style>{`
          .intelligence-launch-card {
            margin: 0 0 18px;
            border-radius: 24px;
            border: 1px solid #dbe3ef;
            overflow: hidden;
            background: linear-gradient(135deg,#07182c 0%,#0d2f55 62%,#111827 100%);
            color: #fff;
            box-shadow: 0 20px 50px rgba(7,24,44,.15);
          }
          .intelligence-launch-inner {
            display: grid;
            grid-template-columns: minmax(0,1fr) auto;
            gap: 18px;
            align-items: center;
            padding: 18px 20px;
          }
          .intelligence-kicker {
            color: #e0ba28;
            font-size: 10px;
            font-weight: 950;
            letter-spacing: .12em;
            text-transform: uppercase;
          }
          .intelligence-launch-title {
            margin: 4px 0 4px;
            font-size: 22px;
            line-height: 1.05;
            font-weight: 950;
          }
          .intelligence-launch-copy {
            margin: 0;
            color: rgba(255,255,255,.72);
            font-size: 13px;
            line-height: 1.5;
          }
          .intelligence-launch-actions {
            display: flex;
            gap: 9px;
            flex-wrap: wrap;
            justify-content: flex-end;
          }
          .intelligence-launch-button {
            border: 1px solid #e0ba28;
            border-radius: 13px;
            padding: 10px 15px;
            background: #e0ba28;
            color: #07182c;
            font-weight: 950;
            cursor: pointer;
          }
          .intelligence-run-button {
            border: 1px solid rgba(255,255,255,.25);
            border-radius: 13px;
            padding: 10px 15px;
            background: rgba(255,255,255,.09);
            color: #fff;
            font-weight: 900;
            cursor: pointer;
          }
          .intelligence-run-button:disabled,
          .intelligence-launch-button:disabled { opacity: .6; cursor: wait; }
          .intelligence-mini-status {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-top: 12px;
          }
          .intelligence-chip {
            border-radius: 999px;
            padding: 6px 9px;
            background: rgba(255,255,255,.09);
            color: rgba(255,255,255,.86);
            font-size: 11px;
            font-weight: 900;
          }
          .intelligence-dialog-backdrop {
            position: fixed;
            inset: 0;
            z-index: 2000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 22px;
            background: rgba(7,24,44,.62);
            backdrop-filter: blur(6px);
          }
          .intelligence-dialog {
            width: min(980px,100%);
            max-height: min(88vh,900px);
            overflow: hidden;
            border-radius: 28px;
            background: #f8fafc;
            color: #0f172a;
            border: 1px solid #dbe3ef;
            box-shadow: 0 36px 100px rgba(7,24,44,.34);
            display: flex;
            flex-direction: column;
          }
          .intelligence-dialog-head {
            padding: 20px 22px 16px;
            color: #fff;
            background: linear-gradient(135deg,#07182c,#0d2f55);
            border-bottom: 1px solid rgba(255,255,255,.1);
          }
          .intelligence-head-row {
            display: flex;
            justify-content: space-between;
            gap: 18px;
            align-items: flex-start;
          }
          .intelligence-dialog-head h2 {
            margin: 4px 0 5px;
            font-size: 28px;
            line-height: 1;
            font-weight: 950;
            letter-spacing: -.04em;
          }
          .intelligence-dialog-head p {
            margin: 0;
            color: rgba(255,255,255,.7);
            font-size: 13px;
            line-height: 1.5;
          }
          .intelligence-close {
            width: 38px;
            height: 38px;
            border: 1px solid rgba(255,255,255,.22);
            border-radius: 13px;
            background: rgba(255,255,255,.08);
            color: #fff;
            font-size: 22px;
            cursor: pointer;
          }
          .intelligence-summary-grid {
            display: grid;
            grid-template-columns: repeat(5,minmax(0,1fr));
            gap: 9px;
            margin-top: 16px;
          }
          .intelligence-summary-item {
            padding: 11px 12px;
            border-radius: 15px;
            background: rgba(255,255,255,.08);
            border: 1px solid rgba(255,255,255,.1);
          }
          .intelligence-summary-item span {
            display: block;
            color: rgba(255,255,255,.55);
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .08em;
            text-transform: uppercase;
          }
          .intelligence-summary-item strong {
            display: block;
            margin-top: 5px;
            font-size: 15px;
            font-weight: 950;
          }
          .intelligence-dialog-body {
            overflow: auto;
            padding: 18px 22px 22px;
          }
          .intelligence-control-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 14px;
          }
          .intelligence-control-bar strong { color: #07182c; }
          .intelligence-control-bar small { color: #64748b; font-weight: 750; }
          .intelligence-action-button {
            border: 1px solid #cbd5e1;
            border-radius: 12px;
            padding: 9px 12px;
            background: #fff;
            color: #07182c;
            font-weight: 900;
            cursor: pointer;
          }
          .intelligence-action-button.primary {
            border-color: #e0ba28;
            background: #e0ba28;
          }
          .intelligence-alert {
            margin-bottom: 13px;
            padding: 11px 13px;
            border-radius: 13px;
            font-size: 12px;
            font-weight: 850;
          }
          .intelligence-alert.success { background: #ecfdf5; color: #166534; }
          .intelligence-alert.error { background: #fef2f2; color: #991b1b; }
          .intelligence-section-label {
            margin: 18px 0 9px;
            color: #64748b;
            font-size: 10px;
            font-weight: 950;
            letter-spacing: .11em;
            text-transform: uppercase;
          }
          .intelligence-rule-list { display: grid; gap: 10px; }
          .intelligence-rule {
            padding: 14px;
            border: 1px solid #dbe3ef;
            border-radius: 20px;
            background: #fff;
          }
          .intelligence-rule-head {
            display: grid;
            grid-template-columns: auto minmax(0,1fr) auto;
            gap: 11px;
            align-items: start;
          }
          .intelligence-rule-icon {
            width: 34px;
            height: 34px;
            border-radius: 11px;
            display: grid;
            place-items: center;
            background: #fffbeb;
            color: #8b6a05;
            font-weight: 950;
          }
          .intelligence-rule-title { color: #07182c; font-weight: 950; }
          .intelligence-rule-detail { margin-top: 3px; color: #64748b; font-size: 12px; line-height: 1.45; }
          .intelligence-toggle {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            color: #334155;
            font-size: 11px;
            font-weight: 950;
            white-space: nowrap;
          }
          .intelligence-rule-grid {
            display: grid;
            grid-template-columns: repeat(4,minmax(0,1fr));
            gap: 8px;
            margin-top: 12px;
          }
          .intelligence-meta {
            padding: 9px 10px;
            border-radius: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
          }
          .intelligence-meta span {
            display: block;
            color: #94a3b8;
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .06em;
            text-transform: uppercase;
          }
          .intelligence-meta strong {
            display: block;
            margin-top: 4px;
            color: #334155;
            font-size: 11px;
            line-height: 1.3;
          }
          .intelligence-select,
          .intelligence-number {
            width: 100%;
            border: 1px solid #cbd5e1;
            border-radius: 9px;
            padding: 7px 8px;
            background: #fff;
            color: #0f172a;
            font-weight: 800;
          }
          .intelligence-footer-note {
            margin-top: 15px;
            padding: 11px 13px;
            border-radius: 14px;
            background: #eef2ff;
            border: 1px solid #c7d2fe;
            color: #3730a3;
            font-size: 11px;
            line-height: 1.5;
            font-weight: 750;
          }
          @media (max-width: 820px) {
            .intelligence-launch-inner { grid-template-columns: 1fr; }
            .intelligence-launch-actions { justify-content: flex-start; }
            .intelligence-summary-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
            .intelligence-rule-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
          }
          @media (max-width: 620px) {
            .intelligence-dialog-backdrop { padding: 0; align-items: flex-end; }
            .intelligence-dialog { width: 100%; max-height: 94vh; border-radius: 24px 24px 0 0; }
            .intelligence-dialog-head { padding: 17px 16px 14px; }
            .intelligence-dialog-head h2 { font-size: 23px; }
            .intelligence-dialog-body { padding: 15px 14px 20px; }
            .intelligence-summary-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
            .intelligence-rule-head { grid-template-columns: auto minmax(0,1fr); }
            .intelligence-toggle { grid-column: 1 / -1; }
            .intelligence-rule-grid { grid-template-columns: 1fr; }
            .intelligence-launch-actions { width: 100%; }
            .intelligence-launch-button, .intelligence-run-button { width: 100%; }
          }
        `}</style>

        <div className="intelligence-launch-inner">
          <div>
            <div className="intelligence-kicker">Management controls</div>
            <div className="intelligence-launch-title">Intelligence & Alerts</div>
            <p className="intelligence-launch-copy">
              Chalin 03 watches important operating conditions automatically and turns them into management, audit and operational attention.
            </p>
            <div className="intelligence-mini-status">
              <span className="intelligence-chip">Checks every 15 minutes</span>
              <span className="intelligence-chip">{enabledCount} rules enabled</span>
              <span className="intelligence-chip">{smsCount} SMS-enabled rules</span>
            </div>
          </div>
          <div className="intelligence-launch-actions">
            <button
              type="button"
              className="intelligence-run-button"
              onClick={runNow}
              disabled={running}
            >
              {running ? "Running analysis…" : "Run analysis now"}
            </button>
            <button
              type="button"
              className="intelligence-launch-button"
              onClick={() => setOpen(true)}
            >
              Open intelligence
            </button>
          </div>
        </div>

        {open ? (
          <div
            className="intelligence-dialog-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section className="intelligence-dialog" role="dialog" aria-modal="true" aria-label="Chalin 03 Intelligence and Alerts">
              <div className="intelligence-dialog-head">
                <div className="intelligence-head-row">
                  <div>
                    <div className="intelligence-kicker">Chalin 03 management intelligence</div>
                    <h2>Intelligence & Alerts</h2>
                    <p>
                      These controls change what the system watches, who receives the attention and when escalation is allowed.
                    </p>
                  </div>
                  <button type="button" className="intelligence-close" onClick={() => setOpen(false)} aria-label="Close intelligence settings">×</button>
                </div>
                <div className="intelligence-summary-grid">
                  <div className="intelligence-summary-item"><span>Engine</span><strong>{intelligenceOn ? "ON" : "OFF"}</strong></div>
                  <div className="intelligence-summary-item"><span>Automatic check</span><strong>15 min</strong></div>
                  <div className="intelligence-summary-item"><span>Management digest</span><strong>Daily</strong></div>
                  <div className="intelligence-summary-item"><span>Audit attention</span><strong>7 days</strong></div>
                  <div className="intelligence-summary-item"><span>Last run</span><strong>{latestRun ? formatDateTime(latestRun.completed_at || latestRun.started_at) : "Not recorded"}</strong></div>
                </div>
              </div>

              <div className="intelligence-dialog-body">
                {message ? <div className="intelligence-alert success">{message}</div> : null}
                {error ? <div className="intelligence-alert error">{error}</div> : null}

                <div className="intelligence-control-bar">
                  <div>
                    <strong>{criticalCount} critical • {highCount} high • {unreadCount} unread</strong>
                    <br />
                    <small>Live notification summary from the Chalin 03 alert engine.</small>
                  </div>
                  <div className="intelligence-launch-actions">
                    <button type="button" className="intelligence-action-button" onClick={() => void loadIntelligence()} disabled={loading}>Refresh status</button>
                    <button type="button" className="intelligence-action-button primary" onClick={runNow} disabled={running}>{running ? "Running…" : "Run & process now"}</button>
                  </div>
                </div>

                <div className="intelligence-section-label">What the system is watching</div>
                {loading ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontWeight: 800 }}>Loading intelligence controls…</div>
                ) : visibleRules.length === 0 ? (
                  <div style={{ padding: 18, borderRadius: 15, background: "#fff", border: "1px solid #dbe3ef", color: "#64748b", fontWeight: 800 }}>No configured intelligence rules are available for this account.</div>
                ) : (
                  <div className="intelligence-rule-list">
                    {visibleRules.map((rule) => {
                      const info = RULE_INFO[rule.rule_code] || {};
                      return (
                        <article className="intelligence-rule" key={rule.id}>
                          <div className="intelligence-rule-head">
                            <div className="intelligence-rule-icon">{info.icon || "•"}</div>
                            <div>
                              <div className="intelligence-rule-title">{info.title || rule.rule_name}</div>
                              <div className="intelligence-rule-detail">{info.detail || rule.description || rule.rule_code}</div>
                            </div>
                            <label className="intelligence-toggle">
                              <input type="checkbox" checked={Boolean(rule.is_enabled)} disabled={savingId === rule.id} onChange={(event) => saveRule(rule, { is_enabled: event.target.checked })} />
                              {rule.is_enabled ? "ON" : "OFF"}
                            </label>
                          </div>

                          <div className="intelligence-rule-grid">
                            <div className="intelligence-meta"><span>When</span><strong>{info.when || rule.description || "When the condition is detected"}</strong></div>
                            <div className="intelligence-meta"><span>Check</span><strong>{info.cadence || "Every 15 minutes"}</strong></div>
                            <div className="intelligence-meta"><span>Recipient</span>
                              <select className="intelligence-select" value={rule.target_role || "admin"} disabled={savingId === rule.id} onChange={(event) => saveRule(rule, { target_role: event.target.value })}>
                                <option value="admin">Administrators</option>
                                <option value="manager">Managers</option>
                                <option value="auditor">Auditors</option>
                                <option value="accountant">Accountants</option>
                                <option value="site_supervisor">Site supervisors</option>
                              </select>
                            </div>
                            <div className="intelligence-meta"><span>SMS</span>
                              <label className="intelligence-toggle" style={{ marginTop: 5 }}>
                                <input type="checkbox" checked={Boolean(rule.sms_allowed)} disabled={savingId === rule.id} onChange={(event) => saveRule(rule, { sms_allowed: event.target.checked })} />
                                {rule.sms_allowed ? "Allowed" : "Off"}
                              </label>
                            </div>
                          </div>

                          <div className="intelligence-rule-grid" style={{ marginTop: 8 }}>
                            <div className="intelligence-meta"><span>Escalate after</span>
                              <input className="intelligence-number" type="number" min="0" max="43200" value={rule.escalation_minutes ?? 0} disabled={savingId === rule.id} onChange={(event) => saveRule(rule, { escalation_minutes: Number(event.target.value || 0) })} />
                              <strong>{humanDuration(rule.escalation_minutes)}</strong>
                            </div>
                            <div className="intelligence-meta"><span>Delivery</span><strong>{info.delivery || "Selected role"}</strong></div>
                            <div className="intelligence-meta"><span>Severity</span><strong>{String(rule.default_severity || "medium").toUpperCase()}</strong></div>
                            <div className="intelligence-meta"><span>Status</span><strong>{statusTone(rule) === "on" ? "Watching now" : "Not watching"}</strong></div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                <div className="intelligence-footer-note">
                  <strong>How the intelligence works:</strong> the backend checks the configured business conditions automatically. A manual run performs the same analysis immediately. When a management or audit report is due and SMS escalation is enabled, Chalin 03 can send the configured alert through the existing SMS service; repeated sends are controlled by the notification engine.
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </section>

      <UsersSettingsPage />
    </>
  );
}
