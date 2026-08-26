import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import CustomerFeatureControlsPanel from "../components/CustomerFeatureControlsPanel";
import UsersSettingsPage from "./UsersSettingsPage";

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

function IntelligenceControls() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const visibleRules = useMemo(
    () => rules.filter((rule) => IMPORTANT_RULES.has(rule.rule_code)),
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

  async function saveRule(rule, changes) {
    setSavingId(rule.id);
    setMessage("");
    setError("");
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
      setMessage("Alert setting saved.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The alert setting could not be saved."
      );
    } finally {
      setSavingId(null);
    }
  }

  async function refreshNow() {
    setMessage("");
    setError("");
    try {
      await axiosClient.post("/notifications/sync", { workspace_code: "group" });
      setMessage("System intelligence refreshed.");
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
        padding: 18,
        borderRadius: 22,
        border: "1px solid #dbe3ef",
        background:
          "linear-gradient(135deg, #07182c 0%, #0d2f55 62%, #111827 100%)",
        color: "#fff",
        boxShadow: "0 18px 45px rgba(7,24,44,.14)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              color: "#e0ba28",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: ".1em",
              textTransform: "uppercase",
            }}
          >
            Management controls
          </div>
          <h2 style={{ margin: "4px 0 4px", fontSize: 22, color: "#fff" }}>
            Intelligence & Alerts
          </h2>
          <p style={{ margin: 0, color: "rgba(255,255,255,.72)", fontSize: 13 }}>
            Automatic management, audit and operational alerts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          style={{
            border: "1px solid #e0ba28",
            borderRadius: 12,
            padding: "10px 15px",
            background: "#e0ba28",
            color: "#07182c",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          {open ? "Close" : "Configure"}
        </button>
      </div>

      {open ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,.14)",
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              onClick={refreshNow}
              style={{
                border: "1px solid rgba(255,255,255,.24)",
                borderRadius: 10,
                padding: "8px 12px",
                background: "rgba(255,255,255,.08)",
                color: "#fff",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Refresh intelligence now
            </button>
            <span style={{ alignSelf: "center", color: "rgba(255,255,255,.62)", fontSize: 12 }}>
              Automatic checks continue in the background.
            </span>
          </div>

          {message ? (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "#ecfdf5", color: "#166534", fontWeight: 800 }}>
              {message}
            </div>
          ) : null}
          {error ? (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "#fef2f2", color: "#991b1b", fontWeight: 800 }}>
              {error}
            </div>
          ) : null}

          {loading ? (
            <div style={{ padding: 16, textAlign: "center", color: "rgba(255,255,255,.72)" }}>
              Loading alert controls…
            </div>
          ) : visibleRules.length === 0 ? (
            <div style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,.07)", color: "rgba(255,255,255,.74)" }}>
              No alert rules are available for configuration yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {visibleRules.map((rule) => (
                <div
                  key={rule.id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: "#fff",
                    color: "#0f172a",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <strong style={{ color: "#07182c" }}>{rule.rule_name}</strong>
                      <div style={{ marginTop: 3, color: "#64748b", fontSize: 12 }}>
                        {rule.description || rule.rule_code}
                      </div>
                    </div>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 800 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(rule.is_enabled)}
                        disabled={savingId === rule.id}
                        onChange={(event) =>
                          saveRule(rule, { is_enabled: event.target.checked })
                        }
                      />
                      Enabled
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 750 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(rule.sms_allowed)}
                        disabled={savingId === rule.id}
                        onChange={(event) =>
                          saveRule(rule, { sms_allowed: event.target.checked })
                        }
                      />
                      SMS escalation
                    </label>

                    <select
                      value={rule.target_role || "admin"}
                      disabled={savingId === rule.id}
                      onChange={(event) =>
                        saveRule(rule, { target_role: event.target.value })
                      }
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
                      onChange={(event) =>
                        saveRule(rule, {
                          escalation_minutes: Number(event.target.value || 0),
                        })
                      }
                      style={{ width: 130, border: "1px solid #cbd5e1", borderRadius: 9, padding: "7px 9px" }}
                      aria-label="Escalation minutes"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default function UsersSettingsControlRoomPage() {
  return (
    <>
      <CustomerFeatureControlsPanel />
      <IntelligenceControls />
      <UsersSettingsPage />
    </>
  );
}
