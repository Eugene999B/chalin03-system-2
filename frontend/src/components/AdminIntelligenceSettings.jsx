import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const importantCodes = new Set([
  "group.executive.management_attention",
  "group.executive.auditor_attention",
  "spare_parts.low_stock",
  "spare_parts.overdue_debt",
  "mining.fuel_variance",
  "mining.incident_open",
  "hire.approval_pending",
  "hire.deposit_pending",
]);

function money(value) {
  const amount = Number(value || 0);
  return `GHS ${Number.isFinite(amount) ? amount.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function getWeekRange() {
  const now = new Date();
  const start = new Date(now);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function getMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function roleMessage(role, type, summary) {
  const group = summary?.group || {};
  const spare = summary?.spare_parts || {};
  const mining = summary?.mining || {};
  const hire = summary?.hire || {};
  const cash = summary?.cash_control || {};
  const title = type === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence";

  if (role === "auditor") {
    return `${title}: review focus. Daily closings ${cash.closing_count || 0}; awaiting verification ${cash.awaiting_verification_count || 0}; changed after close ${cash.changed_after_close_count || 0}; variance records ${cash.variance_count || 0}; absolute variance ${money(cash.absolute_variance)}. Outstanding customer debt ${money(spare.debt_balance)}. Serious/high Mining incidents ${mining.serious_open_incidents || 0}. Please review evidence, exceptions, approvals and sign-offs.`;
  }

  if (role === "manager") {
    return `${title}: sales ${money(spare.sales_total)}; payments received ${money(spare.sales_received)}; operating expenses ${money(spare.expenses_total)}; estimated operating result ${money(spare.estimated_store_margin)}; customer debt ${money(spare.debt_balance)}; low stock ${spare.low_stock_count || 0}; Mining incidents ${mining.open_incidents || 0}; hire outstanding ${money(hire.invoice_balance)}. Priority: ${cash.changed_after_close_count || 0} closing record(s) changed after close and ${cash.awaiting_verification_count || 0} awaiting verification.`;
  }

  return `${title}: sales ${money(group.sales_total)}; payments received ${money(group.sales_received)}; operating expenses ${money(group.expenses_total)}; estimated operating result ${money(group.estimated_store_margin)}; outstanding debt ${money(spare.debt_balance)}; Daily Closing records ${cash.closing_count || 0}, verified ${cash.verified_count || 0}, awaiting verification ${cash.awaiting_verification_count || 0}; variance exposure ${money(cash.absolute_variance)}; low stock ${spare.low_stock_count || 0}; Mining serious/high incidents ${mining.serious_open_incidents || 0}; Equipment Hire balance ${money(hire.invoice_balance)}.`;
}

export default function AdminIntelligenceSettings() {
  const { user, canAccessAllBranches } = useAuth();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [manualSending, setManualSending] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const visibleRules = useMemo(
    () => rules.filter((rule) => importantCodes.has(rule.rule_code)),
    [rules]
  );

  const weeklyRule = rules.find((rule) => rule.rule_code === "group.executive.weekly_business_intelligence");
  const monthlyRule = rules.find((rule) => rule.rule_code === "group.executive.monthly_business_intelligence");

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/notifications/rules");
      setRules(response.data?.rules || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Notification controls could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) loadRules();
  }, [open]);

  async function updateRule(rule, changes) {
    setSavingId(rule.id);
    setError("");
    setNotice("");
    try {
      const response = await axiosClient.patch(`/notifications/rules/${rule.id}`, changes);
      setRules((current) => current.map((item) => (item.id === rule.id ? { ...item, ...(response.data?.rule || changes) } : item)));
      setNotice("Alert setting saved.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The alert setting could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

  async function refreshNow() {
    setError("");
    setNotice("");
    try {
      await axiosClient.post("/notifications/sync", { workspace_code: "group" });
      setNotice("Condition intelligence refreshed. This action does not send the weekly/monthly business report.");
      await loadRules();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The intelligence refresh could not be started.");
    }
  }

  async function sendManualReport(type) {
    setManualSending(type);
    setError("");
    setNotice("");
    try {
      const range = type === "weekly" ? getWeekRange() : getMonthRange();
      const summaryResponse = await axiosClient.get("/group-executive/summary", {
        params: {
          from: range.from,
          to: range.to,
          branch_scope: canAccessAllBranches ? "all" : "selected",
        },
        timeout: 120000,
      });
      const summary = summaryResponse.data?.summary || {};

      const recipients = ["admin", "manager", "auditor"];
      for (const role of recipients) {
        await axiosClient.post("/notifications/manual", {
          workspace_code: "group",
          target_role: role,
          target_permission: "notifications.view",
          category: "executive",
          severity: role === "auditor" ? "high" : "medium",
          title: type === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence",
          message: roleMessage(role, type, summary),
          action_path: "/group-executive-control",
          source_reference: `manual_${type}_business_intelligence_${Date.now()}`,
        });
      }

      setNotice(`${type === "weekly" ? "Weekly" : "Monthly"} intelligence report sent to administrators, managers and auditors in the Chalin 03 notification centre.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || `The ${type} report could not be sent.`);
    } finally {
      setManualSending("");
    }
  }

  return (
    <>
      <section className="c03-intel-strip">
        <div>
          <span className="c03-intel-eyebrow">Management intelligence</span>
          <strong>Business Intelligence & Alerts</strong>
          <span>Weekly and monthly reports, plus live operational exception monitoring.</span>
        </div>
        <button type="button" className="c03-intel-open" onClick={() => setOpen(true)}>
          Open intelligence
        </button>
      </section>

      {open ? (
        <div className="c03-intel-overlay" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="c03-intel-dialog" role="dialog" aria-modal="true" aria-label="Business intelligence settings">
            <style>{`
              .c03-intel-overlay{position:fixed;inset:0;z-index:1500;background:rgba(7,24,44,.58);display:grid;place-items:center;padding:18px}
              .c03-intel-dialog{width:min(960px,100%);max-height:88vh;overflow:auto;background:#fff;color:#10213b;border:1px solid #dbe3ef;border-radius:24px;box-shadow:0 32px 90px rgba(7,24,44,.30);padding:24px}
              .c03-intel-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid #e7edf4;padding-bottom:16px}
              .c03-intel-kicker{display:block;color:#b88910;font-size:11px;font-weight:950;letter-spacing:.1em;text-transform:uppercase}
              .c03-intel-head h2{margin:5px 0 4px;color:#07182c;font-size:28px;letter-spacing:-.04em}
              .c03-intel-head p{margin:0;color:#64748b;font-size:13px;line-height:1.5}
              .c03-intel-close{border:0;background:#f1f5f9;border-radius:12px;width:40px;height:40px;font-size:24px;color:#07182c;cursor:pointer}
              .c03-intel-note{margin:16px 0;padding:13px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.55}
              .c03-intel-schedule{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
              .c03-intel-card{border:1px solid #e2e8f0;border-radius:18px;padding:16px;background:linear-gradient(180deg,#fff,#f8fafc)}
              .c03-intel-card h3{margin:0;color:#07182c;font-size:17px}
              .c03-intel-card p{margin:6px 0;color:#64748b;font-size:12px;line-height:1.5}
              .c03-intel-pillrow{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
              .c03-intel-pill{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;background:#eef4fb;color:#23486d;font-size:11px;font-weight:900}
              .c03-intel-status{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:950;margin-bottom:10px}
              .c03-intel-status.on{background:#ecfdf5;color:#166534}.c03-intel-status.off{background:#fef2f2;color:#991b1b}
              .c03-intel-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
              .c03-intel-primary,.c03-intel-secondary{border-radius:11px;padding:9px 12px;font-weight:900;cursor:pointer}
              .c03-intel-primary{border:1px solid #07182c;background:#07182c;color:#fff}.c03-intel-secondary{border:1px solid #dbe3ef;background:#fff;color:#07182c}
              .c03-intel-primary:disabled,.c03-intel-secondary:disabled{opacity:.55;cursor:not-allowed}
              .c03-intel-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0 12px}
              .c03-intel-section-title{font-size:15px;font-weight:950;color:#07182c}
              .c03-intel-subtle{font-size:12px;color:#64748b}
              .c03-intel-rules{display:grid;gap:9px}
              .c03-intel-rule{border:1px solid #e2e8f0;border-radius:14px;padding:14px;background:#fff}
              .c03-intel-rule-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
              .c03-intel-rule strong{color:#07182c;font-size:14px}.c03-intel-rule p{margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.5}
              .c03-intel-rule-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}
              .c03-intel-rule-meta div{padding:9px;border-radius:10px;background:#f8fafc;border:1px solid #eef2f7}.c03-intel-rule-meta span{display:block;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.05em}.c03-intel-rule-meta b{display:block;margin-top:3px;color:#10213b;font-size:12px}
              .c03-intel-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:900}
              .c03-intel-message{margin-top:13px;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:800}.c03-intel-success{background:#ecfdf5;color:#166534}.c03-intel-error{background:#fef2f2;color:#991b1b}
              @media (max-width:720px){.c03-intel-overlay{align-items:end;padding:0}.c03-intel-dialog{width:100%;max-height:92vh;border-radius:22px 22px 0 0;padding:18px}.c03-intel-schedule{grid-template-columns:1fr}.c03-intel-rule-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.c03-intel-head h2{font-size:24px}.c03-intel-actions>*{width:100%}}
            `}</style>

            <div className="c03-intel-head">
              <div>
                <span className="c03-intel-kicker">Chalin 03 management control</span>
                <h2>Business Intelligence</h2>
                <p>Scheduled business reports are separate from the live condition monitor.</p>
              </div>
              <button type="button" className="c03-intel-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>

            <div className="c03-intel-note">
              <strong>How this works:</strong> the background engine checks operational conditions every 15 minutes. <strong>It does not send a report or SMS every 15 minutes.</strong> Weekly intelligence is sent after the Saturday Daily Closing is confirmed. Monthly intelligence is sent after the final Daily Closing of the month. Manual report buttons publish an immediate in-system report.
            </div>

            {notice ? <div className="c03-intel-message c03-intel-success">{notice}</div> : null}
            {error ? <div className="c03-intel-message c03-intel-error">{error}</div> : null}

            <div className="c03-intel-schedule">
              <article className="c03-intel-card">
                <span className={`c03-intel-status ${weeklyRule?.is_enabled ? "on" : "off"}`}>{weeklyRule?.is_enabled ? "ACTIVE" : "OFF"}</span>
                <h3>Weekly Business Intelligence</h3>
                <p><strong>When:</strong> Saturday, after the Daily Closing is confirmed.</p>
                <p><strong>What:</strong> sales, payments, expenses, estimated operating result, customer debt, closing control, stock, Mining, Equipment Hire and management advice.</p>
                <div className="c03-intel-pillrow"><span className="c03-intel-pill">Owner / Boss</span><span className="c03-intel-pill">Administrators</span><span className="c03-intel-pill">Managers</span><span className="c03-intel-pill">Auditors</span><span className="c03-intel-pill">SMS</span></div>
                <div className="c03-intel-actions">
                  <button type="button" className="c03-intel-primary" disabled={manualSending === "weekly"} onClick={() => sendManualReport("weekly")}>{manualSending === "weekly" ? "Preparing…" : "Send weekly now"}</button>
                  <button type="button" className="c03-intel-secondary" disabled={savingId === weeklyRule?.id || !weeklyRule} onClick={() => weeklyRule && updateRule(weeklyRule, { is_enabled: !Boolean(weeklyRule.is_enabled) })}>{weeklyRule?.is_enabled ? "Turn off" : "Turn on"}</button>
                </div>
              </article>

              <article className="c03-intel-card">
                <span className={`c03-intel-status ${monthlyRule?.is_enabled ? "on" : "off"}`}>{monthlyRule?.is_enabled ? "ACTIVE" : "OFF"}</span>
                <h3>Monthly Business Intelligence</h3>
                <p><strong>When:</strong> the final calendar day, after the final Daily Closing is confirmed.</p>
                <p><strong>What:</strong> month performance, cash control, debt, operating result, operational exceptions and clear management recommendations.</p>
                <div className="c03-intel-pillrow"><span className="c03-intel-pill">Owner / Boss</span><span className="c03-intel-pill">Administrators</span><span className="c03-intel-pill">Managers</span><span className="c03-intel-pill">Auditors</span><span className="c03-intel-pill">SMS</span></div>
                <div className="c03-intel-actions">
                  <button type="button" className="c03-intel-primary" disabled={manualSending === "monthly"} onClick={() => sendManualReport("monthly")}>{manualSending === "monthly" ? "Preparing…" : "Send monthly now"}</button>
                  <button type="button" className="c03-intel-secondary" disabled={savingId === monthlyRule?.id || !monthlyRule} onClick={() => monthlyRule && updateRule(monthlyRule, { is_enabled: !Boolean(monthlyRule.is_enabled) })}>{monthlyRule?.is_enabled ? "Turn off" : "Turn on"}</button>
                </div>
              </article>
            </div>

            <div className="c03-intel-toolbar">
              <div><div className="c03-intel-section-title">Live operational intelligence</div><div className="c03-intel-subtle">These rules watch for exceptions between weekly and monthly reports.</div></div>
              <button type="button" className="c03-intel-secondary" onClick={refreshNow}>Refresh conditions now</button>
            </div>

            {loading ? <div className="c03-intel-subtle">Loading live rules…</div> : (
              <div className="c03-intel-rules">
                {visibleRules.map((rule) => (
                  <article key={rule.id} className="c03-intel-rule">
                    <div className="c03-intel-rule-top">
                      <div><strong>{rule.rule_name}</strong><p>{rule.description || rule.rule_code}</p></div>
                      <label className="c03-intel-check"><input type="checkbox" checked={Boolean(rule.is_enabled)} disabled={savingId === rule.id} onChange={(event) => updateRule(rule, { is_enabled: event.target.checked })} /> Watching</label>
                    </div>
                    <div className="c03-intel-rule-meta">
                      <div><span>Check</span><b>Every 15 minutes</b></div>
                      <div><span>Recipient</span><b>{rule.target_role || "Configured role"}</b></div>
                      <div><span>SMS</span><b>{rule.sms_allowed ? "Allowed" : "In-app only"}</b></div>
                      <div><span>Escalation</span><b>{Number(rule.escalation_minutes || 0) >= 1440 ? `${Math.round(Number(rule.escalation_minutes) / 1440)} day(s)` : Number(rule.escalation_minutes || 0) >= 60 ? `${Math.round(Number(rule.escalation_minutes) / 60)} hour(s)` : `${Number(rule.escalation_minutes || 0)} min`}</b></div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
