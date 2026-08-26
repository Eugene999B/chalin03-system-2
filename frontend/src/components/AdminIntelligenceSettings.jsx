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

const ROLE_INFO = {
  admin: {
    label: "Boss / Administrators",
    purpose: "Full business picture with figures, risks, trends and management advice.",
    contents: ["Sales and money received", "Gross profit, margin and expenses", "Customer debt and overdue exposure", "Spare Parts stock position", "Installment collections and arrears", "Cash-control exceptions and recommendations"],
  },
  manager: {
    label: "Managers",
    purpose: "Action-focused information showing what needs attention in the business.",
    contents: ["Sales performance", "Stock and replenishment pressure", "Customer debt collection", "Installment collections and arrears", "Priority operational actions"],
  },
  auditor: {
    label: "Auditors",
    purpose: "Control-focused information showing evidence, exceptions and items requiring review.",
    contents: ["Daily Closing evidence", "Cash shortages and variances", "Changes after closing", "Customer debt exceptions", "Installment payment and arrears evidence", "Audit follow-up actions"],
  },
};

function reportMeta(code) {
  const parts = String(code || "").split(".");
  return { period: parts[2] === "monthly" ? "monthly" : "weekly", role: parts[3] || "admin" };
}

function money(value) {
  const n = Number(value || 0);
  return `GHS ${Number.isFinite(n) ? n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function reportDescription(period) {
  return period === "weekly"
    ? "Sent once after Saturday's Daily Closing is confirmed."
    : "Sent once after the final Daily Closing of the month is confirmed.";
}

function reportMessage(period, role, summary, accounts) {
  const spare = summary?.spare_parts || {};
  const cash = summary?.cash_control || {};
  const list = Array.isArray(accounts) ? accounts : [];
  const paid = list.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
  const outstanding = list.reduce((sum, item) => sum + Number(item.outstanding_balance || 0), 0);
  const overdue = list.reduce((sum, item) => sum + Number(item.overdue_amount || 0), 0);
  const arrears = list.filter((item) => Number(item.overdue_amount || 0) > 0.01).length;
  const title = period === "weekly" ? "Weekly Business Intelligence" : "Monthly Business Intelligence";

  if (role === "auditor") {
    return `Chalin 03 ${title}. Daily Closings ${cash.closing_count || 0}; verified ${cash.verified_count || 0}; awaiting verification ${cash.awaiting_verification_count || 0}; variance exposure ${money(cash.absolute_variance)}; changed after close ${cash.changed_after_close_count || 0}. Customer debt ${money(spare.debt_balance)}. Installment portfolio ${list.length} accounts; collected ${money(paid)}; outstanding ${money(outstanding)}; overdue ${money(overdue)} across ${arrears} accounts. Review evidence, payment allocations and outstanding exceptions.`;
  }

  if (role === "manager") {
    return `Chalin 03 ${title}. Sales ${money(spare.sales_total)}; received ${money(spare.sales_received)}; expenses ${money(spare.expenses_total)}; operating result ${money(spare.estimated_store_margin)}. Low-stock products ${spare.low_stock_count || 0}. Customer debt ${money(spare.debt_balance)}. Installment collections ${money(paid)}; outstanding ${money(outstanding)}; overdue ${money(overdue)}. Priority: replenish critical stock, collect ageing debt and act on installment arrears.`;
  }

  return `Chalin 03 ${title}. Sales ${money(spare.sales_total)}; received ${money(spare.sales_received)}; expenses ${money(spare.expenses_total)}; estimated operating result ${money(spare.estimated_store_margin)}. Customer debt ${money(spare.debt_balance)}. Spare Parts low-stock ${spare.low_stock_count || 0}. Installment accounts ${list.length}; collections ${money(paid)}; outstanding ${money(outstanding)}; overdue ${money(overdue)} across ${arrears} accounts. Daily Closing variance exposure ${money(cash.absolute_variance)}. Management advice: review debt collection, critical stock, installment arrears and cash exceptions.`;
}

export default function AdminIntelligenceSettings() {
  const { canAccessAllBranches } = useAuth();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [sending, setSending] = useState("");
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showMonitoring, setShowMonitoring] = useState(false);

  const reportRules = useMemo(
    () => REPORT_CODES.map((code) => rules.find((rule) => rule.rule_code === code)).filter(Boolean),
    [rules]
  );

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/notifications/rules");
      setRules(response.data?.rules || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Intelligence settings could not be loaded.");
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
    setRules((current) => current.map((item) => (item.id === rule.id ? { ...item, ...changes } : item)));
    try {
      const response = await axiosClient.patch(`/notifications/rules/${rule.id}`, changes);
      setRules((current) => current.map((item) => (item.id === rule.id ? { ...item, ...(response.data?.rule || changes) } : item)));
      setNotice("Saved.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The setting could not be saved.");
      await loadRules();
    } finally {
      setSavingId(null);
    }
  }

  async function getCurrentData() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);
    const [summaryResponse, accountsResponse] = await Promise.all([
      axiosClient.get("/group-executive/summary", {
        params: { from, to, branch_scope: canAccessAllBranches ? "all" : "selected" },
        timeout: 120000,
      }),
      axiosClient.get("/equipment-catalogue/sales/finance-lifecycle/accounts"),
    ]);
    return { summary: summaryResponse.data?.summary || {}, accounts: accountsResponse.data?.accounts || [] };
  }

  async function previewReport(period, role) {
    setSending(`preview-${period}-${role}`);
    setError("");
    setNotice("");
    try {
      const { summary, accounts } = await getCurrentData();
      setPreview({ period, role, message: reportMessage(period, role, summary, accounts) });
    } catch (requestError) {
      setError(requestError.response?.data?.message || "The report preview could not be prepared.");
    } finally {
      setSending("");
    }
  }

  async function sendReportNow(period) {
    setSending(period);
    setError("");
    setNotice("");
    try {
      const { summary, accounts } = await getCurrentData();
      const periodRules = reportRules.filter((rule) => reportMeta(rule.rule_code).period === period);
      const usersResponse = await axiosClient.get("/users");
      const settingsResponse = await axiosClient.get("/settings");
      const users = usersResponse.data?.users || [];
      const settings = settingsResponse.data?.settings || {};
      const recipients = new Map();

      for (const role of ["admin", "manager", "auditor"]) {
        const rule = periodRules.find((item) => reportMeta(item.rule_code).role === role);
        if (!rule || !Number(rule.is_enabled) || !Number(rule.sms_allowed)) continue;
        const message = reportMessage(period, role, summary, accounts);
        for (const account of users.filter((item) => item.is_active && item.role === role && String(item.phone || "").trim())) {
          const phone = String(account.phone).trim();
          if (!recipients.has(phone)) recipients.set(phone, message);
        }
      }

      const ownerPhone = String(settings.owner_phone || "").trim();
      const adminRule = periodRules.find((item) => reportMeta(item.rule_code).role === "admin");
      if (ownerPhone && adminRule && Number(adminRule.is_enabled) && Number(adminRule.sms_allowed) && !recipients.has(ownerPhone)) {
        recipients.set(ownerPhone, reportMessage(period, "admin", summary, accounts));
      }

      if (!recipients.size) throw new Error("No enabled audience with a configured phone number is available.");

      let sent = 0;
      const failed = [];
      for (const [phone, message] of recipients.entries()) {
        try {
          await axiosClient.post("/sms/test", { phone, message });
          sent += 1;
        } catch (requestError) {
          failed.push(requestError.response?.data?.message || requestError.message || "SMS failed");
        }
      }

      setNotice(`${period === "weekly" ? "Weekly" : "Monthly"} report sent to ${sent} recipient(s).${failed.length ? ` ${failed.length} failed.` : ""}`);
      if (failed.length) setError(failed.join(" | "));
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "The report could not be sent.");
    } finally {
      setSending("");
    }
  }

  return (
    <>
      <section className="c03-intelligence-strip">
        <div>
          <span>Management intelligence</span>
          <strong>Business Intelligence & Alerts</strong>
          <small>Weekly and monthly business reports for the people you choose.</small>
        </div>
        <button type="button" onClick={() => setOpen(true)}>Open</button>
      </section>

      {open ? (
        <div className="c03-intelligence-overlay" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="c03-intelligence-dialog" role="dialog" aria-modal="true" aria-label="Chalin 03 Business Intelligence">
            <div className="c03-intelligence-head">
              <div>
                <span>Chalin 03 management control</span>
                <h2>Business Intelligence</h2>
                <p>Choose who receives the business review, when it goes out and what each person receives.</p>
              </div>
              <button type="button" className="c03-intelligence-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>

            {notice ? <div className="c03-intelligence-message success">{notice}</div> : null}
            {error ? <div className="c03-intelligence-message error">{error}</div> : null}

            <div className="c03-intelligence-report-grid">
              {['weekly', 'monthly'].map((period) => (
                <article className="c03-intelligence-report" key={period}>
                  <div className="c03-intelligence-report-top">
                    <div>
                      <span className="eyebrow">{period === 'weekly' ? 'Every week' : 'Every month'}</span>
                      <h3>{period === 'weekly' ? 'Weekly Business Intelligence' : 'Monthly Business Intelligence'}</h3>
                    </div>
                    <button type="button" className="dark-action" onClick={() => sendReportNow(period)} disabled={sending === period}>
                      {sending === period ? 'Sending…' : `Send ${period} now`}
                    </button>
                  </div>
                  <p className="schedule">{reportDescription(period)}</p>
                  <div className="report-includes">
                    <strong>Report contains</strong>
                    <span>Spare Parts performance, cash received, profitability, customer debt, stock risk, Installment collections, arrears, control exceptions and management advice.</span>
                  </div>
                </article>
              ))}
            </div>

            <div className="section-label">Who receives each report</div>
            <div className="audience-grid">
              {reportRules.map((rule) => {
                const { period, role } = reportMeta(rule.rule_code);
                const info = ROLE_INFO[role] || ROLE_INFO.admin;
                const key = `${period}-${role}`;
                return (
                  <article className="audience-card" key={rule.id || key}>
                    <div className="audience-top">
                      <div>
                        <span className="eyebrow">{period === 'weekly' ? 'Weekly' : 'Monthly'}</span>
                        <h3>{info.label}</h3>
                      </div>
                      <span className={Number(rule.is_enabled) ? 'status on' : 'status off'}>{Number(rule.is_enabled) ? 'ON' : 'OFF'}</span>
                    </div>
                    <p>{info.purpose}</p>
                    <div className="delivery-row"><span>SMS</span><strong>{Number(rule.sms_allowed) ? 'Enabled' : 'Off'}</strong></div>
                    <ul>
                      {info.contents.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    <div className="audience-actions">
                      <button type="button" className="light-action" onClick={() => previewReport(period, role)} disabled={sending === `preview-${period}-${role}`}>
                        {sending === `preview-${period}-${role}` ? 'Preparing…' : 'Preview'}
                      </button>
                      <button type="button" className="toggle-action" onClick={() => updateRule(rule, { is_enabled: Number(rule.is_enabled) ? 0 : 1 })} disabled={savingId === rule.id}>
                        {Number(rule.is_enabled) ? 'Turn off' : 'Turn on'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="quiet-note">
              <strong>Quiet monitoring</strong>
              <span>Chalin 03 watches Spare Parts, customer debt and Installment conditions in the background. These checks do not send SMS. They only prepare information for the notification centre and the scheduled business reports.</span>
              <button type="button" onClick={() => setShowMonitoring((value) => !value)}>{showMonitoring ? 'Hide details' : 'View details'}</button>
            </div>

            {showMonitoring ? (
              <div className="monitor-details">
                <div><strong>Spare Parts stock</strong><span>Flags products reaching the configured replenishment threshold.</span></div>
                <div><strong>Customer debt</strong><span>Identifies overdue customer balances for collection attention.</span></div>
                <div><strong>Installment due soon</strong><span>Identifies scheduled installments approaching their due date.</span></div>
                <div><strong>Installment arrears</strong><span>Identifies overdue installment balances and recovery work.</span></div>
                <div><strong>Audit attention</strong><span>Highlights when audit review has gone beyond its configured review period.</span></div>
              </div>
            ) : null}

            {preview ? (
              <div className="preview-panel">
                <div className="preview-head"><div><span className="eyebrow">Preview</span><h3>{preview.period === 'weekly' ? 'Weekly' : 'Monthly'} · {ROLE_INFO[preview.role]?.label}</h3></div><button type="button" onClick={() => setPreview(null)}>Close</button></div>
                <pre>{preview.message}</pre>
              </div>
            ) : null}

            {loading ? <div className="loading-note">Loading intelligence settings…</div> : null}
          </section>
        </div>
      ) : null}

      <style>{`
        .c03-intelligence-strip{margin:0 0 18px;padding:16px 18px;border:1px solid #dbe3ef;border-radius:18px;background:linear-gradient(135deg,#07182c,#0d2f55);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;box-shadow:0 14px 34px rgba(7,24,44,.12)}
        .c03-intelligence-strip span,.c03-intelligence-head span,.eyebrow{display:block;color:#c99f19;font-size:10px;font-weight:950;letter-spacing:.11em;text-transform:uppercase}.c03-intelligence-strip strong{display:block;margin-top:3px;font-size:18px}.c03-intelligence-strip small{display:block;margin-top:4px;color:rgba(255,255,255,.72);font-size:12px}.c03-intelligence-strip>button{border:1px solid #e0ba28;background:#e0ba28;color:#07182c;border-radius:10px;padding:10px 15px;font-weight:950;cursor:pointer}
        .c03-intelligence-overlay{position:fixed;inset:0;z-index:1600;background:rgba(7,24,44,.64);display:grid;place-items:center;padding:18px}.c03-intelligence-dialog{width:min(1080px,100%);max-height:92vh;overflow:auto;background:#fff;border:1px solid #dce4ef;border-radius:26px;padding:24px;color:#10213b;box-shadow:0 34px 100px rgba(7,24,44,.35)}
        .c03-intelligence-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid #e8edf3;padding-bottom:18px}.c03-intelligence-head h2{margin:6px 0 5px;color:#07182c;font-size:30px;letter-spacing:-.04em}.c03-intelligence-head p{margin:0;color:#64748b;font-size:13px}.c03-intelligence-close{width:42px;height:42px;border:0;border-radius:12px;background:#f1f5f9;color:#07182c;font-size:24px;cursor:pointer}
        .c03-intelligence-message{margin:14px 0;padding:11px 13px;border-radius:12px;font-size:12px;font-weight:800}.c03-intelligence-message.success{background:#ecfdf5;color:#166534}.c03-intelligence-message.error{background:#fef2f2;color:#991b1b}
        .c03-intelligence-report-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}.c03-intelligence-report{border:1px solid #dfe6ef;border-radius:18px;padding:17px;background:linear-gradient(180deg,#fff,#f8fafc)}.c03-intelligence-report-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.c03-intelligence-report h3,.audience-card h3,.preview-panel h3{margin:4px 0;color:#07182c;font-size:17px}.schedule{margin:7px 0 12px;color:#475569;font-size:12px;font-weight:800}.report-includes{padding:11px 12px;border-radius:12px;background:#f8fafc;border:1px solid #edf2f7}.report-includes strong{display:block;color:#07182c;font-size:11px}.report-includes span{display:block;margin-top:5px;color:#64748b;font-size:12px;line-height:1.5}
        .dark-action,.light-action,.toggle-action{border-radius:10px;padding:9px 11px;font-weight:900;cursor:pointer}.dark-action{border:1px solid #07182c;background:#07182c;color:#fff}.dark-action:disabled,.light-action:disabled,.toggle-action:disabled{opacity:.55;cursor:not-allowed}.light-action{border:1px solid #dbe3ef;background:#fff;color:#07182c}.toggle-action{border:1px solid #e0ba28;background:#fff8db;color:#6b4d00}
        .section-label{margin:22px 0 10px;color:#07182c;font-size:14px;font-weight:950}.audience-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.audience-card{border:1px solid #e0e7ef;border-radius:16px;padding:14px;background:#fff}.audience-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.audience-card p{margin:7px 0 9px;color:#64748b;font-size:12px;line-height:1.45}.status{display:inline-flex;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:950}.status.on{background:#ecfdf5;color:#166534}.status.off{background:#f1f5f9;color:#64748b}.delivery-row{display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #edf2f7;border-bottom:1px solid #edf2f7;font-size:11px}.delivery-row span{color:#64748b}.delivery-row strong{color:#07182c}.audience-card ul{padding-left:16px;margin:10px 0;color:#475569}.audience-card li{margin:4px 0;font-size:11px}.audience-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px}
        .quiet-note{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px;padding:12px 13px;border:1px solid #dce5ef;border-radius:14px;background:#f8fafc}.quiet-note strong{color:#07182c;font-size:12px}.quiet-note span{flex:1;min-width:220px;color:#64748b;font-size:11px;line-height:1.45}.quiet-note button,.preview-head button{border:0;background:transparent;color:#0b4a78;font-weight:900;cursor:pointer}
        .monitor-details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.monitor-details div{padding:10px 11px;border-radius:12px;background:#f8fafc;border:1px solid #edf2f7}.monitor-details strong{display:block;color:#07182c;font-size:11px}.monitor-details span{display:block;margin-top:3px;color:#64748b;font-size:11px;line-height:1.4}.preview-panel{margin-top:16px;border:1px solid #dbe3ef;border-radius:16px;background:#07182c;color:#fff;padding:14px}.preview-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.preview-panel h3{color:#fff}.preview-head button{color:#e0ba28}.preview-panel pre{white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e6edf5;margin:12px 0 0}.loading-note{padding:12px;text-align:center;color:#64748b;font-size:12px}
        @media(max-width:860px){.audience-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.c03-intelligence-report-grid{grid-template-columns:1fr}}
        @media(max-width:620px){.c03-intelligence-overlay{align-items:end;padding:0}.c03-intelligence-dialog{max-height:95vh;border-radius:22px 22px 0 0;padding:18px}.audience-grid{grid-template-columns:1fr}.c03-intelligence-report-top{flex-direction:column}.dark-action{width:100%}.audience-actions>*{flex:1}.c03-intelligence-head h2{font-size:25px}.monitor-details{grid-template-columns:1fr}}
      `}</style>
    </>
  );
}
