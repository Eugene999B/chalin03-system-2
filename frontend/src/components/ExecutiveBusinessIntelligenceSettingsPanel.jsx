import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const REPORTS = [
  { code: "group.executive.weekly_business_intelligence", title: "Weekly Business Intelligence", description: "One consolidated management intelligence update after the weekly closing cycle." },
  { code: "group.executive.monthly_business_intelligence", title: "Monthly Business Intelligence", description: "One consolidated management intelligence update for the completed month." },
];
const RECIPIENT_ROLES = [
  { value: "admin", label: "Admins / Boss" },
  { value: "manager", label: "Managers" },
  { value: "auditor", label: "Auditors" },
];
function normaliseRoles(rule) {
  const roles = String(rule?.target_role || "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => RECIPIENT_ROLES.some((role) => role.value === value));
  return roles.length ? [...new Set(roles)] : RECIPIENT_ROLES.map((role) => role.value);
}
function ToggleSwitch({ checked, disabled, onClick, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onClick} style={{ width: 52, height: 30, padding: 3, border: 0, borderRadius: 999, background: checked ? "#16a34a" : "#94a3b8", display: "flex", alignItems: "center", justifyContent: checked ? "flex-end" : "flex-start", cursor: disabled ? "not-allowed" : "pointer", transition: "all .18s ease", boxShadow: "inset 0 0 0 1px rgba(15,23,42,.12)" }}><span style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(15,23,42,.22)" }} /></button>;
}

export default function ExecutiveBusinessIntelligenceSettingsPanel() {
  const [rules, setRules] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    axiosClient.get("/notifications/rules").then((response) => {
      if (!active) return;
      const next = {};
      for (const rule of response.data?.rules || []) if (REPORTS.some((item) => item.code === rule.rule_code)) next[rule.rule_code] = rule;
      setRules(next);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || "Could not load executive intelligence settings.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function updateRule(ruleCode, patch, successText) {
    const current = rules[ruleCode];
    if (!current?.id) { setError("The executive intelligence rule is not available yet. The production initializer will create it automatically."); return; }
    setSaving(ruleCode); setNotice(""); setError("");
    try {
      await axiosClient.patch(`/notifications/rules/${current.id}`, patch);
      setRules((state) => ({ ...state, [ruleCode]: { ...state[ruleCode], ...patch } }));
      setNotice(successText);
    } catch (requestError) { setError(requestError.response?.data?.message || "Could not update the executive intelligence rule."); }
    finally { setSaving(""); }
  }

  const roleLabelByValue = useMemo(() => Object.fromEntries(RECIPIENT_ROLES.map((role) => [role.value, role.label])), []);
  if (loading) return <section style={{ margin: "0 0 14px", padding: 14, borderRadius: 18, border: "1px solid #dbe3ef", background: "#fff" }}>Loading executive intelligence settings…</section>;

  return (
    <section style={{ margin: "0 0 14px", padding: 14, borderRadius: 18, border: "1px solid #dbe3ef", background: "#fff", boxShadow: "0 10px 28px rgba(15,23,42,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Management intelligence</div>
          <strong style={{ display: "block", marginTop: 3, color: "#07182c", fontSize: 17 }}>Weekly & Monthly Executive Updates</strong>
          <small style={{ display: "block", marginTop: 3, color: "#64748b" }}>Reporting cycles, recipients and delivery settings.</small>
        </div>
        <button type="button" onClick={() => setOpen(true)} style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: "9px 13px", background: "#07182c", color: "#fff", fontWeight: 850, cursor: "pointer" }}>Open settings</button>
      </div>

      {open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="executive-updates-title" style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(7,24,44,.58)", display: "grid", placeItems: "center", padding: 20 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div style={{ width: "min(760px, 100%)", maxHeight: "88vh", overflow: "auto", borderRadius: 24, background: "#fff", boxShadow: "0 30px 90px rgba(0,0,0,.35)" }}>
            <div style={{ padding: 22, borderBottom: "1px solid #e2e8f0", background: "linear-gradient(135deg,#07182c,#12375a)", color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div><div style={{ color: "#f5d76e", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Management intelligence</div><h2 id="executive-updates-title" style={{ margin: "6px 0 0", fontSize: 24 }}>Weekly & Monthly Executive Updates</h2><p style={{ margin: "7px 0 0", color: "rgba(255,255,255,.78)", lineHeight: 1.45 }}>Enable or disable each reporting cycle and choose the roles that receive it.</p></div>
                <button type="button" aria-label="Close executive updates" onClick={() => setOpen(false)} style={{ border: 0, borderRadius: 10, padding: "8px 11px", background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", fontWeight: 900 }}>✕</button>
              </div>
            </div>
            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              {REPORTS.map((report) => {
                const rule = rules[report.code]; const enabled = Boolean(Number(rule?.is_enabled)); const smsAllowed = Boolean(Number(rule?.sms_allowed)); const roles = normaliseRoles(rule);
                return <article key={report.code} style={{ padding: 16, border: "1px solid #e2e8f0", borderRadius: 18, background: "#f8fafc" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                    <div><strong style={{ display: "block", color: "#07182c", fontSize: 16 }}>{report.title}</strong><small style={{ display: "block", marginTop: 5, color: "#64748b", lineHeight: 1.45 }}>{report.description}</small></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 900, color: enabled ? "#166534" : "#64748b" }}>{saving === report.code ? "Saving…" : enabled ? "ON" : "OFF"}</span><ToggleSwitch checked={enabled} disabled={!rule?.id || Boolean(saving)} label={`${report.title} ${enabled ? "on" : "off"}`} onClick={() => updateRule(report.code, { is_enabled: !enabled }, `${report.title} is now ${!enabled ? "ON" : "OFF"}.`)} /></div>
                  </div>
                  <div style={{ marginTop: 14 }}><div style={{ color: "#334155", fontSize: 12, fontWeight: 900, marginBottom: 8 }}>Send to</div><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{RECIPIENT_ROLES.map((role) => { const checked = roles.includes(role.value); return <label key={role.value} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 10px", borderRadius: 12, border: "1px solid #dbe3ef", background: checked ? "#fff8dc" : "#fff", color: "#334155", fontWeight: 800, cursor: "pointer" }}><input type="checkbox" checked={checked} disabled={!rule?.id || Boolean(saving)} onChange={() => { const next = checked ? roles.filter((value) => value !== role.value) : [...roles, role.value]; if (!next.length) { setError("Select at least one recipient for each enabled report."); return; } void updateRule(report.code, { target_role: next.join(",") }, `${report.title} recipients updated.`); }} />{roleLabelByValue[role.value]}</label>; })}</div></div>
                  <div style={{ marginTop: 10, color: "#64748b", fontSize: 12, fontWeight: 700 }}>Active recipients use selected roles with active accounts and saved phone numbers. SMS delivery is {smsAllowed ? "enabled" : "disabled"} for this report.</div>
                </article>;
              })}
              {notice ? <div style={{ padding: 10, borderRadius: 12, background: "#f0fdf4", color: "#166534", fontWeight: 750 }}>{notice}</div> : null}
              {error ? <div style={{ padding: 10, borderRadius: 12, background: "#fef2f2", color: "#991b1b", fontWeight: 750 }}>{error}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" onClick={() => setOpen(false)} style={{ border: "1px solid #dbe3ef", borderRadius: 11, padding: "9px 13px", background: "#f8fafc", color: "#334155", fontWeight: 850, cursor: "pointer" }}>Close</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
