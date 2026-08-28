import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const DEFAULTS = { customer_identity_editing_enabled: true, customer_merge_enabled: true };

export default function CustomerFeatureControlsPanel() {
  const { user } = useAuth();
  const [controls, setControls] = useState(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
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
    const next = !Boolean(controls[field]);
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
    <section style={{ margin: "0 0 18px", padding: 20, border: "1px solid #dbe3ef", borderRadius: 24, background: "linear-gradient(135deg,#fff,#f8fafc)", boxShadow: "0 18px 45px rgba(15,23,42,.07)" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: "#a17a00", fontSize: 11, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Admin-only controls</div>
        <h2 style={{ margin: "6px 0 0", color: "#07182c", fontSize: 26 }}>Customer Data Guardrails</h2>
        <p style={{ margin: "7px 0 0", color: "#64748b", lineHeight: 1.5, fontWeight: 650 }}>Turn customer identity editing and customer merging ON or OFF for the selected store. The backend enforces these switches too.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
        {[
          ["customer_identity_editing_enabled", "Customer identity editing", "Controls the Edit Customer Details action on Debts and Customer Statements."],
          ["customer_merge_enabled", "Customer merging", "Controls merge tools in the Debt Desk and Statement emergency review."],
        ].map(([field, label, description]) => {
          const on = Boolean(controls[field]);
          return <div key={field} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "center", padding: 15, border: "1px solid #e2e8f0", borderRadius: 18, background: "#fff" }}>
            <div><strong style={{ display: "block", color: "#07182c" }}>{label}</strong><small style={{ display: "block", marginTop: 5, color: "#64748b", lineHeight: 1.45 }}>{description}</small></div>
            <button type="button" onClick={() => toggle(field, label)} disabled={loading || Boolean(saving)} style={{ minWidth: 82, borderRadius: 999, padding: "9px 13px", border: "1px solid #dbe3ef", background: on ? "#f0fdf4" : "#f1f5f9", color: on ? "#166534" : "#475569", fontWeight: 900, cursor: "pointer" }}>{saving === field ? "Saving…" : on ? "ON" : "OFF"}</button>
          </div>;
        })}
      </div>
      {notice ? <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "#f0fdf4", color: "#166534" }}>{notice}</div> : null}
      {error ? <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "#fef2f2", color: "#991b1b" }}>{error}</div> : null}
    </section>
  );
}
