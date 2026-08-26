import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const REPORT_CODES = [
  "spare_parts.executive.weekly.admin",
  "spare_parts.executive.weekly.manager",
  "spare_parts.executive.weekly.auditor",
  "spare_parts.executive.monthly.admin",
  "spare_parts.executive.monthly.manager",
  "spare_parts.executive.monthly.auditor",
];

const MONITOR_CODES = [
  "spare_parts.low_stock",
  "spare_parts.overdue_debt",
  "spare_parts.installment_due",
  "spare_parts.installment_overdue",
  "group.executive.management_attention",
  "group.executive.auditor_attention",
];

const ROLE_LABELS = {
  admin: "Boss / Administrators",
  manager: "Managers",
  auditor: "Auditors",
};

const MONITOR_COPY = {
  "spare_parts.low_stock": {
    title: "Spare Parts stock risk",
    when: "When active stock reaches its configured replenishment level",
    why: "Protects sales continuity by highlighting products that need replenishment.",
  },
  "spare_parts.overdue_debt": {
    title: "Customer debt risk",
    when: "When an outstanding customer balance passes its due date",
    why: "Keeps collection pressure visible and identifies balances that need attention.",
  },
  "spare_parts.installment_due": {
    title: "Installment payments due soon",
    when: "When scheduled installment payments are due within the next 3 days",
    why: "Helps the team prepare collection before payments become overdue.",
  },
  "spare_parts.installment_overdue": {
    title: "Installment arrears",
    when: "When an installment schedule item becomes overdue",
    why: "Highlights arrears, outstanding amounts and accounts that need recovery action.",
  },
  "group.executive.management_attention": {
    title: "Management exception watch",
    when: "When important Spare Parts or Installment exceptions remain active",
    why: "Keeps the administrator's in-app notification centre focused on material exceptions.",
  },
  "group.executive.auditor_attention": {
    title: "Audit attention",
    when: "When the configured audit review period passes without a sign-off",
    why: "Keeps the auditor's review queue from going stale.",
  },
};

function reportMeta(code) {
  const parts = String(code || "").split(".");
  return {
    period: parts[2] === "monthly" ? "Monthly" : "Weekly",
    role: parts[3] || "admin",
  };
}

function rolePurpose(role) {
  if (role === "admin") {
    return "Full business picture: sales, gross profit, expenses, cash control, customer debt, stock position, installment portfolio, arrears and management recommendations.";
  }
  if (role === "manager") {
    return "Action-focused view: sales performance, stock pressure, overdue debt, installment collection, cash-control exceptions and the work that needs attention.";
  }
  return "Control-focused view: Daily Closing evidence, cash variances, debt ageing, installment arrears, payment evidence and audit follow-up.";
}

function reportContents(role, period) {
  const prefix = period === "Weekly" ? "Saturday weekly closing" : "month-end closing";
  if (role === "admin") {
    return `${prefix}: complete Spare Parts + Installment business review, trend/change, money received, gross profit, expenses, current debt exposure, low-stock risk, installment arrears and clear management advice.`;
  }
  if (role === "manager") {
    return `${prefix}: sales and margin, products needing replenishment, overdue customer accounts, installment collections, exceptions and specific operational actions.`;
  }
  return `${prefix}: verified closings, shortages/variances, changed-after-close activity, debt exceptions, installment payment/arrears evidence and audit actions.`;
}

export default function AdminIntelligenceSettings() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const reportRules = useMemo(
    () => REPORT_CODES.map((code) => rules.find((rule) => rule.rule_code === code)).filter(Boolean),
    [rules]
  );

  const monitorRules = useMemo(
    () => MONITOR_CODES.map((code) => rules.find((rule) => rule.rule_code === code)).filter(Boolean),
    [rules]
  );

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/notifications/rules");
      setRules(response.data?.rules || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Intelligence controls could not be loaded.");
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
    setRules((current) => current.map((item) => item.id === rule.id ? { ...item, ...changes } : item));
    try {
      await axiosClient.patch(`/notifications/rules/${rule.id}`, changes);
      setNotice("Intelligence setting saved.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The intelligence setting could not be saved.");
      await loadRules();
    } finally {
      setSavingId(null);
    }
  }

  async function runMonitoringNow() {
    setError("");
    setNotice("");
    try {
      await axiosClient.post("/notifications/sync", { workspace_code: "spare_parts" });
      setNotice("Spare Parts and Installment monitoring was refreshed. No SMS was sent by this action.");
      await loadRules();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The monitoring refresh could not be started.");
    }
  }

  return (
    <section className="c03-intelligence-strip">
      <style>{`
        .c03-intelligence-strip{margin:0 0 18px;padding:16px;border:1px solid #dbe3ef;border-radius:18px;background:linear-gradient(135deg,#07182c,#0d2f55);color:#fff;box-shadow:0 14px 34px rgba(7,24,44,.12);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
        .c03-intelligence-strip>div span{display:block;color:#e0ba28;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.c03-intelligence-strip>div strong{display:block;margin-top:4px;font-size:18px}.c03-intelligence-strip>div small{display:block;margin-top:4px;color:rgba(255,255,255,.72);font-size:12px}.c03-intelligence-strip>button{border:1px solid #e0ba28;background:#e0ba28;color:#07182c;border-radius:11px;padding:10px 14px;font-weight:900;cursor:pointer}
        .c03-intelligence-overlay{position:fixed;inset:0;z-index:1500;background:rgba(7,24,44,.60);display:grid;place-items:center;padding:18px}.c03-intelligence-dialog{width:min(960px,100%);max-height:90vh;overflow:auto;background:#fff;border:1px solid #dbe3ef;border-radius:24px;box-shadow:0 32px 90px rgba(7,24,44,.30);padding:24px;color:#10213b}.c03-int-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-bottom:16px;border-bottom:1px solid #e7edf4}.c03-int-head span{display:block;color:#b88910;font-size:11px;font-weight:950;letter-spacing:.1em;text-transform:uppercase}.c03-int-head h2{margin:5px 0;color:#07182c;font-size:28px;letter-spacing:-.04em}.c03-int-head p{margin:0;color:#64748b;font-size:13px;line-height:1.5}.c03-int-close{width:40px;height:40px;border:0;border-radius:12px;background:#f1f5f9;color:#07182c;font-size:24px;cursor:pointer}
        .c03-int-explain{margin:16px 0;padding:13px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.55}.c03-int-explain strong{color:#07182c}.c03-int-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.c03-int-card{border:1px solid #e2e8f0;border-radius:18px;padding:15px;background:linear-gradient(180deg,#fff,#f8fafc)}.c03-int-card h3{margin:0;color:#07182c;font-size:16px}.c03-int-card p{margin:7px 0;color:#64748b;font-size:12px;line-height:1.5}.c03-int-card strong{color:#0b1f35}.c03-int-message{margin:12px 0;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:800}.c03-int-success{background:#ecfdf5;color:#166534}.c03-int-error{background:#fef2f2;color:#991b1b}.c03-int-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin:20px 0 10px}.c03-int-toolbar h3{margin:0;color:#07182c;font-size:16px}.c03-int-toolbar span{color:#64748b;font-size:12px}.c03-int-refresh{border:1px solid #dbe3ef;background:#fff;border-radius:10px;padding:8px 11px;font-weight:900;color:#07182c;cursor:pointer}.c03-int-rules{display:grid;gap:9px}.c03-int-rule{border:1px solid #e2e8f0;border-radius:14px;padding:14px}.c03-int-rule-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.c03-int-rule strong{color:#07182c}.c03-int-rule p{margin:5px 0 0;color:#64748b;font-size:12px;line-height:1.45}.c03-int-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.c03-int-meta div{padding:9px;border-radius:10px;background:#f8fafc;border:1px solid #eef2f7}.c03-int-meta span{display:block;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase}.c03-int-meta b{display:block;margin-top:3px;font-size:12px;color:#10213b}.c03-int-role{display:inline-flex;gap:8px;align-items:center;font-size:12px;font-weight:900}.c03-int-role input{accent-color:#0d2f55}.c03-int-note{margin-top:8px;padding:10px;border-radius:10px;background:#f8fafc;color:#475569;font-size:12px;line-height:1.5}
        @media(max-width:760px){.c03-intelligence-overlay{align-items:end;padding:0}.c03-intelligence-dialog{width:100%;max-height:94vh;border-radius:22px 22px 0 0;padding:18px}.c03-int-grid{grid-template-columns:1fr}.c03-int-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.c03-int-head h2{font-size:24px}}
      `}</style>

      <div>
        <span>Spare Parts + Installment</span>
        <strong>Business Intelligence</strong>
        <small>Weekly and monthly management reports, plus silent exception monitoring.</small>
      </div>
      <button type="button" onClick={() => setOpen(true)}>Open intelligence</button>

      {open ? (
        <div className="c03-intelligence-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="c03-intelligence-dialog" role="dialog" aria-modal="true" aria-label="Chalin 03 business intelligence">
            <div className="c03-int-head"><div><span>Chalin 03 management control</span><h2>Business Intelligence</h2><p>Business reports are sent around Daily Closing — not from the live monitoring timer.</p></div><button type="button" className="c03-int-close" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
            <div className="c03-int-explain"><strong>Silent monitoring:</strong> the system may check conditions in the background, but those checks do not send SMS. <strong>Weekly report:</strong> Saturday after a confirmed Daily Closing. <strong>Monthly report:</strong> after the final Daily Closing of the month.</div>
            {notice ? <div className="c03-int-message c03-int-success">{notice}</div> : null}
            {error ? <div className="c03-int-message c03-int-error">{error}</div> : null}

            <div className="c03-int-grid">
              <article className="c03-int-card"><h3>Weekly • Boss / Administrators</h3><p>Full business picture with the intelligence needed for a management decision.</p><strong>Includes</strong><p>Sales, payments, gross profit, expenses, operating result, customer debt, cash-control exceptions, stock value/risk, installment portfolio, arrears and recommendations.</p></article>
              <article className="c03-int-card"><h3>Weekly • Managers</h3><p>Action-focused operating report.</p><strong>Includes</strong><p>Sales and margin, low stock, overdue debt, installment collections/arrears, cash-control exceptions and the exact operational priorities.</p></article>
              <article className="c03-int-card"><h3>Weekly • Auditors</h3><p>Evidence and control report.</p><strong>Includes</strong><p>Daily Closing verification, shortages/variances, changes after close, debt exceptions, installment payment evidence and audit follow-up.</p></article>
              <article className="c03-int-card"><h3>Monthly • Boss / Administrators</h3><p>Deeper month-end business review.</p><strong>Includes</strong><p>Profitability, sales trend, cash, debt exposure, stock position, installment portfolio, arrears, control exceptions and management advice.</p></article>
              <article className="c03-int-card"><h3>Monthly • Managers</h3><p>Operational month-end review.</p><strong>Includes</strong><p>Performance, margin pressure, stock needs, collection work, installment recovery and priorities for the next month.</p></article>
              <article className="c03-int-card"><h3>Monthly • Auditors</h3><p>Month-end assurance review.</p><strong>Includes</strong><p>Closing controls, variance exposure, unverified records, debt/payment exceptions, installment arrears and outstanding audit actions.</p></article>
            </div>

            <div className="c03-int-toolbar"><div><h3>Report delivery controls</h3><span>Each audience can be turned off independently. These are the messages that may use SMS credits.</span></div></div>
            <div className="c03-int-rules">
              {reportRules.length === 0 && !loading ? <div className="c03-int-note">Report controls are not loaded yet.</div> : null}
              {reportRules.map((rule) => { const meta = reportMeta(rule.rule_code); return <div className="c03-int-rule" key={rule.id}><div className="c03-int-rule-top"><div><strong>{meta.period} • {ROLE_LABELS[meta.role] || meta.role}</strong><p>{reportContents(meta.role, meta.period)}</p></div><label className="c03-int-role"><input type="checkbox" checked={Boolean(rule.is_enabled)} disabled={savingId === rule.id} onChange={(event) => updateRule(rule, { is_enabled: event.target.checked })} /> Receive this report</label></div><div className="c03-int-meta"><div><span>Automatic time</span><b>{meta.period === "Weekly" ? "Saturday after closing" : "Final day after closing"}</b></div><div><span>SMS</span><b>{Number(rule.sms_allowed) ? "Allowed" : "Off"}</b></div><div><span>Audience</span><b>{ROLE_LABELS[meta.role] || meta.role}</b></div><div><span>Status</span><b>{Number(rule.is_enabled) ? "Enabled" : "Disabled"}</b></div></div></div>; })}
            </div>

            <div className="c03-int-toolbar"><div><h3>Silent exception monitoring</h3><span>No SMS. These create in-app attention only.</span></div><button className="c03-int-refresh" type="button" onClick={runMonitoringNow}>Check now</button></div>
            <div className="c03-int-rules">
              {monitorRules.map((rule) => { const copy = MONITOR_COPY[rule.rule_code] || {}; return <div className="c03-int-rule" key={rule.id}><div className="c03-int-rule-top"><div><strong>{copy.title || rule.rule_name}</strong><p>{copy.when}</p><div className="c03-int-note">{copy.why}</div></div><label className="c03-int-role"><input type="checkbox" checked={Boolean(rule.is_enabled)} disabled={savingId === rule.id} onChange={(event) => updateRule(rule, { is_enabled: event.target.checked, sms_allowed: false })} /> Watch</label></div></div>; })}
            </div>

            <div className="c03-int-note" style={{ marginTop: 18 }}><strong>What this intelligence is meant to answer:</strong> Are we making money on Spare Parts sales? Where is customer cash stuck? Which stock will affect sales? How much money is tied up in installment finance? Which installment accounts are in arrears? Did the cash-control process stay clean? What should each role do next?</div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
