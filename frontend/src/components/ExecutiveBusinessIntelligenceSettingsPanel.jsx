import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const REPORTS = [
  {
    code: "group.executive.weekly_business_intelligence",
    title: "Weekly Executive Update",
    description: "A focused weekly intelligence briefing covering Spare Parts and Installment Finance.",
  },
  {
    code: "group.executive.monthly_business_intelligence",
    title: "Monthly Executive Update",
    description: "A focused month-end intelligence briefing covering Spare Parts and Installment Finance.",
  },
];

const AUDIENCES = [
  { value: "executive", label: "Boss / Executive", helper: "Deep business picture, decisions, risk and immediate priorities." },
  { value: "auditor", label: "Auditor", helper: "Evidence, unusual patterns, control signals and review priorities." },
  { value: "manager", label: "Manager", helper: "Simple operational actions and accountable next steps." },
];

const ROLE_OPTIONS = [
  { value: "admin", label: "Boss / Other Admins", helper: "Executive decisions and business direction" },
  { value: "auditor", label: "Auditors", helper: "Control review and independent challenge" },
  { value: "manager", label: "Managers", helper: "Operational follow-through" },
];

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function ToggleSwitch({ checked, disabled, onClick, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 52,
        height: 30,
        padding: 3,
        border: 0,
        borderRadius: 999,
        background: checked ? "#16a34a" : "#94a3b8",
        display: "flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all .18s ease",
        boxShadow: "inset 0 0 0 1px rgba(15,23,42,.12)",
        flex: "0 0 auto",
      }}
    >
      <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(15,23,42,.22)" }} />
    </button>
  );
}

function money(value) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : 0;
  return `GHS ${safe.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function normaliseRoleString(value) {
  const allowed = new Set(ROLE_OPTIONS.map((item) => item.value));
  return String(value || "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter((role) => allowed.has(role));
}

function recipientLabel(recipient) {
  return recipient?.name || recipient?.username || `User #${recipient?.id}`;
}

function roleLabel(role) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || role;
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
        for (const rule of rulesResponse.data?.rules || []) {
          if (REPORTS.some((report) => report.code === rule.rule_code)) {
            nextRules[rule.rule_code] = rule;
          }
        }
        setRules(nextRules);
        setRecipients(recipientsResponse.data?.recipients || []);
      })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.message || "Could not load executive intelligence settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredRecipients = useMemo(() => {
    const query = recipientSearch.trim().toLowerCase();
    if (!query) return recipients;
    return recipients.filter((recipient) => [recipient.name, recipient.username, recipient.role].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [recipients, recipientSearch]);

  const recipientCount = useMemo(() => {
    const chosen = new Set(selectedUserIds.map(Number));
    for (const recipient of recipients) {
      if (selectedRoles.includes(recipient.role)) chosen.add(Number(recipient.id));
    }
    return chosen.size;
  }, [recipients, selectedRoles, selectedUserIds]);

  const urgentActions = (intelligence?.actions || []).filter((item) => ["critical", "high"].includes(item.severity));
  const actions = useMemo(() => [...(intelligence?.actions || [])].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)), [intelligence]);
  const previewMessage = intelligence?.messages?.[audience] || "Run a fresh analysis to prepare the executive message.";

  async function refreshRecipients() {
    setLoadingRecipients(true);
    setError("");
    try {
      const response = await axiosClient.get("/group-configuration/executive-intelligence/recipients");
      setRecipients(response.data?.recipients || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not refresh recipients.");
    } finally {
      setLoadingRecipients(false);
    }
  }

  async function analyse() {
    setAnalysing(true);
    setError("");
    setNotice("");
    try {
      const response = await axiosClient.get("/group-configuration/executive-intelligence/preview", {
        params: { from: range.from, to: range.to },
        timeout: 120000,
      });
      setIntelligence(response.data?.intelligence || null);
      setNotice("Fresh executive intelligence prepared from the live Spare Parts and Installment Finance records.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not prepare executive intelligence.");
    } finally {
      setAnalysing(false);
    }
  }

  function toggleRole(role) {
    setSelectedRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  }

  function toggleUser(userId) {
    const numericId = Number(userId);
    setSelectedUserIds((current) => current.includes(numericId) ? current.filter((id) => id !== numericId) : [...current, numericId]);
  }

  async function dispatchNow() {
    setError("");
    setNotice("");
    if (!intelligence) {
      await analyse();
      return;
    }
    if (!selectedRoles.length && !selectedUserIds.length) {
      setError("Choose at least one role or one specific person before distributing the briefing.");
      return;
    }

    const selectedUserSet = new Set(selectedUserIds.map(Number));
    const roleRecipients = recipients.filter((recipient) => selectedRoles.includes(recipient.role));
    const exactRecipients = recipients.filter((recipient) => selectedUserSet.has(Number(recipient.id)));
    const mergedUsers = new Map();
    [...roleRecipients, ...exactRecipients].forEach((recipient) => mergedUsers.set(Number(recipient.id), recipient));

    if (!mergedUsers.size) {
      setError("The selected recipients are not currently active users.");
      return;
    }

    setDispatching(true);
    try {
      const title = audience === "auditor"
        ? "Chalin 03 Executive Audit Intelligence"
        : audience === "manager"
          ? "Chalin 03 Management Action Intelligence"
          : "Chalin 03 Deep Executive Intelligence";
      const severity = intelligence.actions.some((item) => item.severity === "critical")
        ? "critical"
        : intelligence.actions.some((item) => item.severity === "high")
          ? "high"
          : "medium";

      const requests = [];
      for (const recipient of mergedUsers.values()) {
        requests.push(
          axiosClient.post("/notifications/manual", {
            workspace_code: "group",
            target_user_id: Number(recipient.id),
            category: "executive",
            severity,
            title,
            message: previewMessage,
            action_path: "/group-executive-control",
            source_reference: `executive-intelligence:${range.from}:${range.to}:${audience}`,
          })
        );
      }
      await Promise.all(requests);

      setNotice(`Briefing distributed to ${mergedUsers.size} selected active user(s): ${[...new Set([...roleRecipients.map((recipient) => roleLabel(recipient.role)), ...exactRecipients.map(recipientLabel)])].join(", ")}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not distribute the executive briefing.");
    } finally {
      setDispatching(false);
    }
  }

  async function updateRule(ruleCode, patch) {
    const rule = rules[ruleCode];
    if (!rule?.id) {
      setError("This automated reporting rule is not initialised yet.");
      return;
    }
    setError("");
    try {
      await axiosClient.patch(`/notifications/rules/${rule.id}`, patch);
      setRules((current) => ({ ...current, [ruleCode]: { ...current[ruleCode], ...patch } }));
      setNotice("Automated reporting settings saved.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not update the automated reporting rule.");
    }
  }

  if (loading) {
    return (
      <section style={{ margin: "0 0 14px", padding: 14, borderRadius: 18, border: "1px solid #dbe3ef", background: "#fff" }}>
        <strong style={{ color: "#07182c" }}>Weekly & Monthly Executive Updates</strong>
        <small style={{ display: "block", marginTop: 4, color: "#64748b" }}>Loading executive intelligence settings…</small>
      </section>
    );
  }

  return (
    <section style={{ margin: "0 0 14px", padding: 14, borderRadius: 18, border: "1px solid #dbe3ef", background: "#fff", boxShadow: "0 10px 28px rgba(15,23,42,.05)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 280, flex: 1 }}>
          <div style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Executive intelligence centre</div>
          <strong style={{ display: "block", marginTop: 3, color: "#07182c", fontSize: 18 }}>Weekly & Monthly Executive Updates</strong>
          <small style={{ display: "block", marginTop: 4, color: "#64748b", lineHeight: 1.55 }}>High-depth, plain-English intelligence for <strong>Spare Parts</strong> and <strong>Installment Finance</strong>: money, collections, stock pressure, risk, unusual control signals and the actions management should take.</small>
          {urgentActions[0] ? <div style={{ marginTop: 10, padding: "9px 11px", borderRadius: 12, background: urgentActions[0].severity === "critical" ? "#fef2f2" : "#fff7ed", color: "#7c2d12", fontSize: 12, fontWeight: 850 }}>{urgentActions[0].severity.toUpperCase()} · {urgentActions[0].title} — {urgentActions[0].detail}</div> : null}
        </div>
        <button type="button" onClick={() => { setOpen(true); void analyse(); }} style={{ border: 0, borderRadius: 12, padding: "11px 15px", background: "#07182c", color: "#fff", fontWeight: 900, cursor: "pointer" }}>{analysing ? "Preparing…" : "Open Intelligence Centre"}</button>
      </div>

      {open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="executive-intelligence-title" style={{ position: "fixed", inset: 0, zIndex: 5200, background: "rgba(7,24,44,.64)", display: "grid", placeItems: "center", padding: 16 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div style={{ width: "min(1180px,100%)", maxHeight: "94vh", overflow: "auto", borderRadius: 26, background: "#f8fafc", boxShadow: "0 30px 110px rgba(0,0,0,.4)" }}>
            <header style={{ padding: 24, background: "linear-gradient(135deg,#07182c,#12375a)", color: "#fff", borderRadius: "26px 26px 0 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
                <div>
                  <div style={{ color: "#f5d76e", fontSize: 10, fontWeight: 900, letterSpacing: ".09em", textTransform: "uppercase" }}>Management intelligence centre</div>
                  <h2 id="executive-intelligence-title" style={{ margin: "6px 0 0", fontSize: 28 }}>What is really happening in the business?</h2>
                  <p style={{ margin: "8px 0 0", maxWidth: 830, color: "rgba(255,255,255,.8)", lineHeight: 1.55 }}>One screen for the boss, audit and management. Generate a fresh picture whenever needed, decide who should receive it, and distribute the exact briefing without waiting for the weekly or monthly schedule.</p>
                </div>
                <button type="button" aria-label="Close executive intelligence centre" onClick={() => setOpen(false)} style={{ border: 0, borderRadius: 10, padding: "8px 11px", background: "rgba(255,255,255,.12)", color: "#fff", fontWeight: 900, cursor: "pointer" }}>✕</button>
              </div>
            </header>

            <div style={{ padding: 18, display: "grid", gap: 14 }}>
              <section style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800 }}>Executive health</span><strong style={{ display: "block", marginTop: 5, color: intelligence?.health_score < 65 ? "#991b1b" : "#166534", fontSize: 22 }}>{intelligence?.health_score ?? "—"}/100</strong><small style={{ color: "#64748b" }}>{intelligence?.health_label || "Run analysis"}</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800 }}>Spare Parts sales</span><strong style={{ display: "block", marginTop: 5, color: "#07182c", fontSize: 18 }}>{money(intelligence?.spare_parts?.revenue)}</strong><small style={{ color: "#64748b" }}>{intelligence?.spare_parts?.collection_rate ?? 0}% collected</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800 }}>Finance outstanding</span><strong style={{ display: "block", marginTop: 5, color: "#07182c", fontSize: 18 }}>{money(intelligence?.installment_finance?.outstanding_amount)}</strong><small style={{ color: "#64748b" }}>{money(intelligence?.installment_finance?.overdue_amount)} overdue</small></article>
                <article style={{ padding: 14, borderRadius: 16, background: "#fff", border: "1px solid #e2e8f0" }}><span style={{ display: "block", color: "#64748b", fontSize: 11, fontWeight: 800 }}>Urgent review</span><strong style={{ display: "block", marginTop: 5, color: urgentActions.length ? "#991b1b" : "#166534", fontSize: 18 }}>{urgentActions.length}</strong><small style={{ color: "#64748b" }}>high / critical items</small></article>
              </section>

              <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>1 · Period & analysis</span>
                  <h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Ask the system what is happening now</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 10 }}>
                    <label style={{ fontSize: 11, fontWeight: 900, color: "#334155" }}>From<input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, border: "1px solid #dbe3ef", borderRadius: 10, padding: "9px 10px" }} /></label>
                    <label style={{ fontSize: 11, fontWeight: 900, color: "#334155" }}>To<input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, border: "1px solid #dbe3ef", borderRadius: 10, padding: "9px 10px" }} /></label>
                  </div>
                  <button type="button" onClick={analyse} disabled={analysing} style={{ marginTop: 11, width: "100%", border: "1px solid #dbe3ef", borderRadius: 11, padding: "10px 12px", background: "#07182c", color: "#fff", fontWeight: 900, cursor: analysing ? "wait" : "pointer" }}>{analysing ? "Analysing live records…" : "Refresh deep analysis"}</button>
                  <div style={{ marginTop: 10, padding: 11, borderRadius: 13, background: "#f8fafc", color: "#475569", fontSize: 12, lineHeight: 1.55 }}><strong style={{ color: "#07182c" }}>Scope is locked:</strong> this intelligence engine is intentionally limited to Spare Parts and Installment Finance. Mining, Hire and unrelated divisions are excluded.</div>
                </article>

                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>2 · Recipient type</span>
                  <h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Change the briefing language</h3>
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>{AUDIENCES.map((option) => <button key={option.value} type="button" onClick={() => setAudience(option.value)} style={{ textAlign: "left", padding: 12, borderRadius: 14, border: audience === option.value ? "2px solid #07182c" : "1px solid #dbe3ef", background: audience === option.value ? "#fff8dc" : "#fff", cursor: "pointer" }}><strong style={{ display: "block", color: "#07182c" }}>{option.label}</strong><small style={{ display: "block", marginTop: 4, color: "#64748b", lineHeight: 1.45 }}>{option.helper}</small></button>)}</div>
                </article>
              </section>

              <section style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 14 }}>
                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><div><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>3 · Who receives it?</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Choose roles or exact people</h3></div><button type="button" onClick={refreshRecipients} disabled={loadingRecipients} style={{ border: "1px solid #dbe3ef", borderRadius: 9, padding: "7px 9px", background: "#fff", color: "#334155", fontWeight: 800 }}>{loadingRecipients ? "…" : "Refresh"}</button></div>
                  <div style={{ display: "grid", gap: 7, marginTop: 10 }}>{ROLE_OPTIONS.map((role) => <label key={role.value} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start", padding: 10, borderRadius: 12, border: selectedRoles.includes(role.value) ? "2px solid #07182c" : "1px solid #dbe3ef", background: selectedRoles.includes(role.value) ? "#fff8dc" : "#fff", cursor: "pointer" }}><input type="checkbox" checked={selectedRoles.includes(role.value)} onChange={() => toggleRole(role.value)} style={{ marginTop: 3 }} /><span><strong style={{ display: "block", color: "#07182c", fontSize: 12 }}>{role.label}</strong><small style={{ display: "block", marginTop: 3, color: "#64748b" }}>{role.helper}</small></span></label>)}</div>
                  <label style={{ display: "block", marginTop: 11, fontSize: 11, fontWeight: 900, color: "#334155" }}>Find a specific person<input value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Name, username or role" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 5, border: "1px solid #dbe3ef", borderRadius: 10, padding: "9px 10px" }} /></label>
                  <div style={{ marginTop: 8, maxHeight: 220, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc" }}>
                    {filteredRecipients.map((recipient) => <label key={recipient.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 9, alignItems: "center", padding: 9, borderBottom: "1px solid #e2e8f0", cursor: "pointer" }}><input type="checkbox" checked={selectedUserIds.includes(Number(recipient.id))} onChange={() => toggleUser(recipient.id)} /><span><strong style={{ display: "block", color: "#07182c", fontSize: 12 }}>{recipientLabel(recipient)}</strong><small style={{ display: "block", marginTop: 2, color: "#64748b" }}>{recipient.username ? `@${recipient.username} · ` : ""}{roleLabel(recipient.role)}</small></span><span style={{ fontSize: 9, fontWeight: 900, color: recipient.phone_available ? "#166534" : "#94a3b8" }}>{recipient.phone_available ? "PHONE" : "NO PHONE"}</span></label>)}
                    {!filteredRecipients.length ? <div style={{ padding: 12, color: "#64748b", fontSize: 12 }}>No active matching users.</div> : null}
                  </div>
                  <div style={{ marginTop: 9, padding: 10, borderRadius: 11, background: "#f8fafc", color: "#334155", fontSize: 11, fontWeight: 800 }}>Estimated active recipients: {recipientCount}. Role selections and exact-user selections are de-duplicated.</div>
                </article>

                <article style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><div><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>4 · Preview & distribute</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Make sure the message is right before it goes out</h3></div><span style={{ fontSize: 11, fontWeight: 900, color: "#64748b" }}>{formatDate(range.from)} → {formatDate(range.to)}</span></div>
                  <div style={{ marginTop: 10, padding: 14, borderRadius: 16, background: "#07182c", color: "#fff", minHeight: 210 }}>
                    <div style={{ color: "#f5d76e", fontSize: 10, fontWeight: 900, letterSpacing: ".07em", textTransform: "uppercase" }}>{AUDIENCES.find((option) => option.value === audience)?.label} briefing</div>
                    <p style={{ margin: "9px 0 0", fontSize: 12, lineHeight: 1.65, color: "rgba(255,255,255,.9)" }}>{previewMessage}</p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}><button type="button" onClick={analyse} disabled={analysing} style={{ border: "1px solid #dbe3ef", borderRadius: 11, padding: "10px 11px", background: "#fff", color: "#07182c", fontWeight: 900 }}>{analysing ? "Preparing…" : "Refresh preview"}</button><button type="button" onClick={dispatchNow} disabled={dispatching || analysing} style={{ border: 0, borderRadius: 11, padding: "10px 11px", background: dispatching ? "#94a3b8" : "#16a34a", color: "#fff", fontWeight: 950, cursor: dispatching ? "wait" : "pointer" }}>{dispatching ? "Distributing…" : "Distribute now"}</button></div>
                  <small style={{ display: "block", marginTop: 7, color: "#64748b", lineHeight: 1.45 }}>This distribution is independent of the scheduled weekly/monthly automated messages. Every recipient receives an individual notification and the dispatch uses the selected audience language.</small>
                </article>
              </section>

              <section style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><div><span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>5 · What needs attention</span><h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Explain the business in decisions, not raw numbers</h3></div><span style={{ color: "#64748b", fontSize: 11, fontWeight: 800 }}>{actions.length} active intelligence signal(s)</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9, marginTop: 11 }}>{actions.map((action, index) => <article key={`${action.title}-${index}`} style={{ padding: 12, borderRadius: 14, border: "1px solid #e2e8f0", background: action.severity === "critical" ? "#fff7f7" : "#f8fafc" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong style={{ color: "#07182c", fontSize: 13 }}>{action.title}</strong><span style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", color: action.severity === "critical" ? "#991b1b" : action.severity === "high" ? "#9a3412" : "#64748b" }}>{action.severity}</span></div><p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 12, lineHeight: 1.45 }}>{action.detail}</p><p style={{ margin: "6px 0 0", color: "#334155", fontSize: 12, lineHeight: 1.45 }}><strong>Do:</strong> {action.action}</p></article>)}</div>
              </section>

              <section style={{ padding: 16, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0" }}>
                <span style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>6 · Automated reporting</span>
                <h3 style={{ margin: "5px 0 0", color: "#07182c" }}>Scheduled updates can be controlled independently</h3>
                <div style={{ display: "grid", gap: 9, marginTop: 10 }}>{REPORTS.map((report) => {
                  const rule = rules[report.code];
                  const enabled = Boolean(Number(rule?.is_enabled));
                  const roles = normaliseRoleString(rule?.target_role);
                  return <article key={report.code} style={{ padding: 12, borderRadius: 14, border: "1px solid #e2e8f0", background: "#f8fafc" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><strong style={{ display: "block", color: "#07182c" }}>{report.title}</strong><small style={{ display: "block", marginTop: 3, color: "#64748b" }}>{report.description}</small></div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 11, fontWeight: 900, color: enabled ? "#166534" : "#64748b" }}>{enabled ? "ON" : "OFF"}</span><ToggleSwitch checked={enabled} disabled={!rule?.id} label={`${report.title} ${enabled ? "on" : "off"}`} onClick={() => updateRule(report.code, { is_enabled: !enabled })} /></div></div><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{ROLE_OPTIONS.map((role) => <button key={role.value} type="button" disabled={!rule?.id} onClick={() => { const next = roles.includes(role.value) ? roles.filter((value) => value !== role.value) : [...roles, role.value]; if (!next.length) return; void updateRule(report.code, { target_role: next.join(",") }); }} style={{ border: "1px solid #dbe3ef", borderRadius: 999, padding: "6px 9px", background: roles.includes(role.value) ? "#fff8dc" : "#fff", color: "#334155", fontSize: 11, fontWeight: 800, cursor: rule?.id ? "pointer" : "not-allowed" }}>{roles.includes(role.value) ? "✓ " : ""}{role.label}</button>)}</div></article>;
                })}</div>
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
