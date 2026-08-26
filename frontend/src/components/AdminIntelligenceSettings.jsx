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
const ROLE_LABELS = { admin: "Boss / Administrators", manager: "Managers", auditor: "Auditors" };
const MONITOR_COPY = {
  "spare_parts.low_stock": ["Spare Parts stock risk", "When active stock reaches its configured replenishment level", "Protects sales continuity by highlighting products that need replenishment."],
  "spare_parts.overdue_debt": ["Customer debt risk", "When an outstanding customer balance passes its due date", "Keeps collection pressure visible without spending SMS credit."],
  "spare_parts.installment_due": ["Installment payments due soon", "When scheduled installment payments are due within the next 3 days", "Helps the team prepare collection before payments become overdue."],
  "spare_parts.installment_overdue": ["Installment arrears", "When an installment schedule item becomes overdue", "Highlights arrears and recovery work that needs attention."],
  "group.executive.management_attention": ["Management exception watch", "When important Spare Parts or Installment exceptions remain active", "Keeps the administrator notification centre focused on material exceptions."],
  "group.executive.auditor_attention": ["Audit attention", "When the configured audit review period passes without a sign-off", "Keeps the auditor review queue from going stale."],
};

function reportMeta(code) { const parts = String(code || "").split("."); return { period: parts[2] === "monthly" ? "Monthly" : "Weekly", role: parts[3] || "admin" }; }
function money(value) { const n = Number(value || 0); return `GHS ${Number.isFinite(n) ? n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`; }
function rangeFor(type) { const now = new Date(); if (type === "weekly") { const end = new Date(now); const start = new Date(end); start.setDate(end.getDate() - ((end.getDay() + 6) % 7)); return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }; } return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }; }

function rolePurpose(role) {
  if (role === "admin") return "Full business picture: sales, gross profit, expenses, cash control, customer debt, stock position, installment portfolio, arrears and management recommendations.";
  if (role === "manager") return "Action-focused view: sales performance, stock pressure, overdue debt, installment collection, cash-control exceptions and the work that needs attention.";
  return "Control-focused view: Daily Closing evidence, cash variances, debt ageing, installment arrears, payment evidence and audit follow-up.";
}
function reportContents(role, period) {
  const prefix = period === "Weekly" ? "Saturday weekly closing" : "month-end closing";
  if (role === "admin") return `${prefix}: complete Spare Parts + Installment business review, profitability, money received, debt exposure, stock risk, installment arrears and management advice.`;
  if (role === "manager") return `${prefix}: sales and margin, replenishment needs, overdue customers, installment collections and concrete operational priorities.`;
  return `${prefix}: verified closings, shortages/variances, changed-after-close activity, debt exceptions, installment payment evidence and audit actions.`;
}

function buildManualMessage(type, role, summary, installmentAccounts) {
  const spare = summary?.spare_parts || {};
  const cash = summary?.cash_control || {};
  const accounts = Array.isArray(installmentAccounts) ? installmentAccounts : [];
  const installmentOutstanding = accounts.reduce((sum, item) => sum + Number(item.outstanding_balance || 0), 0);
  const installmentOverdue = accounts.reduce((sum, item) => sum + Number(item.overdue_amount || 0), 0);
  const installmentPaid = accounts.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
  const installmentArrears = accounts.filter((item) => Number(item.overdue_amount || 0) > 0.01).length;
  const title = type === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence";
  if (role === "auditor") return `Chalin 03 ${title}. Daily Closings: ${cash.closing_count || 0}; verified ${cash.verified_count || 0}; awaiting verification ${cash.awaiting_verification_count || 0}; variance exposure ${money(cash.absolute_variance)}; changed after close ${cash.changed_after_close_count || 0}. Customer debt ${money(spare.debt_balance)}. Installment portfolio: ${accounts.length} account(s), paid ${money(installmentPaid)}, outstanding ${money(installmentOutstanding)}, overdue ${money(installmentOverdue)} across ${installmentArrears} account(s). Review evidence, payment allocations and all outstanding control exceptions.`;
  if (role === "manager") return `Chalin 03 ${title}. Sales ${money(spare.sales_total)}, received ${money(spare.sales_received)}, expenses ${money(spare.expenses_total)}, operating result ${money(spare.estimated_store_margin)}. Low-stock products ${spare.low_stock_count || 0}. Customer debt ${money(spare.debt_balance)}. Installment collections ${money(installmentPaid)}, outstanding ${money(installmentOutstanding)}, overdue ${money(installmentOverdue)}. Priority: replenish risk stock, collect ageing debt and act on installment arrears.`;
  return `Chalin 03 ${title}. Sales ${money(spare.sales_total)}, received ${money(spare.sales_received)}, expenses ${money(spare.expenses_total)}, estimated operating result ${money(spare.estimated_store_margin)}. Customer debt ${money(spare.debt_balance)}. Spare Parts low-stock ${spare.low_stock_count || 0}; stock review required where material. Installment accounts ${accounts.length}; collections ${money(installmentPaid)}; outstanding ${money(installmentOutstanding)}; overdue ${money(installmentOverdue)} across ${installmentArrears} account(s). Daily Closing variance exposure ${money(cash.absolute_variance)}. Management should review debt, stock, installment arrears and cash exceptions.`;
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

  const reportRules = useMemo(() => REPORT_CODES.map((code) => rules.find((rule) => rule.rule_code === code)).filter(Boolean), [rules]);
  const monitorRules = useMemo(() => MONITOR_CODES.map((code) => rules.find((rule) => rule.rule_code === code)).filter(Boolean), [rules]);

  async function loadRules() {
    setLoading(true); setError("");
    try { const response = await axiosClient.get("/notifications/rules"); setRules(response.data?.rules || []); }
    catch (requestError) { setError(requestError.response?.data?.message || "Intelligence controls could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (open) loadRules(); }, [open]);

  async function updateRule(rule, changes) {
    setSavingId(rule.id); setError(""); setNotice("");
    setRules((current) => current.map((item) => item.id === rule.id ? { ...item, ...changes } : item));
    try { await axiosClient.patch(`/notifications/rules/${rule.id}`, changes); setNotice("Intelligence setting saved."); }
    catch (requestError) { setError(requestError.response?.data?.message || "The intelligence setting could not be saved."); await loadRules(); }
    finally { setSavingId(null); }
  }

  async function runMonitoringNow() {
    setError(""); setNotice("");
    try { await axiosClient.post("/notifications/sync", { workspace_code: "spare_parts" }); setNotice("Spare Parts and Installment monitoring was refreshed. No SMS was sent."); await loadRules(); }
    catch (requestError) { setError(requestError.response?.data?.message || "The monitoring refresh could not be started."); }
  }

  async function sendReportNow(type) {
    setSending(type); setError(""); setNotice("");
    try {
      const range = rangeFor(type);
      const [summaryResponse, accountsResponse, usersResponse] = await Promise.all([
        axiosClient.get("/group-executive/summary", { params: { ...range, branch_scope: canAccessAllBranches ? "all" : "selected" }, timeout: 120000 }),
        axiosClient.get("/equipment-catalogue/sales/finance-lifecycle/accounts"),
        axiosClient.get("/users"),
      ]);
      const summary = summaryResponse.data?.summary || {};
      const accounts = accountsResponse.data?.accounts || [];
      const users = usersResponse.data?.users || [];
      const byRole = { admin: [], manager: [], auditor: [] };
      const roleRules = reportRules.filter((rule) => reportMeta(rule.rule_code).period.toLowerCase() === type);
      let sent = 0;
      const failures = [];
      for (const role of Object.keys(byRole)) {
        const rule = roleRules.find((item) => reportMeta(item.rule_code).role === role);
        if (!rule || !Number(rule.is_enabled) || !Number(rule.sms_allowed)) continue;
        const message = buildManualMessage(type, role, summary, accounts);
        for (const account of users.filter((item) => item.is_active && item.role === role && String(item.phone || "").trim())) {
          try { await axiosClient.post("/sms/test", { phone: String(account.phone).trim(), message }); sent += 1; }
          catch (requestError) { failures.push(`${ROLE_LABELS[role]}: ${requestError.response?.data?.message || requestError.message || "SMS failed"}`); }
        }
        byRole[role].push(message);
      }
      if (!sent) throw new Error("No enabled report audience with a configured phone number was available.");
      await axiosClient.post("/notifications/manual", { workspace_code: "spare_parts", target_role: "admin", target_permission: "notifications.view", category: "executive_report", severity: "high", title: type === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence", message: buildManualMessage(type, "admin", summary, accounts), action_path: "/group-executive-control", source_reference: `manual_business_report:${type}` });
      setNotice(`${type === "weekly" ? "Weekly" : "Monthly"} intelligence sent immediately to ${sent} enabled recipient(s).${failures.length ? ` ${failures.length} recipient(s) failed.` : ""}`);
      if (failures.length) setError(failures.join(" | "));
    } catch (requestError) { setError(requestError.response?.data?.message || requestError.message || `The ${type} report could not be sent.`); }
    finally { setSending(""); }
  }

  return (
    <section className="c03-intelligence-strip">
      <style>{`.c03-intelligence-strip{margin:0 0 18px;padding:16px;border:1px solid #dbe3ef;border-radius:18px;background:linear-gradient(135deg,#07182c,#0d2f55);color:#fff;box-shadow:0 14px 34px rgba(7,24,44,.12);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.c03-intelligence-strip>div span{display:block;color:#e0ba28;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.c03-intelligence-strip>div strong{display:block;margin-top:4px;font-size:18px}.c03-intelligence-strip>div small{display:block;margin-top:4px;color:rgba(255,255,255,.72);font-size:12px}.c03-intelligence-strip>button{border:1px solid #e0ba28;background:#e0ba28;color:#07182c;border-radius:11px;padding:10px 14px;font-weight:900;cursor:pointer}.c03-intelligence-overlay{position:fixed;inset:0;z-index:1500;background:rgba(7,24,44,.60);display:grid;place-items:center;padding:18px}.c03-intelligence-dialog{width:min(960px,100%);max-height:90vh;overflow:auto;background:#fff;border:1px solid #dbe3ef;border-radius:24px;box-shadow:0 32px 90px rgba(7,24,44,.30);padding:24px;color:#10213b}.c03-int-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding-bottom:16px;border-bottom:1px solid #e7edf4}.c03-int-head span{display:block;color:#b88910;font-size:11px;font-weight:950;letter-spacing:.1em;text-transform:uppercase}.c03-int-head h2{margin:5px 0;color:#07182c;font-size:28px;letter-spacing:-.04em}.c03-int-head p{margin:0;color:#64748b;font-size:13px;line-height:1.5}.c03-int-close{width:40px;height:40px;border:0;border-radius:12px;background:#f1f5f9;color:#07182c;font-size:24px;cursor:pointer}.c03-int-explain{margin:16px 0;padding:13px 14px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.55}.c03-int-explain strong{color:#07182c}.c03-int-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.c03-int-card{border:1px solid #e2e8f0;border-radius:18px;padding:15px;background:linear-gradient(180deg,#fff,#f8fafc)}.c03-int-card h3{margin:0;color:#07182c;font-size:16px}.c03-int-card p{margin:7px 0;color:#64748b;font-size:12px;line-height:1.5}.c03-int-card strong{color:#0b1f35}.c03-int-send{margin-top:10px;border:1px solid #07182c;background:#07182c;color:#fff;border-radius:10px;padding:9px 11px;font-weight:900;cursor:pointer}.c03-int-send:disabled{opacity:.55;cursor:not-allowed}.c03-int-message{margin:12px 0;padding:10px 12px;border-radius:10px;font-size:12px;font-weight:800}.c03-int-success{background:#ecfdf5;color:#166534}.c03-int-error{background:#fef2f2;color:#991b1b}.c03-int-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin:20px 0 10px}.c03-int-toolbar h3{margin:0;color:#07182c;font-size:16px}.c03-int-toolbar span{color:#64748b;font-size:12px}.c03-int-refresh{border:1px solid #dbe3ef;background:#fff;border-radius:10px;padding:8px 11px;font-weight:900;color:#07182c;cursor:pointer}.c03-int-rules{display:grid;gap:9px}.c03-int-rule{border:1px solid #e2e8f0;border-radius:14px;padding:14px}.c03-int-rule-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.c03-int-rule strong{color:#07182c}.c03-int-rule p{margin:5px 0 0;color:#64748b;font-size:12px;line-height:1.45}.c03-int-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.c03-int-meta div{padding:9px;border-radius:10px;background:#f8fafc;border:1px solid #eef2f7}.c03-int-meta span{display:block;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase}.c03-int-meta b{display:block;margin-top:3px;font-size:12px;color:#10213b}.c03-int-role{display:inline-flex;gap:8px;align-items:center;font-size:12px;font-weight:900}.c03-int-note{margin-top:8px;padding:10px;border-radius:10px;background:#f8fafc;color:#475569;font-size:12px;line-height:1.5}@media(max-width:760px){.c03-intelligence-overlay{align-items:end;padding:0}.c03-intelligence-dialog{width:100%;max-height:94vh;border-radius:22px 22px 0 0;padding:18px}.c03-int-grid{grid-template-columns:1fr}.c03-int-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.c03-int-send{width:100%}.c03-int-head h2{font-size:24px}}`}</style>
      <div><span>Spare Parts + Installment</span><strong>Business Intelligence</strong><small>Weekly and monthly management reports, plus silent exception monitoring.</small></div>
      <button type="button" onClick={() => setOpen(true)}>Open intelligence</button>
      {open ? <div className="c03-intelligence-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="c03-intelligence-dialog" role="dialog" aria-modal="true" aria-label="Chalin 03 business intelligence">
          <div className="c03-int-head"><div><span>Chalin 03 management control</span><h2>Business Intelligence</h2><p>Business reports are sent around Daily Closing — not from the live monitoring timer.</p></div><button type="button" className="c03-int-close" onClick={() => setOpen(false)} aria-label="Close">×</button></div>
          <div className="c03-int-explain"><strong>Silent monitoring:</strong> background checks do not send SMS. <strong>Weekly:</strong> Saturday after a confirmed Daily Closing. <strong>Monthly:</strong> after the final Daily Closing. <strong>Manual send:</strong> the administrator can send a current report immediately.</div>
          {notice ? <div className="c03-int-message c03-int-success">{notice}</div> : null}{error ? <div className="c03-int-message c03-int-error">{error}</div> : null}
          <div className="c03-int-grid">
            <article className="c03-int-card"><h3>Weekly • Boss / Administrators</h3><p>{rolePurpose("admin")}</p><strong>Message focus</strong><p>{reportContents("admin","Weekly")}</p><button className="c03-int-send" type="button" disabled={sending==="weekly"} onClick={() => sendReportNow("weekly")}>{sending==="weekly"?"Sending…":"Send weekly now"}</button></article>
            <article className="c03-int-card"><h3>Weekly • Managers</h3><p>{rolePurpose("manager")}</p><strong>Message focus</strong><p>{reportContents("manager","Weekly")}</p></article>
            <article className="c03-int-card"><h3>Weekly • Auditors</h3><p>{rolePurpose("auditor")}</p><strong>Message focus</strong><p>{reportContents("auditor","Weekly")}</p></article>
            <article className="c03-int-card"><h3>Monthly • Boss / Administrators</h3><p>{rolePurpose("admin")}</p><strong>Message focus</strong><p>{reportContents("admin","Monthly")}</p><button className="c03-int-send" type="button" disabled={sending==="monthly"} onClick={() => sendReportNow("monthly")}>{sending==="monthly"?"Sending…":"Send monthly now"}</button></article>
            <article className="c03-int-card"><h3>Monthly • Managers</h3><p>{rolePurpose("manager")}</p><strong>Message focus</strong><p>{reportContents("manager","Monthly")}</p></article>
            <article className="c03-int-card"><h3>Monthly • Auditors</h3><p>{rolePurpose("auditor")}</p><strong>Message focus</strong><p>{reportContents("auditor","Monthly")}</p></article>
          </div>
          <div className="c03-int-toolbar"><div><h3>Report delivery controls</h3><span>Each audience can be turned off independently. SMS is used only for these reports.</span></div></div>
          <div className="c03-int-rules">{reportRules.length===0&&!loading?<div className="c03-int-note">Report controls are not loaded yet.</div>:null}{reportRules.map((rule)=>{const meta=reportMeta(rule.rule_code);return <div className="c03-int-rule" key={rule.id}><div className="c03-int-rule-top"><div><strong>{meta.period} • {ROLE_LABELS[meta.role]||meta.role}</strong><p>{reportContents(meta.role,meta.period)}</p></div><label className="c03-int-role"><input type="checkbox" checked={Boolean(rule.is_enabled)} disabled={savingId===rule.id} onChange={(event)=>updateRule(rule,{is_enabled:event.target.checked})}/>Receive this report</label></div><div className="c03-int-meta"><div><span>Automatic time</span><b>{meta.period==="Weekly"?"Saturday after closing":"Final day after closing"}</b></div><div><span>SMS</span><b>{Number(rule.sms_allowed)?"Allowed":"Off"}</b></div><div><span>Audience</span><b>{ROLE_LABELS[meta.role]||meta.role}</b></div><div><span>Status</span><b>{Number(rule.is_enabled)?"Enabled":"Disabled"}</b></div></div></div>})}</div>
          <div className="c03-int-toolbar"><div><h3>Silent exception monitoring</h3><span>No SMS. These create in-app attention only.</span></div><button className="c03-int-refresh" type="button" onClick={runMonitoringNow}>Check now</button></div>
          <div className="c03-int-rules">{monitorRules.map((rule)=>{const copy=MONITOR_COPY[rule.rule_code]||[];return <div className="c03-int-rule" key={rule.id}><div className="c03-int-rule-top"><div><strong>{copy[0]||rule.rule_name}</strong><p>{copy[1]}</p><div className="c03-int-note">{copy[2]}</div></div><label className="c03-int-role"><input type="checkbox" checked={Boolean(rule.is_enabled)} disabled={savingId===rule.id} onChange={(event)=>updateRule(rule,{is_enabled:event.target.checked,sms_allowed:false})}/>Watch</label></div></div>})}</div>
          <div className="c03-int-note" style={{marginTop:18}}><strong>What this intelligence answers:</strong> Are we selling profitably? Where is customer cash stuck? Which Spare Parts items threaten sales? How much is tied up in Installment Finance? Which accounts are in arrears? Did the cash-control process stay clean? What should each role do next?</div>
          <div style={{marginTop:12,color:"#64748b",fontSize:11}}>Signed in as {user?.full_name||user?.username||"Administrator"}.</div>
        </section>
      </div>:null}
    </section>
  );
}
