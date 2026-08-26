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

export default function AdminIntelligenceSettings() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const visibleRules = useMemo(
    () => rules.filter((rule) => importantCodes.has(rule.rule_code)),
    [rules]
  );

  async function loadRules() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/notifications/rules");
      setRules(response.data?.rules || []);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Notification controls could not be loaded."
      );
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
      const response = await axiosClient.patch(
        `/notifications/rules/${rule.id}`,
        changes
      );
      setRules((current) =>
        current.map((item) =>
          item.id === rule.id
            ? { ...item, ...(response.data?.rule || changes) }
            : item
        )
      );
      setNotice("Alert setting saved.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The alert setting could not be saved."
      );
    } finally {
      setSavingId(null);
    }
  }

  async function syncNow() {
    setError("");
    setNotice("");
    try {
      await axiosClient.post("/notifications/sync", { workspace_code: "group" });
      setNotice("System intelligence refreshed.");
      await loadRules();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The intelligence refresh could not be started."
      );
    }
  }

  return (
    <section
      style={{
        margin: "0 0 18px",
        padding: "14px 16px",
        border: "1px solid #dbe3ef",
        borderRadius: 18,
        background: "linear-gradient(135deg,#07182c,#0d2f55)",
        color: "#fff",
        boxShadow: "0 14px 34px rgba(7,24,44,.12)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              color: "#e0ba28",
              fontSize: 11,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: ".08em",
            }}
          >
            Management controls
          </div>
          <strong style={{ display: "block", marginTop: 3, fontSize: 18 }}>
            Intelligence & Alerts
          </strong>
          <span style={{ display: "block", marginTop: 3, color: "rgba(255,255,255,.72)", fontSize: 12 }}>
            Automatic management, audit and operational alerts.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            border: "1px solid #e0ba28",
            background: "#e0ba28",
            color: "#07182c",
            borderRadius: 11,
            padding: "10px 14px",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Configure
        </button>
      </div>

      {open ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
            background: "rgba(7,24,44,.5)",
            display: "grid",
            placeItems: "center",
            padding: 18,
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Intelligence and alert controls"
            style={{
              width: "min(760px, 100%)",
              maxHeight: "min(86vh, 760px)",
              overflow: "auto",
              background: "#fff",
              color: "#0f172a",
              borderRadius: 18,
              border: "1px solid #dbe3ef",
              boxShadow: "0 28px 80px rgba(7,24,44,.28)",
              padding: 22,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ color: "#b88910", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>
                  Management controls
                </div>
                <h2 style={{ margin: "5px 0 4px", color: "#0b1f35" }}>
                  Intelligence & Alerts
                </h2>
                <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                  Control important automatic alerts and optional SMS escalation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ border: 0, background: "transparent", fontSize: 24, cursor: "pointer" }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>
              Signed in as {user?.full_name || user?.username || "Administrator"}.
            </div>

            {notice ? (
              <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: "#ecfdf5", color: "#166534", fontWeight: 700 }}>
                {notice}
              </div>
            ) : null}
            {error ? (
              <div style={{ marginTop: 14, padding: 10, borderRadius: 10, background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>
                {error}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, marginTop: 16, marginBottom: 14, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={syncNow}
                style={{ border: "1px solid #cbd5e1", background: "#f8fafc", color: "#0f172a", borderRadius: 10, padding: "9px 12px", fontWeight: 800, cursor: "pointer" }}
              >
                Refresh intelligence now
              </button>
              <span style={{ color: "#64748b", fontSize: 12, alignSelf: "center" }}>
                Automatic refresh continues in the background.
              </span>
            </div>

            {loading ? (
              <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                Loading alert controls…
              </div>
            ) : visibleRules.length === 0 ? (
              <div style={{ padding: 18, borderRadius: 12, background: "#f8fafc", color: "#64748b" }}>
                No intelligence rules are currently available for this account.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {visibleRules.map((rule) => (
                  <article key={rule.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, background: "#f8fafc" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div>
                        <strong style={{ color: "#0b1f35" }}>{rule.rule_name}</strong>
                        <div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>
                          {rule.description || rule.rule_code}
                        </div>
                      </div>
                      <label style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 12, fontWeight: 800 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(rule.is_enabled)}
                          disabled={savingId === rule.id}
                          onChange={(event) => updateRule(rule, { is_enabled: event.target.checked })}
                        />
                        Enabled
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                      <label style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(rule.sms_allowed)}
                          disabled={savingId === rule.id}
                          onChange={(event) => updateRule(rule, { sms_allowed: event.target.checked })}
                        />
                        SMS escalation
                      </label>
                      <select
                        value={rule.target_role || "admin"}
                        disabled={savingId === rule.id}
                        onChange={(event) => updateRule(rule, { target_role: event.target.value })}
                        style={{ border: "1px solid #cbd5e1", borderRadius: 9, padding: "7px 9px", background: "#fff" }}
                      >
                        <option value="admin">Administrators</option>
                        <option value="manager">Managers</option>
                        <option value="auditor">Auditors</option>
                        <option value="accountant">Accountants</option>
                        <option value="site_supervisor">Site supervisors</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        max="43200"
                        value={rule.escalation_minutes ?? 0}
                        disabled={savingId === rule.id}
                        onChange={(event) => updateRule(rule, { escalation_minutes: Number(event.target.value || 0) })}
                        style={{ width: 120, border: "1px solid #cbd5e1", borderRadius: 9, padding: "7px 9px" }}
                        aria-label="Escalation minutes"
                      />
                      <span style={{ alignSelf: "center", fontSize: 12, color: "#64748b" }}>
                        escalation minutes
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
