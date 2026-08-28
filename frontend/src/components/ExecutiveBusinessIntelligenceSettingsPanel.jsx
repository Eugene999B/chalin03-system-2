import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const REPORTS = [
  {
    code: "group.executive.weekly_business_intelligence",
    title: "Weekly Executive Update",
    description: "A weekly management intelligence briefing after the selected period closes.",
  },
  {
    code: "group.executive.monthly_business_intelligence",
    title: "Monthly Executive Update",
    description: "A month-end management intelligence briefing for the completed period.",
  },
];

const RECIPIENT_ROLES = [
  { value: "admin", label: "Boss / Other Admins", helper: "Executive decisions and business direction" },
  { value: "auditor", label: "Auditors", helper: "Control exceptions, evidence and review priorities" },
  { value: "manager", label: "Managers", helper: "Operational follow-up and accountable actions" },
];

const AUDIENCES = [
  { value: "executive", label: "Boss / Executive", description: "Deep business picture, decisions, risk and what needs attention now." },
  { value: "auditor", label: "Auditor", description: "Control signals, unusual patterns, evidence gaps and review actions." },
  { value: "manager", label: "Manager", description: "Simple action list focused on what must be done next." },
];

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value) {
  return `${numberValue(value).toLocaleString("en-GH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function shortDate(value) {
  if (!value) return "-";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function normaliseRoles(rule) {
  const values = String(rule?.target_role || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => RECIPIENT_ROLES.some((role) => role.value === value));
  return values.length ? [...new Set(values)] : RECIPIENT_ROLES.map((role) => role.value);
}

function ToggleSwitch({ checked, disabled, onClick, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick} style={{ width: 52, height: 30, padding: 3, border: 0, borderRadius: 999, background: checked ? "#16a34a" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: checked ? "flex-end" : "flex-start", cursor: disabled ? "not-allowed" : "pointer", transition: "all .18s ease", boxShadow: "inset 0 0 0 1px rgba(15,23,42,.12)" }}>
      <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(15,23,42,.22)" }} />
    </button>
  );
}

function intelligenceFromSummary(summary, accounts, range) {
  const spare = summary?.spare_parts || {};
  const financeAccounts = Array.isArray(accounts) ? accounts : [];
  const activeFinance = financeAccounts.filter((account) => !["completed", "cancelled"].includes(String(account.agreement_status || "").toLowerCase()));
  const overdueFinance = activeFinance.filter((account) => numberValue(account.overdue_amount) > 0.01 || ["overdue", "defaulted"].includes(String(account.agreement_status || "").toLowerCase()));
  const criticalFinance = activeFinance.filter((account) => String(account.risk_band || "").toLowerCase() === "critical");
  const highFinance = activeFinance.filter((account) => String(account.risk_band || "").toLowerCase() === "high");
  const outstandingFinance = activeFinance.reduce((sum, account) => sum + numberValue(account.outstanding_balance), 0);
  const overdueAmountFinance = activeFinance.reduce((sum, account) => sum + numberValue(account.overdue_amount), 0);
  const collectedFinance = activeFinance.reduce((sum, account) => sum + numberValue(account.amount_paid), 0);

  const actions = [];
  if (numberValue(spare.out_of_stock_count) > 0) actions.push({ severity: "high", title: "Protect Spare Parts availability", detail: `${numberValue(spare.out_of_stock_count)} product(s) are at zero stock.`, action: "Prioritise critical replenishment and investigate whether lost sales are already appearing.", path: "/low-stock" });
  if (numberValue(spare.low_stock_count) > 0) actions.push({ severity: "medium", title: "Review Spare Parts replenishment", detail: `${numberValue(spare.low_stock_count)} product(s) are at or below restock level.`, action: "Review fast-moving parts and purchasing priorities.", path: "/low-stock" });
  if (numberValue(spare.overdue_debt_balance) > 0) actions.push({ severity: "high", title: "Recover Spare Parts customer cash", detail: `${money(spare.overdue_debt_balance)} is overdue across ${numberValue(spare.overdue_debt_accounts)} account(s).`, action: "Assign the largest overdue balances for immediate collection follow-up.", path: "/debts" });
  if (criticalFinance.length) actions.push({ severity: "critical", title: "Escalate critical Installment accounts", detail: `${criticalFinance.length} active Finance account(s) are in the critical risk band.`, action: "Review each account, guarantor position and recovery decision today.", path: "/equipment-installment-finance/applications?stage=collections" });
  if (overdueFinance.length) actions.push({ severity: "high", title: "Reduce Installment arrears", detail: `${overdueFinance.length} active Finance account(s) are overdue with ${money(overdueAmountFinance)} in arrears.`, action: "Prioritise the oldest and highest-value accounts and document the recovery owner.", path: "/equipment-installment-finance/applications?stage=collections" });
  if (highFinance.length) actions.push({ severity: "medium", title: "Watch elevated Finance risk", detail: `${highFinance.length} active Finance account(s) are in the high-risk band.`, action: "Confirm follow-up before the next payment cycle.", path: "/equipment-installment-finance/applications?stage=collections" });
  const summaryAlerts = Array.isArray(summary?.alerts) ? summary.alerts : [];
  for (const alert of summaryAlerts.filter((item) => ["critical", "high"].includes(String(item.severity || "").toLowerCase())).slice(0, 4)) {
    const duplicate = actions.some((action) => action.title === alert.title);
    if (!duplicate) actions.push({ severity: String(alert.severity).toLowerCase(), title: alert.title || "Management control signal", detail: alert.message || alert.detail || "A management signal was raised.", action: alert.recommendation || "Review the supporting record and document the decision.", path: alert.action_path || "/group-executive-control" });
  }
  if (!actions.length) actions.push({ severity: "low", title: "No urgent exception surfaced", detail: "The monitored Spare Parts and Installment indicators are currently within the visible review thresholds.", action: "Maintain daily reconciliation, collection discipline and independent review.", path: "/group-executive-control" });

  const riskWeight = actions.reduce((sum, action) => sum + ({ critical: 34, high: 18, medium: 7, low: 0 }[action.severity] || 0), 0);
  const healthScore = Math.max(0, Math.min(100, 100 - riskWeight));

  return {
    generatedAt: new Date().toISOString(),
    range,
    healthScore,
    healthLabel: healthScore >= 85 ? "Strong control picture" : healthScore >= 65 ? "Watch carefully" : "Immediate executive attention",
    spare: {
      revenue: numberValue(spare.sales_total),
      received: numberValue(spare.sales_received),
      balance: numberValue(spare.sales_balance),
      debt: numberValue(spare.debt_balance),
      overdueDebt: numberValue(spare.overdue_debt_balance),
      overdueDebtAccounts: numberValue(spare.overdue_debt_accounts),
      expenses: numberValue(spare.expenses_total),
      lowStock: numberValue(spare.low_stock_count),
      outOfStock: numberValue(spare.out_of_stock_count),
      products: numberValue(spare.product_count),
      collectionRate: numberValue(spare.sales_total) > 0 ? (numberValue(spare.sales_received) / numberValue(spare.sales_total)) * 100 : 0,
    },
    finance: {
      activeAccounts: activeFinance.length,
      outstanding: outstandingFinance,
      overdueAmount: overdueAmountFinance,
      overdueAccounts: overdueFinance.length,
      criticalAccounts: criticalFinance.length,
      highAccounts: highFinance.length,
      collected: collectedFinance,
      dueNext7Days: activeFinance.reduce((sum, account) => numberValue(account.days_until_due) >= 0 && numberValue(account.days_until_due) <= 7 ? sum + numberValue(account.next_payment_amount) : sum, 0),
    },
    actions: actions.slice(0, 10),
  };
}

function buildMessage(intelligence, audience) {
  const { spare, finance, actions, range } = intelligence;
  const urgent = actions.filter((action) => ["critical", "high"].includes(action.severity));
  const rangeLabel = `${shortDate(range.from)} to ${shortDate(range.to)}`;

  if (audience === "auditor") {
    return [
      `CHALIN 03 EXECUTIVE AUDIT INTELLIGENCE — ${rangeLabel}.`,
      `Scope: Spare Parts + Installment Finance only.`,
      `Spare Parts evidence: ${money(spare.revenue)} recorded sales, ${money(spare.received)} collected (${percent(spare.collectionRate)}), ${money(spare.overdueDebt)} overdue debt, ${spare.lowStock} low-stock and ${spare.outOfStock} zero-stock product(s).`,
      `Installment evidence: ${finance.activeAccounts} active account(s), ${money(finance.outstanding)} outstanding, ${money(finance.overdueAmount)} overdue, ${finance.overdueAccounts} overdue account(s), ${finance.criticalAccounts + finance.highAccounts} high/critical-risk account(s), ${money(finance.dueNext7Days)} due within seven days.`,
      `Audit focus: ${urgent.length ? urgent.map((action) => `${action.title} — ${action.action}`).join(" ") : "No urgent control exception is currently surfaced."}`,
      "Important: a signal is a reason to inspect evidence, not a finding of fraud or misconduct. Confirm the transaction trail, approval history and supporting documents before reaching a conclusion.",
    ].join(" ");
  }

  if (audience === "manager") {
    return [
      `CHALIN 03 MANAGEMENT ACTION INTELLIGENCE — ${rangeLabel}.`,
      `Spare Parts: ${money(spare.revenue)} sales, ${money(spare.received)} collected, ${money(spare.overdueDebt)} overdue debt, ${spare.lowStock} low-stock and ${spare.outOfStock} zero-stock product(s).`,
      `Installment Finance: ${finance.activeAccounts} active account(s), ${money(finance.outstanding)} outstanding, ${money(finance.overdueAmount)} overdue, ${finance.overdueAccounts} overdue and ${finance.criticalAccounts + finance.highAccounts} high/critical-risk account(s).`,
      `Do next: ${actions.slice(0, 5).map((action) => `${action.title}: ${action.action}`).join(" ")}`,
    ].join(" ");
  }

  return [
    `CHALIN 03 DEEP EXECUTIVE INTELLIGENCE — ${rangeLabel}.`,
    `The business picture: Spare Parts recorded ${money(spare.revenue)} in sales and collected ${money(spare.received)} (${percent(spare.collectionRate)}), while ${money(spare.overdueDebt)} remains overdue from customers. Inventory pressure is ${spare.outOfStock} zero-stock and ${spare.lowStock} low-stock product(s).`,
    `The Finance book: ${finance.activeAccounts} active installment agreement(s) carry ${money(finance.outstanding)} outstanding; ${money(finance.overdueAmount)} is currently overdue, with ${finance.overdueAccounts} overdue account(s) and ${finance.criticalAccounts + finance.highAccounts} high/critical-risk account(s). ${money(finance.dueNext7Days)} is due in the next seven days.`,
    urgent.length
      ? `What deserves your attention now: ${urgent.map((action) => `${action.title}. ${action.detail} Decision: ${action.action}`).join(" ")}`
      : "What deserves your attention now: keep protecting cash collection, stock availability and disciplined Finance follow-up.",
    "The purpose is to make the business understandable at executive level: what is happening, why it matters, what should be reviewed, and what decision should follow. Risk signals are review prompts, not accusations.",
  ].join(" ");
}

export default function ExecutiveBusinessIntelligenceSettingsPanel() {
  const [rules, setRules] = useState({});
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [audience, setAudience] = useState("executive");
  const [selectedRoles, setSelectedRoles] = useState(["admin", "auditor"]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analysing, setAnalysing] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [sendSms, setSendSms] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    axiosClient.get("/notifications/rules")
      .then((response) => {
        if (!active) return;
        const next = {};
        for (const rule of response.data?.rules || []) {
          if (REPORTS.some((report) => report.code === rule.rule_code)) next[rule.rule_code] = rule;
        }
        setRules(next);
      })
      .catch((requestError) => { if (active) setError(requestError.response?.data?.message || "Could not load executive intelligence settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const intelligence = useMemo(() => intelligenceFromSummary(summary, accounts, { from, to }), [summary, accounts, from, to]);
  const message = useMemo(() => buildMessage(intelligence, audience), [intelligence, audience]);

  async function analyse() {
    setAnalysing(true);
    setError("");
    setNotice("");
    try {
      const [summaryResponse, financeResponse] = await Promise.all([
        axiosClient.get("/group-executive/summary", { params: { from, to, branch_scope: "all" }, timeout: 120000 }),
        axiosClient.get("/equipment-catalogue/sales/finance-lifecycle/accounts", { timeout: 120000 }),
      ]);
      setSummary(summaryResponse.data?.summary || null);
      setAccounts(financeResponse.data?.accounts || []);
      setNotice("Fresh intelligence prepared from the current Chalin 03 records.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not prepare executive intelligence.");
    } finally {
      setAnalysing(false);
    }
  }

  async function updateRule(ruleCode, patch, successText) {
    const current = rules[ruleCode];
    if (!current?.id) {
      setError("This executive reporting rule has not been initialised yet.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await axiosClient.patch(`/notifications/rules/${current.id}`, patch);
      setRules((state) => ({ ...state, [ruleCode]: { ...state[ruleCode], ...patch } }));
      setNotice(successText);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not update the reporting rule.");
    }
  }

  function toggleRole(role) {
    setSelectedRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  }

  async function dispatchNow() {
    if (!selectedRoles.length) {
      setError("Choose at least one recipient role before distributing the briefing.");
      return;
    }
    if (!summary) {
      await analyse();
      return;
    }
    setDispatching(true);
    setError("");
    setNotice("");
    try {
      const targetRoles = audience === "executive" && selectedRoles.includes("admin") ? selectedRoles : selectedRoles;
      for (const role of targetRoles) {
        await axiosClient.post("/notifications/manual", {
          workspace_code: "group",
          target_role: role,
          category: "executive",
          severity: intelligence.actions.some((action) => action.severity === "critical") ? "critical" : intelligence.actions.some((action) => action.severity === "high") ? "high" : "medium",
          title: audience === "auditor" ? "Chalin 03 Executive Audit Intelligence" : audience === "manager" ? "Chalin 03 Management Action Intelligence" : "Chalin 03 Deep Executive Intelligence",
          message,
          action_path: "/group-executive-control",
          source_reference: `${intelligence.range.from}_${intelligence.range.to}_${audience}`,
        });
      }
      setNotice(`Briefing distributed to ${targetRoles.map((role) => RECIPIENT_ROLES.find((item) => item.value === role)?.label || role).join(", ")}. ${sendSms ? "The distribution is recorded in the in-app notification channel; SMS remains governed by the existing SMS rules." : "SMS distribution was left off."}`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not distribute the executive briefing.");
    } finally {
      setDispatching(false);
    }
  }

  const highestAction = intelligence.actions[0];
  const reportStatus = REPORTS.map((report) => ({ report, rule: rules[report.code] })).filter(({ rule }) => rule);

  return (
    <section style={{ margin: "0 0 14px", padding: 14, borderRadius: 18, border: "1px solid #dbe3ef", background: "#fff", boxShadow: "0 10px 28px rgba(15,23,42,.05)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Executive intelligence</div>
          <strong style={{ display: "block", marginTop: 3, color: "#07182c", fontSize: 18 }}>Weekly & Monthly Executive Updates</strong>
          <small style={{ display: "block", marginTop: 4, color: "#64748b", lineHeight: 1.5 }}>Deep, understandable decision intelligence for Spare Parts and Installment Finance — plus one-click distribution to the people you choose.</small>
          {highestAction ? <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 12, background: highestAction.severity === "critical" ? "#fef2f2" : highestAction.severity === "high" ? "#fff7ed" : "#f8fafc", color: "#334155", fontSize: 12, fontWeight: 800 }}>{highestAction.severity.toUpperCase()} · {highestAction.title} — {highestAction.detail}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => { setOpen(true); void analyse(); }} disabled={analysing} style={{ border: 0, borderRadius: 12, padding: "10px 14px", background: "#07182c", color: "#fff", fontWeight: 900, cursor: analysing ? "wait" : "pointer" }}>{analysing ? "Preparing…" : "Open Intelligence Centre"}</button>
          <button type="button" onClick={() => { setOpen(true); }} style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: "10px 14px", background: "#fff", color: "#07182c", fontWeight: 900, cursor: "pointer" }}>Settings</button>
        </div>
      </div>

      {open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="executive-intelligence-title" style={{ position: "fixed", inset: 0, zIndex: 5100, background: "rgba(7,24,44,.62)", display: "grid", placeItems: "center", padding: 18 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div style={{ width: "min(1100px, 100%)", maxHeight: "92vh", overflow: "auto", borderRadius: 26, background: "#f8fafc", boxShadow: "0 30px 100px rgba(0,0,0,.36)" }}>
            <header style={{ padding: 24, background: "linear-gradient(135deg,#07182c,#12375a)", color: "#fff", borderRadius: "26px 26px 0 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                <div>
                  <div style={{ color: "#f5d76e", fontSize: 10, fontWeight: 900, letterSpacing: ".09em", textTransform: "uppercase" }}>Management intelligence centre</div>
                  <h2 id="executive-intelligence-title" style={{ margin: "6px 0 0", fontSize: 28 }}>Weekly & Monthly Executive Updates</h2>
                  <p style={{ margin: "8px 0 0", maxWidth: 760, color: "rgba(255,255,255,.8)", lineHeight: 1.5 }}>The boss should not have to read raw transactions. This screen turns the live business picture into a simple executive explanation: what is happening, what looks unusual, what matters, and what needs to be done.</p>
                </div>
                <button type="button" aria-label="Close executive intelligence centre" onClick={() => setOpen(false)} style={{ border: 0, borderRadius: 10, padding: "8px 11px", background: "rgba(255,255,255,.12)", color: "#fff", fontWeight: 900, cursor: "pointer" }}>✕</button>
              </div>
            </header>

            <div style={{ padding: 18, display: "grid", gap: 14 }}>
              <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800 }}>Executive health</span><strong style={{ display: "block", marginTop: 5, color: intelligence.healthScore < 65 ? "#991b1b" : "#166534", fontSize: 21 }}>{intelligence.healthScore}/100</strong><small style={{ color: "#64748b" }}>{intelligence.healthLabel}</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800 }}>Spare Parts cash</span><strong style={{ display: "block", marginTop: 5, color: "#07182c", fontSize: 18 }}>{money(intelligence.spare.received)}</strong><small style={{ color: "#64748b" }}>{percent(intelligence.spare.collectionRate)} of recorded sales collected</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800 }}>Installment exposure</span><strong style={{ display: "block", marginTop: 5, color: "#07182c", fontSize: 18 }}>{money(intelligence.finance.outstanding)}</strong><small style={{ color: "#64748b" }}>{money(intelligence.finance.overdueAmount)} currently overdue</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800 }}>Urgent decisions</span><strong style={{ display: "block", marginTop: 5, color: "#991b1b", fontSize: 18 }}>{intelligence.actions.filter((item) => ["critical", "high"].includes(item.severity)).length}</strong><small style={{ color: "#64748b" }}>high-priority review items</small></article>
              </section>

              <section style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 14 }}>
                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><div><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>1 · Prepare</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Fresh business intelligence</h3></div><button type="button" onClick={analyse} disabled={analysing} style={{ border: "1px solid #dbe3ef", borderRadius: 10, padding: "8px 11px", background: "#07182c", color: "#fff", fontWeight: 850 }}>{analysing ? "Working…" : "Refresh analysis"}</button></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 12 }}>
                    <label style={{ fontSize: 11, fontWeight: 900, color: "#334155" }}>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ display: "block", width: "100%", marginTop: 5, boxSizing: "border-box", border: "1px solid #dbe3ef", borderRadius: 10, padding: "9px 10px" }} /></label>
                    <label style={{ fontSize: 11, fontWeight: 900, color: "#334155" }}>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ display: "block", width: "100%", marginTop: 5, boxSizing: "border-box", border: "1px solid #dbe3ef", borderRadius: 10, padding: "9px 10px" }} /></label>
                  </div>
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: "#f8fafc", color: "#475569", fontSize: 12, lineHeight: 1.55 }}>
                    <strong style={{ color: "#07182c" }}>Scope locked:</strong> Spare Parts + Installment Finance. Other divisions are intentionally excluded from this briefing.
                  </div>
                </article>

                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>2 · Choose audience</span>
                  <h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Change the language to suit the recipient</h3>
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {AUDIENCES.map((option) => <button key={option.value} type="button" onClick={() => setAudience(option.value)} style={{ textAlign: "left", padding: 12, borderRadius: 14, border: audience === option.value ? "2px solid #07182c" : "1px solid #dbe3ef", background: audience === option.value ? "#f4f7fb" : "#fff", cursor: "pointer" }}><strong style={{ display: "block", color: "#07182c" }}>{option.label}</strong><small style={{ display: "block", marginTop: 4, color: "#64748b", lineHeight: 1.45 }}>{option.description}</small></button>)}
                  </div>
                </article>
              </section>

              <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>3 · Choose recipients</span>
                  <h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Who should receive this message?</h3>
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {RECIPIENT_ROLES.map((role) => {
                      const checked = selectedRoles.includes(role.value);
                      return <label key={role.value} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start", padding: 12, borderRadius: 14, border: checked ? "2px solid #07182c" : "1px solid #dbe3ef", background: checked ? "#fff8dc" : "#fff", cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={() => toggleRole(role.value)} style={{ marginTop: 3 }} /><span><strong style={{ display: "block", color: "#07182c" }}>{role.label}</strong><small style={{ display: "block", marginTop: 4, color: "#64748b" }}>{role.helper}</small></span></label>;
                    })}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 12, fontSize: 12, fontWeight: 850, color: "#334155" }}><input type="checkbox" checked={sendSms} onChange={(event) => setSendSms(event.target.checked)} /> Also request SMS treatment through the existing SMS rules</label>
                </article>

                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>4 · One-click briefing</span>
                  <h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Preview before it leaves your desk</h3>
                  <div style={{ marginTop: 10, padding: 13, borderRadius: 14, background: "#07182c", color: "#fff", minHeight: 160 }}>
                    <div style={{ color: "#f5d76e", fontSize: 10, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase" }}>{audience === "auditor" ? "Audit briefing" : audience === "manager" ? "Management action briefing" : "Boss briefing"}</div>
                    <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.6, color: "rgba(255,255,255,.88)" }}>{message}</p>
                  </div>
                  <button type="button" onClick={dispatchNow} disabled={dispatching || analysing || !selectedRoles.length} style={{ width: "100%", marginTop: 10, border: 0, borderRadius: 12, padding: "12px 14px", background: dispatching ? "#94a3b8" : "#16a34a", color: "#fff", fontWeight: 950, cursor: dispatching ? "wait" : "pointer" }}>{dispatching ? "Distributing briefing…" : "Distribute this briefing now"}</button>
                  <small style={{ display: "block", marginTop: 7, color: "#64748b", lineHeight: 1.45 }}>This action is independent of the weekly/monthly automation. You can distribute a fresh briefing whenever management needs it.</small>
                </article>
              </section>

              <section style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><div><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>5 · What needs attention</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Simple actions, not a wall of numbers</h3></div><span style={{ color: "#64748b", fontSize: 12, fontWeight: 800 }}>{intelligence.actions.length} active review item(s)</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9, marginTop: 11 }}>
                  {intelligence.actions.map((action, index) => <article key={`${action.title}-${index}`} style={{ padding: 12, borderRadius: 14, border: "1px solid #e2e8f0", background: action.severity === "critical" ? "#fff7f7" : "#f8fafc" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong style={{ color: "#07182c", fontSize: 13 }}>{action.title}</strong><span style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", color: action.severity === "critical" ? "#991b1b" : action.severity === "high" ? "#9a3412" : "#64748b" }}>{action.severity}</span></div><p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 12, lineHeight: 1.45 }}>{action.detail}</p><p style={{ margin: "6px 0 0", color: "#334155", fontSize: 12, lineHeight: 1.45 }}><strong>Do:</strong> {action.action}</p></article>)}
                </div>
              </section>

              <section style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                <span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>6 · Automated reporting</span>
                <h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Keep the weekly and monthly engines separate from on-demand briefings</h3>
                <div style={{ display: "grid", gap: 10, marginTop: 11 }}>
                  {reportStatus.map(({ report, rule }) => {
                    const enabled = Boolean(Number(rule?.is_enabled));
                    const roles = normaliseRoles(rule);
                    return <article key={report.code} style={{ padding: 13, borderRadius: 14, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}><div><strong style={{ display: "block", color: "#07182c" }}>{report.title}</strong><small style={{ display: "block", marginTop: 4, color: "#64748b" }}>{report.description}</small></div><div style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ fontSize: 11, fontWeight: 900, color: enabled ? "#166534" : "#64748b" }}>{enabled ? "ON" : "OFF"}</span><ToggleSwitch checked={enabled} disabled={!rule?.id} label={`${report.title} ${enabled ? "on" : "off"}`} onClick={() => updateRule(report.code, { is_enabled: !enabled }, `${report.title} is now ${!enabled ? "ON" : "OFF"}.`)} /></div></div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>{RECIPIENT_ROLES.map((role) => <button key={role.value} type="button" onClick={() => { const next = roles.includes(role.value) ? roles.filter((value) => value !== role.value) : [...roles, role.value]; if (!next.length) return; void updateRule(report.code, { target_role: next.join(",") }, `${report.title} recipients updated.`); }} style={{ border: "1px solid #dbe3ef", borderRadius: 999, padding: "6px 9px", background: roles.includes(role.value) ? "#fff8dc" : "#fff", color: "#334155", fontSize: 11, fontWeight: 800, cursor: "pointer" }}>{roles.includes(role.value) ? "✓ " : ""}{role.label}</button>)}</div>
                    </article>;
                  })}
                  {!reportStatus.length ? <div style={{ color: "#991b1b", fontWeight: 800, fontSize: 12 }}>The automated report rules are not initialised yet.</div> : null}
                </div>
              </section>

              {notice ? <div role="status" style={{ padding: 11, borderRadius: 12, background: "#f0fdf4", color: "#166534", fontWeight: 800 }}>{notice}</div> : null}
              {error ? <div role="alert" style={{ padding: 11, borderRadius: 12, background: "#fef2f2", color: "#991b1b", fontWeight: 800 }}>{error}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" onClick={() => setOpen(false)} style={{ border: "1px solid #dbe3ef", borderRadius: 11, padding: "9px 13px", background: "#fff", color: "#334155", fontWeight: 850, cursor: "pointer" }}>Close</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
