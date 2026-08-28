import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";

const REPORTS = [
  {
    code: "group.executive.weekly_business_intelligence",
    title: "Weekly Business Intelligence",
    description: "One consolidated management intelligence update after the weekly closing cycle.",
  },
  {
    code: "group.executive.monthly_business_intelligence",
    title: "Monthly Business Intelligence",
    description: "One consolidated management intelligence update for the completed month.",
  },
];

const RECIPIENT_ROLES = [
  { value: "admin", label: "Admins / Boss" },
  { value: "manager", label: "Managers" },
  { value: "auditor", label: "Auditors" },
];

function normaliseRoles(rule) {
  const roles = String(rule?.target_role || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => RECIPIENT_ROLES.some((role) => role.value === value));
  return roles.length ? [...new Set(roles)] : RECIPIENT_ROLES.map((role) => role.value);
}

export default function ExecutiveBusinessIntelligenceSettingsPanel() {
  const [rules, setRules] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    axiosClient
      .get("/notifications/rules")
      .then((response) => {
        if (!active) return;
        const next = {};
        for (const rule of response.data?.rules || []) {
          if (REPORTS.some((item) => item.code === rule.rule_code)) next[rule.rule_code] = rule;
        }
        setRules(next);
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

  async function updateRule(ruleCode, patch, successText) {
    const current = rules[ruleCode];
    if (!current?.id) {
      setError("The executive intelligence rule is not available yet. The production initializer will create it automatically.");
      return;
    }
    setSaving(ruleCode);
    setNotice("");
    setError("");
    try {
      await axiosClient.patch(`/notifications/rules/${current.id}`, patch);
      setRules((state) => ({ ...state, [ruleCode]: { ...state[ruleCode], ...patch } }));
      setNotice(successText);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not update the executive intelligence rule.");
    } finally {
      setSaving("");
    }
  }

  const roleLabelByValue = useMemo(
    () => Object.fromEntries(RECIPIENT_ROLES.map((role) => [role.value, role.label])),
    []
  );

  if (loading) {
    return (
      <section style={{ margin: "18px 0", padding: 20, borderRadius: 20, border: "1px solid #dbe3ef", background: "#fff" }}>
        Loading executive intelligence settings…
      </section>
    );
  }

  return (
    <section style={{ margin: "18px 0", padding: 22, borderRadius: 22, border: "1px solid #dbe3ef", background: "linear-gradient(135deg,#fff,#f8fafc)", boxShadow: "0 18px 45px rgba(15,23,42,.06)" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: "#a17a00", fontSize: 11, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Management intelligence</div>
        <h2 style={{ margin: "6px 0 0", color: "#07182c", fontSize: 26 }}>Weekly & Monthly Executive Updates</h2>
        <p style={{ margin: "7px 0 0", color: "#64748b", lineHeight: 1.5, fontWeight: 650 }}>
          Configure each reporting cycle and choose who should receive it. The scheduler creates one consolidated report for the period and respects the saved recipient roles.
        </p>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {REPORTS.map((report) => {
          const rule = rules[report.code];
          const enabled = Boolean(Number(rule?.is_enabled));
          const smsAllowed = Boolean(Number(rule?.sms_allowed));
          const roles = normaliseRoles(rule);
          return (
            <article key={report.code} style={{ padding: 16, border: "1px solid #e2e8f0", borderRadius: 18, background: "#fff" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "start" }}>
                <div>
                  <strong style={{ display: "block", color: "#07182c", fontSize: 16 }}>{report.title}</strong>
                  <small style={{ display: "block", marginTop: 5, color: "#64748b", lineHeight: 1.45 }}>{report.description}</small>
                </div>
                <button
                  type="button"
                  disabled={!rule?.id || Boolean(saving)}
                  onClick={() => updateRule(report.code, { is_enabled: !enabled }, `${report.title} is now ${!enabled ? "ON" : "OFF"}.`)}
                  style={{ minWidth: 82, borderRadius: 999, padding: "9px 13px", border: "1px solid #dbe3ef", background: enabled ? "#f0fdf4" : "#f1f5f9", color: enabled ? "#166534" : "#475569", fontWeight: 900, cursor: "pointer" }}
                >
                  {enabled ? "ON" : "OFF"}
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ color: "#334155", fontSize: 12, fontWeight: 900, marginBottom: 8 }}>Send to</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {RECIPIENT_ROLES.map((role) => {
                    const checked = roles.includes(role.value);
                    return (
                      <label key={role.value} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 10px", borderRadius: 12, border: "1px solid #dbe3ef", background: checked ? "#fff8dc" : "#f8fafc", color: "#334155", fontWeight: 800, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!rule?.id || Boolean(saving)}
                          onChange={() => {
                            const next = checked ? roles.filter((value) => value !== role.value) : [...roles, role.value];
                            if (!next.length) {
                              setError("Select at least one recipient for each enabled report.");
                              return;
                            }
                            void updateRule(report.code, { target_role: next.join(",") }, `${report.title} recipients updated.`);
                          }}
                        />
                        {roleLabelByValue[role.value]}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginTop: 10, color: "#64748b", fontSize: 12, fontWeight: 700 }}>
                Active recipients are selected roles with an active account and saved phone number. SMS delivery is {smsAllowed ? "enabled" : "disabled"} for this report.
              </div>
            </article>
          );
        })}
      </div>

      {notice ? <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "#f0fdf4", color: "#166534" }}>{notice}</div> : null}
      {error ? <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "#fef2f2", color: "#991b1b" }}>{error}</div> : null}
    </section>
  );
}
