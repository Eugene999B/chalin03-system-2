import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

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

const money = (value) => {
  const n = Number(value || 0);
  return `GHS ${Number.isFinite(n) ? n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
};

function rangeFor(type) {
  const now = new Date();
  if (type === "weekly") {
    const from = new Date(now);
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
    const to = new Date(from);
    to.setDate(to.getDate() + 6);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    to: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  };
}

function buildRoleMessage(type, role, summary) {
  const group = summary?.group || {};
  const spare = summary?.spare_parts || {};
  const mining = summary?.mining || {};
  const hire = summary?.hire || {};
  const cash = summary?.cash_control || {};
  const title = type === "weekly" ? "Chalin 03 Weekly Business Intelligence" : "Chalin 03 Monthly Business Intelligence";

  if (role === "auditor") {
    return `${title}. Audit focus: ${cash.closing_count || 0} Daily Closing record(s); ${cash.awaiting_verification_count || 0} awaiting verification; ${cash.changed_after_close_count || 0} changed after close; ${cash.variance_count || 0} variance record(s); variance exposure ${money(cash.absolute_variance)}. Customer debt ${money(spare.debt_balance)}. Serious/high Mining incidents ${mining.serious_open_incidents || 0}. Review supporting evidence, exceptions, approvals and sign-offs.`;
  }
  if (role === "manager") {
    return `${title}. Sales ${money(spare.sales_total)}, payments received ${money(spare.sales_received)}, expenses ${money(spare.expenses_total)}, estimated operating result ${money(spare.estimated_store_margin)}, customer debt ${money(spare.debt_balance)}, low stock ${spare.low_stock_count || 0}, Mining serious/high incidents ${mining.serious_open_incidents || 0}, Equipment Hire balance ${money(hire.invoice_balance)}. Priority: ${cash.changed_after_close_count || 0} closing record(s) changed after close and ${cash.awaiting_verification_count || 0} awaiting verification.`;
  }
  return `${title}. Sales ${money(group.sales_total)}, payments received ${money(group.sales_received)}, expenses ${money(group.expenses_total)}, estimated operating result ${money(group.estimated_store_margin)}, customer debt ${money(spare.debt_balance)}. Daily Closing: ${cash.closing_count || 0} record(s), ${cash.verified_count || 0} verified, ${cash.awaiting_verification_count || 0} awaiting verification, ${cash.variance_count || 0} variance record(s), ${cash.changed_after_close_count || 0} changed after close. Low stock ${spare.low_stock_count || 0}. Mining serious/high incidents ${mining.serious_open_incidents || 0}. Equipment Hire balance ${money(hire.invoice_balance)}.`;
}

export default function AdminIntelligenceSettings() {
  const { user, canAccessAllBranches } = useAuth();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [sending, setSending] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const visibleRules = useMemo(() => rules.filter((rule) => IMPORTANT_RULES.has(rule.rule_code)), [rules]);
  const weeklyRule = rules.find((rule) => rule.rule_code === "group.executive.weekly_business_intelligence");
  const monthlyRule = rules.find((rule) => rule.rule_code === "group.executive.monthly_business_intelligence");

  async function loadRules() {
    setLoading(true); setError("");
    try {
      const response = await axiosClient.get("/notifications/rules");
      setRules(response.data?.rules || []);
    } catch (e) {
      setError(e.response?.data?.message || "Intelligence controls could not be loaded.");
    } finally { setLoading(false); }
  }

  useEffect(() => { if (open) loadRules(); }, [open]);

  async function updateRule(rule, changes) {
    setSavingId(rule.id); setError(""); setNotice("");
    try {
      const response = await axiosClient.patch(`/notifications/rules/${rule.id}`, changes);
      setRules((current) => current.map((item) => item.id === rule.id ? { ...item, ...(response.data?.rule || changes) } : item));
      setNotice("Setting saved.");
    } catch (e) {
      setError(e.response?.data?.message || "The setting could not be saved.");
    } finally { setSavingId(null); }
  }

  async function refreshConditions() {
    setError(""); setNotice("");
    try {
      await axiosClient.post("/notifications/sync", { workspace_code: "group" });
      setNotice("Condition intelligence checked. No weekly or monthly report was triggered by this action.");
      await loadRules();
    } catch (e) {
      setError(e.response?.data?.message || "The intelligence check could not be started.");
    }
  }

  async function sendReportNow(type) {
    setSending(type); setError(""); setNotice("");
    try {
      const range = rangeFor(type);
      const [{ data: summaryData }, { data: userData }, { data: settingsData }] = await Promise.all([
        axiosClient.get("/group-executive/summary", { params: { ...range, branch_scope: canAccessAllBranches ? "all" : "selected" }, timeout: 120000 }),
        axiosClient.get("/users"),
        axiosClient.get("/settings"),
      ]);

      const summary = summaryData?.summary || {};
      const users = userData?.users || [];
      const settings = settingsData?.settings || {};
      const destinations = new Map();

      for (const role of ["admin", "manager", "auditor"]) {
        const message = buildRoleMessage(type, role, summary);
        for (const account of users.filter((item) => item.is_active && item.role === role && item.phone)) {
          const phone = String(account.phone).trim();
          if (!destinations.has(phone)) destinations.set(phone, { phone, message, role });
        }
      }

      const ownerPhone = String(settings.owner_phone || "").trim();
      if (ownerPhone && !destinations.has(ownerPhone)) {
        destinations.set(ownerPhone, { phone: ownerPhone, message: buildRoleMessage(type, "admin", summary), role: "owner" });
      }

      if (destinations.size === 0) throw new Error("No active recipient with a configured phone number was found.");

      let sent = 0;
      const failures = [];
      for (const recipient of destinations.values()) {
        try {
          await axiosClient.post("/sms/test", { phone: recipient.phone, message: recipient.message });
          sent += 1;
        } catch (e) {
          failures.push(`${recipient.role}: ${e.response?.data?.message || e.message || "SMS failed"}`);
        }
      }

      await axiosClient.post("/notifications/manual", {
        workspace_code: "group",
        target_role: "admin",
        target_permission: "notifications.view",
        category: "executive",
        severity: "medium",
        title: type === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence",
        message: buildRoleMessage(type, "admin", summary),
        action_path: "/group-executive-control",
        source_reference: `manual_${type}_business_intelligence`,
      });

      setNotice(`${type === "weekly" ? "Weekly" : "Monthly"} report sent now to ${sent} SMS recipient(s) and recorded in the notification centre${failures.length ? `. ${failures.length} recipient(s) failed.` : "."}`);
      if (failures.length) setError(failures.join(" | "));
    } catch (e) {
      setError(e.response?.data?.message || e.message || `The ${type} report could not be sent.`);
    } finally { setSending(""); }
  }

  return (
    <>
      <section className="c03-intelligence-strip">
        <div><span>Management intelligence</span><strong>Business Intelligence & Alerts</strong><small>Closing reports, management advice and live exception monitoring.</small></div>
        <button type="button" onClick={() => setOpen(true)}>Open intelligence</button>
      </section>

      {open ? (
        <div className="c03-intelligence-overlay" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="c03-intelligence-dialog" role="dialog" aria-modal="true" aria-label="Chalin 03 business intelligence">
            <style>{`
              .c03-intelligence-overlay{position:fixed;inset:0;z-index:1500;background:rgba(7,24,44,.60);display:grid;place-items:center;padding:18px}
              .c03-intelligence-dialog{width:min(960px,100%);max-height:90vh;overflow:auto;background:#fff;border:1px solid #dbe3ef;border-radius:24px;box-shadow:0 32px 90px rgba(7,24,44,.30);padding:24px;color:#10213b}
              .c03-int-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-bottom:16px;border-bottom:1px solid #e7edf4}.c03-int-head span{display:block;color:#b88910;font-size:11px;font-weight:950;letter-spacing:.1em;text-transform:uppercase}.c03-int-head h2{margin:5px 0;color:#07182c;font-size:28px;letter-spacing:-.04em}.c03-int-head p{margin:0;color:#64748b;font-size:13px;line-height:1.5}.c03-int-close{width:40px;height:40px;border:0;border-radius:12px;background:#f1f5f9;color:#07182c;font-size:24px;cursor:pointer}
              .c03-int-explain{margin:16px 0;padding:13px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.55}.c03-int-explain strong{color:#07182c}
              .c03-int-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.c03-int-card{border:1px solid #e2e8f0;border-radius:18px;padding:16px;background:linear-gradient(180deg,#fff,#f8fafc)}.c03-int-card h3{margin:0;color:#07182c;font-size:17px}.c03-int-card p{margin:6px 0;color:#64748b;font-size:12px;line-height:1.5}.c03-int-status{display:inline-flex;border-radius:999px;padding:5px 9px;margin-bottom:9px;font-size:11px;font-weight:950}.c03-int-on{background:#ecfdf5;color:#166534}.c03-int-off{background:#fef2f2;color:#991b1b}.c03-int-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.c03-int-pill{border-radius:999px;padding:5px 9px;background:#eef4fb;color:#23486d;font-size:11px;font-weight:900}.c03-int-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.c03-int-actions button{border-radius:11px;padding:9px 12px;font-weight:900;cursor:pointer}.c03-int-send{border:1px solid #07182c;background:#07182c;color:white}.c03-int-toggle{border:1px solid #dbe3ef;background:white;color:#07182c}.c03-int-actions button:disabled{opacity:.55;cursor:not-allowed}
              .c03-int-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0 10px}.c03-int-toolbar h3{margin:0;color:#07182c;font-size:15px}.c03-int-toolbar span{color:#64748b;font-size:12px}.c03-int-refresh{border:1px solid #dbe3ef;background:#fff;border-radius:10px;padding:8px 11px;font-weight:900;color:#07182c;cursor:pointer}
              .c03-int-rules{display:grid;gap:9px}.c03-int-rule{border:1px solid #e2e8f0;border-radius:14px;padding:14px}.c03-int-rule-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.c03-int-rule strong{color:#07182c}.c03-int-rule p{margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.45}.c03-int-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.c03-int-meta div{padding:9px;border-radius:10px;background:#f8fafc;border:1px solid #eef2f7}.c03-int-meta span{display:block;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase}.c03-int-meta b{display:block;margin-top:3px;font-size:12px;color:#10213b}.c03-int-message{margin:12px 0;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:800}.c03-int-success{background:#ecfdf5;color:#166534}.c03-int-error{background:#fef2f2;color:#991b1b}
              @media(max-width:720px){.c03-intelligence-overlay{align-items:end;padding:0}.c03-intelligence-dialog{width:100%;max-height:94vh;border-radius:22px 22px 0 0;padding:18px}.c03-int-grid{grid-template-columns:1fr}.c03-int-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.c03-int-actions>*{width:100%}.c03-int-head h2{font-size:24px}}
            `}</style>

            <div className="c03-int-head"><div><span>Chalin 03 management control</span><h2>Business Intelligence</h2><p>Reports are sent around Daily Closing, not on the live monitoring timer.</p></div><button type="button" className="c03-int-close" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
            <div className="c03-int-explain"><strong>Live condition monitor:</strong> checks every 15 minutes and only looks for exceptions. It does not send the weekly/monthly report every 15 minutes. <strong>Business reports:</strong> weekly after Saturday Daily Closing; monthly after the final Daily Closing of the month. The administrator can also send either report immediately.</div>
            {notice ? <div className="c03-int-message c03-int-success">{notice}</div> : null}
            {error ? <div className="c03-int-message c03-int-error">{error}</div> : null}

            <div className="c03-int-grid">
              <article className="c03-int-card">
                <span className={`c03-int-status ${weeklyRule?.is_enabled ? "c03-int-on" : "c03-int-off"}`}>{weeklyRule?.is_enabled ? "ACTIVE" : "OFF"}</span>
                <h3>Weekly Business Intelligence</h3>
                <p><strong>Schedule:</strong> every Saturday after the Daily Closing is confirmed.</p>
                <p><strong>Includes:</strong> sales, payments, expenses, estimated operating result, customer debt, closing control, low stock, Mining, Equipment Hire and management advice.</p>
                <div className="c03-int-pills"><span className="c03-int-pill">Boss / Owner</span><span className="c03-int-pill">Admins</span><span className="c03-int-pill">Managers</span><span className="c03-int-pill">Auditors</span><span className="c03-int-pill">SMS</span></div>
                <div className="c03-int-actions"><button type="button" className="c03-int-send" disabled={sending === "weekly"} onClick={() => sendReportNow("weekly")}>{sending === "weekly" ? "Sending…" : "Send weekly now"}</button><button type="button" className="c03-int-toggle" disabled={!weeklyRule || savingId === weeklyRule?.id} onClick={() => weeklyRule && updateRule(weeklyRule, { is_enabled: !Boolean(weeklyRule.is_enabled) })}>{weeklyRule?.is_enabled ? "Turn off" : "Turn on"}</button></div>
              </article>

              <article className="c03-int-card">
                <span className={`c03-int-status ${monthlyRule?.is_enabled ? "c03-int-on" : "c03-int-off"}`}>{monthlyRule?.is_enabled ? "ACTIVE" : "OFF"}</span>
                <h3>Monthly Business Intelligence</h3>
                <p><strong>Schedule:</strong> last calendar day after the final Daily Closing is confirmed.</p>
                <p><strong>Includes:</strong> monthly performance, cash control, debt, estimated operating result, operational exceptions and clear management recommendations.</p>
                <div className="c03-int-pills"><span className="c03-int-pill">Boss / Owner</span><span className="c03-int-pill">Admins</span><span className="c03-int-pill">Managers</span><span className="c03-int-pill">Auditors</span><span className="c03-int-pill">SMS</span></div>
                <div className="c03-int-actions"><button type="button" className="c03-int-send" disabled={sending === "monthly"} onClick={() => sendReportNow("monthly")}>{sending === "monthly" ? "Sending…" : "Send monthly now"}</button><button type="button" className="c03-int-toggle" disabled={!monthlyRule || savingId === monthlyRule?.id} onClick={() => monthlyRule && updateRule(monthlyRule, { is_enabled: !Boolean(monthlyRule.is_enabled) })}>{monthlyRule?.is_enabled ? "Turn off" : "Turn on"}</button></div>
              </article>
            </div>

            <div className="c03-int-toolbar"><div><h3>Live operational exceptions</h3><span>These continue checking between the scheduled reports.</span></div><button type="button" className="c03-int-refresh" onClick={refreshConditions}>Check conditions now</button></div>
            {loading ? <div className="c03-int-message">Loading live intelligence…</div> : <div className="c03-int-rules">{visibleRules.map((rule) => <article key={rule.id} className="c03-int-rule"><div className="c03-int-rule-top"><div><strong>{rule.rule_name}</strong><p>{rule.description || rule.rule_code}</p></div><label className="c03-int-message" style={{margin:0,padding:"6px 8px",background:rule.is_enabled ? "#ecfdf5" : "#f8fafc",color:rule.is_enabled ? "#166534" : "#64748b"}}><input type="checkbox" checked={Boolean(rule.is_enabled)} disabled={savingId === rule.id} onChange={(event) => updateRule(rule,{is_enabled:event.target.checked})}/> Watching</label></div><div className="c03-int-meta"><div><span>Check</span><b>Every 15 min</b></div><div><span>Recipient</span><b>{rule.target_role || "Configured role"}</b></div><div><span>SMS</span><b>{rule.sms_allowed ? "Allowed" : "In-app"}</b></div><div><span>Escalation</span><b>{Number(rule.escalation_minutes || 0) >= 1440 ? `${Math.round(Number(rule.escalation_minutes)/1440)} day(s)` : Number(rule.escalation_minutes || 0) >= 60 ? `${Math.round(Number(rule.escalation_minutes)/60)} hour(s)` : `${Number(rule.escalation_minutes || 0)} min`}</b></div></div></article>)}</div>}
          </section>
        </div>
      ) : null}
    </>
  );
}
