import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const DEFAULTS = { customer_identity_editing_enabled: true, customer_merge_enabled: true };

function ToggleSwitch({ checked, disabled, onClick }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={checked ? "Turn off" : "Turn on"}
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
      }}
    >
      <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(15,23,42,.22)" }} />
    </button>
  );
}

export default function CustomerFeatureControlsPanel() {
  const { user } = useAuth();
  const [controls, setControls] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    setLoading(true);
    axiosClient.get("/debt-customers/feature-controls")
      .then((response) => { if (active) setControls({ ...DEFAULTS, ...(response.data.controls || {}) }); })
      .catch((requestError) => { if (active) setError(requestError.response?.data?.message || "Could not load customer feature controls."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAdmin]);

  async function toggle(field, label) {
    const next = !controls[field];
    const previous = controls;
    setControls((current) => ({ ...current, [field]: next }));
    setSaving(field); setNotice(""); setError("");
    try {
      const response = await axiosClient.put("/debt-customers/feature-controls", { ...controls, [field]: next });
      setControls({ ...DEFAULTS, ...(response.data.controls || {}) });
      setNotice(`${label} is now ${next ? "ON" : "OFF"}.`);
    } catch (requestError) {
      setControls(previous);
      setError(requestError.response?.data?.message || "Could not update the feature control.");
    } finally { setSaving(""); }
  }

  if (!isAdmin) return null;

  return (
    <section style={{ margin: "0 0 14px", padding: 14, border: "1px solid #dbe3ef", borderRadius: 18, background: "#fff", boxShadow: "0 10px 28px rgba(15,23,42,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#a17a00", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Admin-only controls</div>
          <strong style={{ display: "block", marginTop: 3, color: "#07182c", fontSize: 17 }}>Customer Data Guardrails</strong>
          <small style={{ display: "block", marginTop: 3, color: "#64748b" }}>Customer identity editing and merging controls.</small>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{ border: "1px solid #dbe3ef", borderRadius: 12, padding: "9px 13px", background: "#07182c", color: "#fff", fontWeight: 850, cursor: "pointer" }}
        >
          {loading ? "Loading…" : "Open settings"}
        </button>
      </div>

      {open ? (
        <div role="dialog" aria-modal="true" aria-labelledby="customer-guardrails-title" style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(7,24,44,.58)", display: "grid", placeItems: "center", padding: 20 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div style={{ width: "min(680px, 100%)", maxHeight: "88vh", overflow: "auto", borderRadius: 24, background: "#fff", boxShadow: "0 30px 90px rgba(0,0,0,.35)" }}>
            <div style={{ padding: 22, borderBottom: "1px solid #e2e8f0", background: "linear-gradient(135deg,#07182c,#12375a)", color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ color: "#f5d76e", fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Admin-only controls</div>
                  <h2 id="customer-guardrails-title" style={{ margin: "6px 0 0", fontSize: 24 }}>Customer Data Guardrails</h2>
                  <p style={{ margin: "7px 0 0", color: "rgba(255,255,255,.78)", lineHeight: 1.45 }}>Manage the customer identity and merge safeguards for the selected store.</p>
                </div>
                <button type="button" aria-label="Close customer guardrails" onClick={() => setOpen(false)} style={{ border: 0, borderRadius: 10, padding: "8px 11px", background: "rgba(255,255,255,.12)", color: "#fff", cursor: "pointer", fontWeight: 900 }}>✕</button>
              </div>
            </div>

            <div style={{ padding: 18, display: "grid", gap: 12 }}>
              {[ ["customer_identity_editing_enabled", "Customer identity editing", "Controls the Edit Customer Details action on Debts and Customer Statements."], ["customer_merge_enabled", "Customer merging", "Controls merge tools in the Debt Desk and Statement emergency review."] ].map(([field, label, description]) => {
                const on = Boolean(controls[field]);
                return (
                  <div key={field} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center", padding: 16, border: "1px solid #e2e8f0", borderRadius: 18, background: "#f8fafc" }}>
                    <div>
                      <strong style={{ display: "block", color: "#07182c", fontSize: 15 }}>{label}</strong>
                      <small style={{ display: "block", marginTop: 5, color: "#64748b", lineHeight: 1.45 }}>{description}</small>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ minWidth: 28, fontSize: 11, fontWeight: 900, color: on ? "#166534" : "#64748b" }}>{saving === field ? "…" : on ? "ON" : "OFF"}</span>
                      <ToggleSwitch checked={on} disabled={loading || Boolean(saving)} onClick={() => toggle(field, label)} />
                    </div>
                  </div>
                );
              })}
              {notice ? <div style={{ padding: 10, borderRadius: 12, background: "#f0fdf4", color: "#166534", fontWeight: 750 }}>{notice}</div> : null}
              {error ? <div style={{ padding: 10, borderRadius: 12, background: "#fef2f2", color: "#991b1b", fontWeight: 750 }}>{error}</div> : null}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}><button type="button" onClick={() => setOpen(false)} style={{ border: "1px solid #dbe3ef", borderRadius: 11, padding: "9px 13px", background: "#f8fafc", color: "#334155", fontWeight: 850, cursor: "pointer" }}>Close</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
