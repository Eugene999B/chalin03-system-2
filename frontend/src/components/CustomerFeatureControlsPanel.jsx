import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const DEFAULT_CONTROLS = {
  customer_identity_editing_enabled: true,
  customer_merge_enabled: true,
};

export default function CustomerFeatureControlsPanel() {
  const [controls, setControls] = useState(DEFAULT_CONTROLS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadControls() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/debt-customers/feature-controls");
      setControls({ ...DEFAULT_CONTROLS, ...(response.data.controls || {}) });
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not load customer data feature controls."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadControls();
  }, []);

  async function toggleControl(field) {
    const nextValue = !Boolean(controls[field]);
    const previousControls = controls;
    setControls((current) => ({ ...current, [field]: nextValue }));
    setSaving(field);
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.put("/debt-customers/feature-controls", {
        ...controls,
        [field]: nextValue,
      });
      setControls({ ...DEFAULT_CONTROLS, ...(response.data.controls || {}) });
      setMessage(
        field === "customer_identity_editing_enabled"
          ? `Customer identity editing is now ${nextValue ? "ON" : "OFF"}.`
          : `Customer merging is now ${nextValue ? "ON" : "OFF"}.`
      );
    } catch (requestError) {
      setControls(previousControls);
      setError(
        requestError.response?.data?.message ||
          "Could not update the customer data feature control."
      );
    } finally {
      setSaving("");
    }
  }

  return (
    <section className="customer-feature-controls">
      <style>{`
        .customer-feature-controls {
          margin: 0 0 18px;
          padding: 20px;
          border: 1px solid #dbe3ef;
          border-radius: 28px;
          background: radial-gradient(circle at 5% 0%, rgba(224,186,40,0.14), transparent 28%), linear-gradient(135deg, #ffffff, #f8fafc);
          box-shadow: 0 22px 56px rgba(15, 23, 42, 0.07);
        }
        .customer-feature-controls__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 15px; }
        .customer-feature-controls__kicker { display: block; margin-bottom: 6px; color: #a17a00; font-size: 10px; font-weight: 950; letter-spacing: .1em; text-transform: uppercase; }
        .customer-feature-controls h2 { margin: 0; color: #07182c; font-size: clamp(22px, 3vw, 30px); line-height: 1; letter-spacing: -.04em; font-weight: 950; }
        .customer-feature-controls p { max-width: 760px; margin: 8px 0 0; color: #64748b; line-height: 1.5; font-weight: 750; }
        .customer-feature-controls__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .customer-feature-controls__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 15px; border: 1px solid #e2e8f0; border-radius: 20px; background: #fff; }
        .customer-feature-controls__item strong { display: block; color: #07182c; font-size: 15px; font-weight: 950; }
        .customer-feature-controls__item small { display: block; margin-top: 5px; color: #64748b; line-height: 1.45; font-weight: 750; }
        .customer-feature-controls__toggle { min-width: 92px; min-height: 42px; padding: 9px 12px; border: 1px solid #dbe3ef; border-radius: 999px; background: #f1f5f9; color: #475569; font-weight: 950; cursor: pointer; }
        .customer-feature-controls__toggle.is-on { border-color: #86efac; background: #f0fdf4; color: #166534; }
        .customer-feature-controls__toggle:disabled { opacity: .6; cursor: wait; }
        .customer-feature-controls__notice { margin-top: 12px; padding: 10px 12px; border-radius: 14px; font-weight: 850; }
        .customer-feature-controls__notice.is-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
        .customer-feature-controls__notice.is-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
        @media (max-width: 760px) { .customer-feature-controls { padding: 15px; border-radius: 22px; } .customer-feature-controls__head { display: block; } .customer-feature-controls__grid { grid-template-columns: 1fr; } }
      `}</style>
      <div className="customer-feature-controls__head">
        <div>
          <span className="customer-feature-controls__kicker">Admin-only controls</span>
          <h2>Customer Data Guardrails</h2>
          <p>
            Enable or disable customer identity editing and duplicate-customer merge tools throughout the Spare Parts workspace. The server enforces these switches too.
          </p>
        </div>
      </div>
      <div className="customer-feature-controls__grid">
        <div className="customer-feature-controls__item">
          <div>
            <strong>Customer identity editing</strong>
            <small>Controls the Edit Customer Details tools on Debts and Customer Statements. The edit API remains protected when this is OFF.</small>
          </div>
          <button type="button" className={`customer-feature-controls__toggle ${controls.customer_identity_editing_enabled ? "is-on" : ""}`} onClick={() => toggleControl("customer_identity_editing_enabled")} disabled={loading || Boolean(saving)}>
            {saving === "customer_identity_editing_enabled" ? "Saving…" : controls.customer_identity_editing_enabled ? "ON" : "OFF"}
          </button>
        </div>
        <div className="customer-feature-controls__item">
          <div>
            <strong>Customer merging</strong>
            <small>Controls merge tools in the Debt Desk, Customer Statement and emergency review. The backend blocks merge requests while OFF.</small>
          </div>
          <button type="button" className={`customer-feature-controls__toggle ${controls.customer_merge_enabled ? "is-on" : ""}`} onClick={() => toggleControl("customer_merge_enabled")} disabled={loading || Boolean(saving)}>
            {saving === "customer_merge_enabled" ? "Saving…" : controls.customer_merge_enabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>
      {loading ? <div className="customer-feature-controls__notice">Loading the current store controls…</div> : null}
      {message ? <div className="customer-feature-controls__notice is-success">{message}</div> : null}
      {error ? <div className="customer-feature-controls__notice is-error">{error}</div> : null}
    </section>
  );
}
