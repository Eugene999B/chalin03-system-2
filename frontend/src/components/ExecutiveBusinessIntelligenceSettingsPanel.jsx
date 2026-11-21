import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const REPORTS = [
  { code: "group.executive.weekly_business_intelligence", title: "Weekly Executive Update", description: "Focused weekly intelligence for Spare Parts and Installment Finance." },
  { code: "group.executive.monthly_business_intelligence", title: "Monthly Executive Update", description: "Focused month-end intelligence for Spare Parts and Installment Finance." },
];

const AUDIENCES = [
  { value: "executive", label: "Boss / Executive", helper: "Deep business picture, decisions, risk and actions management should confirm." },
  { value: "auditor", label: "Auditor", helper: "Control evidence, unusual patterns, review priorities and audit advice." },
  { value: "manager", label: "Manager / Admin", helper: "Practical operational priorities, follow-through and system improvements." },
];

const ROLE_OPTIONS = [
  { value: "admin", label: "Boss / Other Admins", helper: "Executive direction and business decisions" },
  { value: "auditor", label: "Auditors", helper: "Independent control review" },
  { value: "manager", label: "Managers", helper: "Operational follow-through" },
];

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function money(value) {
  const number = Number(value);
  return `GHS ${(Number.isFinite(number) ? number : 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function roleLabel(role) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role;
}

function ToggleSwitch({ checked, disabled, onClick, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick} style={{ width: 52, height: 30, padding: 3, border: 0, borderRadius: 999, background: checked ? "#16a34a" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: checked ? "flex-end" : "flex-start", cursor: disabled ? "not-allowed" : "pointer", transition: "all .18s ease", boxShadow: "inset 0 0 0 1px rgba(15,23,42,.12)", flex: "0 0 auto" }}>
      <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(15,23,42,.22)" }} />
    </button>
  );
}

function buildMessagePack(intelligence, audience) {
  if (!intelligence) return [];
  const spare = intelligence.spare_parts || {};
  const finance = intelligence.installment_finance || {};
  const actions = [...(intelligence.actions || [])].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const urgent = actions.filter((item) => ["critical", "high"].includes(item.severity));
  const range = `${formatDate(intelligence.range?.from)} → ${formatDate(intelligence.range?.to)}`;

  if (audience === "auditor") {
    return [
      { code: "audit-summary", title: "Audit Control Summary", severity: urgent.length ? "high" : "medium", message: `Period ${range}. Spare Parts completed sales are ${money(spare.revenue)} with ${money(spare.payments_received)} collected (${spare.collection_rate ?? 0}%). Installment Finance has ${finance.active_accounts ?? 0} active agreement(s), ${money(finance.outstanding_amount)} outstanding and ${money(finance.overdue_amount)} overdue.`, action: "Confirm the source ledgers, reconciliations and period cut-off before relying on management totals." },
      { code: "audit-exceptions", title: "Exceptions & Unusual Activity", severity: actions.some((item) => item.severity === "critical") ? "critical" : urgent.length ? "high" : "medium", message: `There are ${spare.voided_sales_count ?? 0} voided Spare Parts sale(s), ${finance.reversals_in_period ?? 0} Finance reversal/refund record(s), ${finance.overdue_accounts ?? 0} overdue Finance account(s), and ${finance.critical_risk_accounts ?? 0} critical-risk Finance account(s).`, action: "Trace each exception to the original record, approval, supporting document and final disposition. A signal is not an accusation." },
      { code: "audit-evidence", title: "Evidence the Auditor Should Request", severity: "high", message: `The highest-value review areas are overdue customer balances, high/critical Finance accounts, voided sales, payment reversals and stock pressure (${spare.low_stock_count ?? 0} low-stock; ${spare.out_of_stock_count ?? 0} zero-stock).`, action: "Request supporting receipts, approvals, collection notes, reversal reasons, inventory counts and responsible-user history for sampled cases." },
      { code: "audit-governance", title: "Control Improvement Advice", severity: "medium", message: "The strongest audit posture is independent, evidence-led and exception-focused rather than dependent on summaries alone.", action: "Ensure high-value exceptions receive documented review ownership, resolution dates and independent sign-off." },
      { code: "audit-system", title: "Website / System Audit Advice", severity: "medium", message: "Operational risk also appears where users can leave incomplete customer information, weak evidence or unresolved approvals in the application.", action: "Periodically review user permissions, approval trails, customer-contact completeness, audit logs and notification delivery—not only financial totals." },
    ];
  }

  if (audience === "manager") {
    return [
      { code: "manager-today", title: "What Management Should Do Next", severity: urgent.length ? "high" : "medium", message: `${urgent.length} high/critical action(s) are currently surfaced across Spare Parts and Installment Finance.`, action: urgent.slice(0, 4).map((item) => `${item.title}: ${item.action}`).join(" | ") || "Keep daily reconciliation, collection discipline and stock review active." },
      { code: "manager-cash", title: "Cash & Customer Follow-up", severity: spare.overdue_debt_balance > 0 ? "high" : "medium", message: `${money(spare.overdue_debt_balance)} is overdue in Spare Parts customer debt, while Finance has ${money(finance.overdue_amount)} overdue across ${finance.overdue_accounts ?? 0} account(s).`, action: "Assign named owners to the largest and oldest balances, set follow-up dates and escalate broken promises." },
      { code: "manager-stock", title: "Stock & Sales Protection", severity: spare.out_of_stock_count > 0 ? "high" : "medium", message: `${spare.out_of_stock_count ?? 0} product(s) are at zero stock and ${spare.low_stock_count ?? 0} are at or below the restock threshold.`, action: "Protect fast-moving parts first, check purchase timing and keep the website stock view aligned with physical counts." },
      { code: "manager-finance", title: "Installment Portfolio Discipline", severity: finance.critical_risk_accounts > 0 ? "critical" : finance.high_risk_accounts > 0 ? "high" : "medium", message: `${finance.critical_risk_accounts ?? 0} critical-risk and ${finance.high_risk_accounts ?? 0} high-risk Finance account(s) need controlled follow-up; ${money(finance.due_next_7_days)} is due within seven days.`, action: "Review the largest exposures, confirm contact attempts and record the recovery decision before the next due-date cycle." },
      { code: "manager-system", title: "Website & Process Improvements", severity: "medium", message: "The operating system should continuously make the right action easy: clear alerts, complete customer records, visible approval ownership and fast access to exceptions.", action: "Review dashboard alerts, customer-name/phone completeness, approval queues, search usability and notification delivery with the team each week." },
    ];
  }

  return [
    { code: "executive-snapshot", title: "Executive Snapshot", severity: intelligence.health_score < 65 ? "critical" : intelligence.health_score < 85 ? "high" : "medium", message: `For ${range}, Spare Parts recorded ${money(spare.revenue)} in completed sales and collected ${money(spare.payments_received)} (${spare.collection_rate ?? 0}%). Installment Finance carries ${money(finance.outstanding_amount)} outstanding across ${finance.active_accounts ?? 0} active agreement(s).`, action: "Look at the next four messages together—they explain the cash, risk, unfinished decisions and system improvements behind the headline." },
    { code: "executive-cash", title: "Cash, Collections & Profit Pressure", severity: (spare.overdue_debt_balance > 0 || finance.overdue_amount > 0) ? "high" : "medium", message: `Spare Parts has ${money(spare.overdue_debt_balance)} in overdue customer debt. Finance has ${money(finance.overdue_amount)} overdue, while ${money(finance.due_next_7_days)} is due in the next seven days. Spare Parts estimated revenue less recorded expenses is ${money(spare.estimated_operating_result)}.`, action: "Protect cash first: assign collection owners, escalate old/high-value balances and keep near-term Finance collections visible to management." },
    { code: "executive-risk", title: "Risk & Suspicion Review", severity: urgent.some((item) => item.severity === "critical") ? "critical" : urgent.length ? "high" : "medium", message: `The current control picture includes ${spare.voided_sales_count ?? 0} voided Spare Parts sale(s), ${finance.reversals_in_period ?? 0} Finance reversal/refund record(s), ${finance.high_risk_accounts ?? 0} high-risk and ${finance.critical_risk_accounts ?? 0} critical-risk Finance account(s).`, action: "Ask for evidence and explanations before concluding anything. Where a pattern is unusual, require the responsible user, approval history, original document and resolution to be identified." },
    { code: "executive-decisions", title: "Decisions & Actions Management Should Confirm", severity: urgent.length ? "high" : "medium", message: `${urgent.length ? urgent.slice(0, 4).map((item) => item.title).join(" • ") : "No critical exception is currently surfaced."}`, action: urgent.length ? urgent.slice(0, 4).map((item) => item.action).join(" | ") : "Confirm that stock review, customer collection, Finance monitoring and independent reconciliation are assigned and happening on schedule." },
    { code: "executive-system", title: "Website & Operating-System Improvement", severity: "medium", message: "Business performance depends on the website making control, collection and management action obvious—not merely displaying data.", action: "Management should regularly verify that the dashboard highlights overdue cash and risk, customer records are complete, approval ownership is visible, stock status is trusted and important notifications reach the right people." },
    { code: "executive-governance", title: "What I Would Put on the Boss's Desk", severity: urgent.length ? "high" : "medium", message: `A concise leadership picture: health ${intelligence.health_score ?? 0}/100; Spare Parts stock pressure ${spare.out_of_stock_count ?? 0} zero-stock / ${spare.low_stock_count ?? 0} low-stock; Finance ${finance.overdue_accounts ?? 0} overdue account(s); ${finance.critical_risk_accounts ?? 0} critical-risk account(s).`, action: "Ask three questions: What is costing us cash? Which risk needs a decision today? Which management control must be strengthened before the next review?" },
  ];
}

export default function ExecutiveBusinessIntelligenceSettingsPanel() {
  const [rules, setRules] = useState({});
  const [recipients, setRecipients] = useState([]);
  const [intelligence, setIntelligence] = useState(null);
  const [range, setRange] = useState(defaultRange);
  const [audience, setAudience] = useState("executive");
  const [selectedRoles, setSelectedRoles] = useState(["admin", "auditor"]);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      axiosClient.get("/notifications/rules"),
      axiosClient.get("/group-configuration/executive-intelligence/recipients"),
    ])
      .then(([rulesResponse, recipientsResponse]) => {
        if (!active) return;
        const nextRules = {};
        for (const rule of rulesResponse.data?.rules || []) if (REPORTS.some((report) => report.code === rule.rule_code)) nextRules[rule.rule_code] = rule;
        setRules(nextRules);
        setRecipients(recipientsResponse.data?.recipients || []);
      })
      .catch((requestError) => { if (active) setError(requestError.response?.data?.message || "Could not load executive intelligence settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filteredRecipients = useMemo(() => {
    const query = recipientSearch.trim().toLowerCase();
    if (!query) return recipients;
    return recipients.filter((recipient) => [recipient.name, recipient.username, recipient.role].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [recipients, recipientSearch]);

  const selectedRecipients = useMemo(() => {
    const byId = new Map(recipients.map((recipient) => [Number(recipient.id), recipient]));
    const selected = new Map();
    for (const recipient of recipients) if (selectedRoles.includes(recipient.role)) selected.set(Number(recipient.id), recipient);
    for (const userId of selectedUserIds) { const recipient = byId.get(Number(userId)); if (recipient) selected.set(Number(userId), recipient); }
    return [...selected.values()];
  }, [recipients, selectedRoles, selectedUserIds]);

  const messagePack = useMemo(() => buildMessagePack(intelligence, audience), [intelligence, audience]);
  const urgentActions = useMemo(() => (intelligence?.actions || []).filter((item) => ["critical", "high"].includes(item.severity)), [intelligence]);
  const actionCount = messagePack.length;
  const totalMessages = selectedRecipients.length * actionCount;

  async function refreshRecipients() {
    setLoadingRecipients(true); setError("");
    try { const response = await axiosClient.get("/group-configuration/executive-intelligence/recipients"); setRecipients(response.data?.recipients || []); }
    catch (requestError) { setError(requestError.response?.data?.message || "Could not refresh recipients."); }
    finally { setLoadingRecipients(false); }
  }

  async function analyse() {
    setAnalysing(true); setError(""); setNotice("");
    try {
      const response = await axiosClient.get("/group-configuration/executive-intelligence/preview", { params: { from: range.from, to: range.to }, timeout: 120000 });
      setIntelligence(response.data?.intelligence || null);
      setNotice("Fresh intelligence prepared from the current Spare Parts and Installment Finance records.");
    } catch (requestError) { setError(requestError.response?.data?.message || requestError.message || "Could not prepare executive intelligence."); }
    finally { setAnalysing(false); }
  }

  function toggleRole(role) { setSelectedRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]); }
  function toggleUser(userId) { const id = Number(userId); setSelectedUserIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }

  function prepareDistribution() {
    setError(""); setNotice("");
    if (!intelligence) { setError("Run the deep analysis before distributing the message pack."); return; }
    if (!messagePack.length) { setError("No message pack is available yet."); return; }
    if (!selectedRecipients.length) { setError("Choose at least one recipient role or specific person."); return; }
    setConfirmOpen(true);
  }

  async function distributeMessagePack() {
    if (!messagePack.length || !selectedRecipients.length) return;
    setDispatching(true); setError(""); setNotice("");
    try {
      const severityFor = (item) => item.severity || (intelligence?.actions?.some((action) => action.severity === "critical") ? "critical" : "medium");
      const requests = [];
      for (const recipient of selectedRecipients) {
        for (const item of messagePack) {
          requests.push(axiosClient.post("/notifications/manual", {
            workspace_code: "group",
            target_user_id: Number(recipient.id),
            category: "executive",
            severity: severityFor(item),
            title: item.title,
            message: `${item.message}\n\nRecommended action: ${item.action}\n\nScope: Spare Parts + Installment Finance. This is management intelligence and review guidance; unusual signals are not findings of misconduct.`,
            action_path: item.code === "executive-system" || item.code === "manager-system" || item.code === "audit-system" ? "/users-settings" : item.code.includes("finance") || item.code.includes("risk") ? "/equipment-installment-finance/collections" : "/group-executive-control",
            source_reference: `executive-message-pack:${range.from}:${range.to}:${audience}:${item.code}`,
          }));
        }
      }
      await Promise.all(requests);
      setConfirmOpen(false);
      setNotice(`Message pack distributed successfully: ${messagePack.length} distinct messages × ${selectedRecipients.length} recipient(s) = ${requests.length} notifications.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not distribute the executive message pack.");
    } finally { setDispatching(false); }
  }

  async function updateRule(ruleCode, patch) {
    const rule = rules[ruleCode];
    if (!rule?.id) { setError("This automated reporting rule is not initialised yet."); return; }
    setError("");
    try {
      await axiosClient.patch(`/notifications/rules/${rule.id}`, patch);
      setRules((current) => ({ ...current, [ruleCode]: { ...current[ruleCode], ...patch } }));
      setNotice("Automated reporting settings saved.");
    } catch (requestError) { setError(requestError.response?.data?.message || "Could not update the automated reporting rule."); }
  }

  if (loading) return <section style={{ margin: "0 0 14px", padding: 14, borderRadius: 18, border: "1px solid #dbe3ef", background: "#fff" }}><strong style={{ color: "#07182c" }}>Weekly & Monthly Executive Updates</strong><small style={{ display: "block", marginTop: 4, color: "#64748b" }}>Loading executive intelligence settings…</small></section>;

  return (
    <section style={{ margin: "0 0 14px", padding: 14, borderRadius: 18, border: "1px solid #dbe3ef", background: "#fff", boxShadow: "0 10px 28px rgba(15,23,42,.05)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 280, flex: 1 }}>
          <div style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Executive intelligence centre</div>
          <strong style={{ display: "block", marginTop: 3, color: "#07182c", fontSize: 18 }}>Weekly & Monthly Executive Updates</strong>
          <small style={{ display: "block", marginTop: 4, color: "#64748b", lineHeight: 1.55 }}>Build a message pack for the boss, auditors and management from the live Spare Parts + Installment Finance picture. Messages are targeted, actionable and independent of the scheduled reports.</small>
          {urgentActions[0] ? <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 12, background: urgentActions[0].severity === "critical" ? "#fef2f2" : "#fff7ed", color: "#7c2d12", fontSize: 12, fontWeight: 850 }}>{urgentActions[0].severity.toUpperCase()} · {urgentActions[0].title} — {urgentActions[0].detail}</div> : null}
        </div>
        <button type="button" onClick={() => { setOpen(true); void analyse(); }} style={{ border: 0, borderRadius: 12, padding: "11px 15px", background: "#07182c", color: "#fff", fontWeight: 900, cursor: "pointer" }}>{analysing ? "Preparing…" : "Open Intelligence Centre"}</button>
      </div>

      {open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="executive-intelligence-title" style={{ position: "fixed", inset: 0, zIndex: 5200, background: "rgba(7,24,44,.65)", display: "grid", placeItems: "center", padding: 16 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div style={{ width: "min(1220px,100%)", maxHeight: "94vh", overflow: "auto", borderRadius: 26, background: "#f8fafc", boxShadow: "0 30px 110px rgba(0,0,0,.4)" }}>
            <header style={{ padding: 24, background: "linear-gradient(135deg,#07182c,#12375a)", color: "#fff", borderRadius: "26px 26px 0 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
                <div><div style={{ color: "#f5d76e", fontSize: 10, fontWeight: 900, letterSpacing: ".09em", textTransform: "uppercase" }}>Management intelligence centre</div><h2 id="executive-intelligence-title" style={{ margin: "6px 0 0", fontSize: 28 }}>What is happening, what is risky, and what should management do?</h2><p style={{ margin: "8px 0 0", maxWidth: 900, color: "rgba(255,255,255,.82)", lineHeight: 1.55 }}>Generate one intelligent message pack, inspect each message, choose exactly who receives it, then distribute every message individually. Nothing waits for the weekly/monthly scheduler.</p></div>
                <button type="button" aria-label="Close executive intelligence centre" onClick={() => setOpen(false)} style={{ border: 0, borderRadius: 10, padding: "8px 11px", background: "rgba(255,255,255,.12)", color: "#fff", fontWeight: 900, cursor: "pointer" }}>✕</button>
              </div>
            </header>

            <div style={{ padding: 18, display: "grid", gap: 14 }}>
              <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ color: "#64748b", fontSize: 11, fontWeight: 800 }}>Executive health</span><strong style={{ display: "block", marginTop: 5, color: (intelligence?.health_score ?? 0) < 65 ? "#991b1b" : "#166534", fontSize: 22 }}>{intelligence?.health_score ?? "—"}/100</strong><small style={{ color: "#64748b" }}>{intelligence?.health_label || "Run analysis"}</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ color: "#64748b", fontSize: 11, fontWeight: 800 }}>Spare Parts sales</span><strong style={{ display: "block", marginTop: 5, color: "#07182c", fontSize: 18 }}>{money(intelligence?.spare_parts?.revenue)}</strong><small style={{ color: "#64748b" }}>{intelligence?.spare_parts?.collection_rate ?? 0}% collected</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ color: "#64748b", fontSize: 11, fontWeight: 800 }}>Finance outstanding</span><strong style={{ display: "block", marginTop: 5, color: "#07182c", fontSize: 18 }}>{money(intelligence?.installment_finance?.outstanding_amount)}</strong><small style={{ color: "#64748b" }}>{money(intelligence?.installment_finance?.overdue_amount)} overdue</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ color: "#64748b", fontSize: 11, fontWeight: 800 }}>Message pack</span><strong style={{ display: "block", marginTop: 5, color: "#07182c", fontSize: 22 }}>{actionCount}</strong><small style={{ color: "#64748b" }}>messages × {selectedRecipients.length} recipients = {totalMessages}</small></article>
              </section>

              <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>1 · Analyse</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Choose the period</h3><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 10 }}><label style={{ fontSize: 11, fontWeight: 900, color: "#334155" }}>From<input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, border: "1px solid #dbe3ef", borderRadius: 10, padding: "9px 10px" }} /></label><label style={{ fontSize: 11, fontWeight: 900, color: "#334155" }}>To<input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, border: "1px solid #dbe3ef", borderRadius: 10, padding: "9px 10px" }} /></label></div><button type="button" onClick={analyse} disabled={analysing} style={{ marginTop: 11, width: "100%", border: 0, borderRadius: 11, padding: "10px 12px", background: "#07182c", color: "#fff", fontWeight: 900, cursor: analysing ? "wait" : "pointer" }}>{analysing ? "Analysing live records…" : "Refresh deep analysis"}</button></article>
                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>2 · Audience</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Choose how the message pack should speak</h3><div style={{ display: "grid", gap: 7, marginTop: 10 }}>{AUDIENCES.map((option) => <button key={option.value} type="button" onClick={() => setAudience(option.value)} style={{ textAlign: "left", padding: 11, borderRadius: 13, border: audience === option.value ? "2px solid #07182c" : "1px solid #dbe3ef", background: audience === option.value ? "#fff8dc" : "#fff", cursor: "pointer" }}><strong style={{ display: "block", color: "#07182c" }}>{option.label}</strong><small style={{ display: "block", marginTop: 3, color: "#64748b" }}>{option.helper}</small></button>)}</div></article>
              </section>

              <section style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}><div><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>3 · Message pack</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>These are the individual messages that will be distributed</h3></div><span style={{ color: "#64748b", fontWeight: 800, fontSize: 11 }}>{actionCount} messages prepared</span></div><div style={{ display: "grid", gap: 9, marginTop: 11 }}>{messagePack.map((item, index) => <article key={item.code} style={{ padding: 13, borderRadius: 15, border: "1px solid #e2e8f0", background: item.severity === "critical" ? "#fff7f7" : "#f8fafc" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}><div><strong style={{ color: "#07182c", fontSize: 14 }}>{index + 1}. {item.title}</strong><p style={{ margin: "5px 0 0", color: "#475569", fontSize: 12, lineHeight: 1.5 }}>{item.message}</p></div><span style={{ color: item.severity === "critical" ? "#991b1b" : item.severity === "high" ? "#9a3412" : "#64748b", fontWeight: 900, fontSize: 10, textTransform: "uppercase" }}>{item.severity}</span></div><div style={{ marginTop: 7, padding: "8px 10px", borderRadius: 10, background: "#fff", border: "1px solid #e2e8f0", color: "#334155", fontSize: 12 }}><strong>Recommended action:</strong> {item.action}</div></article>)}</div></section>

              <section style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 14 }}>
                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><div><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>4 · Recipients</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Who should receive the pack?</h3></div><button type="button" onClick={refreshRecipients} disabled={loadingRecipients} style={{ border: "1px solid #dbe3ef", borderRadius: 9, padding: "7px 9px", background: "#fff", color: "#334155", fontWeight: 800 }}>{loadingRecipients ? "…" : "Refresh"}</button></div><div style={{ display: "grid", gap: 7, marginTop: 10 }}>{ROLE_OPTIONS.map((role) => <label key={role.value} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, padding: 10, borderRadius: 12, border: selectedRoles.includes(role.value) ? "2px solid #07182c" : "1px solid #dbe3ef", background: selectedRoles.includes(role.value) ? "#fff8dc" : "#fff", cursor: "pointer" }}><input type="checkbox" checked={selectedRoles.includes(role.value)} onChange={() => toggleRole(role.value)} style={{ marginTop: 3 }} /><span><strong style={{ display: "block", color: "#07182c", fontSize: 12 }}>{role.label}</strong><small style={{ display: "block", marginTop: 3, color: "#64748b" }}>{role.helper}</small></span></label>)}</div><label style={{ display: "block", marginTop: 10, color: "#334155", fontSize: 11, fontWeight: 900 }}>Specific person<input value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Name, username or role" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, border: "1px solid #dbe3ef", borderRadius: 10, padding: "9px 10px" }} /></label><div style={{ marginTop: 8, maxHeight: 190, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>{filteredRecipients.map((recipient) => <label key={recipient.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 9, alignItems: "center", padding: 9, borderBottom: "1px solid #e2e8f0", cursor: "pointer" }}><input type="checkbox" checked={selectedUserIds.includes(Number(recipient.id))} onChange={() => toggleUser(recipient.id)} /><span><strong style={{ display: "block", color: "#07182c", fontSize: 12 }}>{recipient.name}</strong><small style={{ display: "block", marginTop: 2, color: "#64748b" }}>{recipient.username ? `@${recipient.username} · ` : ""}{roleLabel(recipient.role)}</small></span><span style={{ fontSize: 9, fontWeight: 900, color: recipient.phone_available ? "#166534" : "#94a3b8" }}>{recipient.phone_available ? "PHONE" : "NO PHONE"}</span></label>)}{!filteredRecipients.length ? <div style={{ padding: 11, color: "#64748b", fontSize: 12 }}>No matching users.</div> : null}</div><div style={{ marginTop: 9, padding: 10, borderRadius: 11, background: "#f8fafc", color: "#334155", fontSize: 11, fontWeight: 800 }}>Selected recipients: {selectedRecipients.length} · Messages to distribute: {totalMessages}</div></article>

                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>5 · Distribution</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Distribute the message pack</h3><p style={{ margin: "7px 0 0", color: "#64748b", lineHeight: 1.5, fontSize: 12 }}>This is intentionally separate from weekly/monthly automation. One click below first shows a confirmation with the exact number of messages and recipients.</p><button type="button" onClick={prepareDistribution} disabled={!messagePack.length || !selectedRecipients.length || analysing} style={{ marginTop: 12, width: "100%", border: 0, borderRadius: 12, padding: "12px 14px", background: !messagePack.length || !selectedRecipients.length ? "#94a3b8" : "#16a34a", color: "#fff", fontWeight: 950, cursor: !messagePack.length || !selectedRecipients.length ? "not-allowed" : "pointer" }}>Distribute message pack</button><small style={{ display: "block", marginTop: 8, color: "#64748b", lineHeight: 1.45 }}>Every individual message is delivered separately so the recipient can act on one issue without losing the others in a single long paragraph.</small></article>
              </section>

              <section style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>6 · Automated schedule</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Weekly and monthly automation stays separate</h3><div style={{ display: "grid", gap: 9, marginTop: 10 }}>{REPORTS.map((report) => { const rule = rules[report.code]; const enabled = Boolean(Number(rule?.is_enabled)); const roles = String(rule?.target_role || "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => ROLE_OPTIONS.some((item) => item.value === value)); return <article key={report.code} style={{ padding: 12, borderRadius: 14, border: "1px solid #e2e8f0", background: "#f8fafc" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}><div><strong style={{ color: "#07182c" }}>{report.title}</strong><small style={{ display: "block", marginTop: 3, color: "#64748b" }}>{report.description}</small></div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: enabled ? "#166534" : "#64748b", fontSize: 11, fontWeight: 900 }}>{enabled ? "ON" : "OFF"}</span><ToggleSwitch checked={enabled} disabled={!rule?.id} label={`${report.title} ${enabled ? "on" : "off"}`} onClick={() => updateRule(report.code, { is_enabled: !enabled })} /></div></div><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{ROLE_OPTIONS.map((role) => <button key={role.value} type="button" disabled={!rule?.id} onClick={() => { const next = roles.includes(role.value) ? roles.filter((value) => value !== role.value) : [...roles, role.value]; if (next.length) void updateRule(report.code, { target_role: next.join(",") }); }} style={{ border: "1px solid #dbe3ef", borderRadius: 999, padding: "6px 9px", background: roles.includes(role.value) ? "#fff8dc" : "#fff", color: "#334155", fontSize: 11, fontWeight: 800 }}>{roles.includes(role.value) ? "✓ " : ""}{role.label}</button>)}</div></article>; })}</div></section>

              {notice ? <div role="status" style={{ padding: 11, borderRadius: 12, background: "#f0fdf4", color: "#166534", fontWeight: 800 }}>{notice}</div> : null}
              {error ? <div role="alert" style={{ padding: 11, borderRadius: 12, background: "#fef2f2", color: "#991b1b", fontWeight: 800 }}>{error}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" onClick={() => setOpen(false)} style={{ border: "1px solid #dbe3ef", borderRadius: 11, padding: "9px 13px", background: "#fff", color: "#334155", fontWeight: 850, cursor: "pointer" }}>Close</button></div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div role="dialog" aria-modal="true" aria-labelledby="distribution-confirm-title" style={{ position: "fixed", inset: 0, zIndex: 5300, background: "rgba(7,24,44,.72)", display: "grid", placeItems: "center", padding: 20 }}>
          <div style={{ width: "min(620px,100%)", background: "#fff", borderRadius: 22, boxShadow: "0 30px 100px rgba(0,0,0,.4)", padding: 22 }}>
            <div style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Final confirmation</div>
            <h2 id="distribution-confirm-title" style={{ margin: "6px 0 0", color: "#07182c" }}>Distribute this intelligence pack?</h2>
            <p style={{ margin: "8px 0 0", color: "#475569", lineHeight: 1.55 }}>You are about to send <strong>{messagePack.length} different messages</strong> to <strong>{selectedRecipients.length} selected recipient(s)</strong>, for a total of <strong>{totalMessages} notifications</strong>.</p>
            <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}><strong style={{ color: "#07182c" }}>{AUDIENCES.find((item) => item.value === audience)?.label}</strong><ul style={{ margin: "8px 0 0 18px", padding: 0, color: "#475569", lineHeight: 1.6, fontSize: 12 }}>{messagePack.map((item) => <li key={item.code}>{item.title}</li>)}</ul></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 16 }}><button type="button" onClick={() => setConfirmOpen(false)} disabled={dispatching} style={{ border: "1px solid #dbe3ef", borderRadius: 11, padding: "10px 13px", background: "#fff", color: "#334155", fontWeight: 850 }}>Cancel</button><button type="button" onClick={distributeMessagePack} disabled={dispatching} style={{ border: 0, borderRadius: 11, padding: "10px 15px", background: "#16a34a", color: "#fff", fontWeight: 950 }}>{dispatching ? `Sending ${totalMessages} messages…` : `Send ${totalMessages} messages`}</button></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
