import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const CARD = {
  border: "1px solid #d9e2dc",
  borderRadius: 16,
  background: "#fff",
  boxShadow: "0 8px 28px rgba(20, 32, 26, 0.06)",
};
const EVENT_KEYS = [
  "boss_due_alert_enabled",
  "boss_overdue_alert_enabled",
  "customer_due_soon_sms_enabled",
  "customer_due_today_sms_enabled",
  "customer_overdue_sms_enabled",
  "late_fee_applied_sms_enabled",
  "payment_reversal_sms_enabled",
];

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function feePolicy(settings) {
  const type = String(settings?.late_charge_type || "none");
  const value = Number(settings?.late_charge_value || 0);
  const cap = Number(settings?.late_charge_cap || 0);
  if (type === "fixed" && value > 0) return cap > 0
    ? `Failure to pay on time attracts ${money(value)}, capped at ${money(cap)}.`
    : `Failure to pay on time attracts ${money(value)}.`;
  if (type === "percentage" && value > 0) return cap > 0
    ? `Failure to pay on time attracts ${value}% of the overdue installment, capped at ${money(cap)}.`
    : `Failure to pay on time attracts ${value}% of the overdue installment.`;
  return "No late-payment fee is currently configured.";
}

function flag(settings, key) {
  return Number(settings?.[key] ?? 0) ? "ON" : "OFF";
}

function prettyKey(key) {
  return key.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function EquipmentFinanceSmsHistoryPage() {
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [eventSettings, setEventSettings] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingEvents, setSavingEvents] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [historyResponse, financeResponse, eventResponse] = await Promise.all([
        axiosClient.get("/equipment-catalogue/sales/sms-history", { params: { limit: 200 } }),
        axiosClient.get("/equipment-catalogue/sales/professional/settings"),
        axiosClient.get("/equipment-catalogue/sales/professional/notification-settings"),
      ]);
      setLogs(Array.isArray(historyResponse.data?.logs) ? historyResponse.data.logs : []);
      setSettings(financeResponse.data?.settings || null);
      setEventSettings(eventResponse.data?.settings || null);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load Installment Finance SMS history and settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateEvent(key, value) {
    setEventSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await axiosClient.put("/equipment-catalogue/sales/professional/settings", {
        settings: {
          boss_payment_alert_enabled: Boolean(settings?.boss_payment_alert_enabled),
          boss_payment_alert_phone: settings?.boss_payment_alert_phone || "",
          customer_payment_receipt_sms_enabled: Boolean(settings?.customer_payment_receipt_sms_enabled),
          deposit_alert_enabled: Boolean(settings?.deposit_alert_enabled),
          settlement_alert_enabled: Boolean(settings?.settlement_alert_enabled),
          ownership_ready_alert_enabled: Boolean(settings?.ownership_ready_alert_enabled),
          automatic_reminders_enabled: Boolean(settings?.automatic_reminders_enabled),
          reminder_time: settings?.reminder_time || "09:00:00",
          due_soon_days: settings?.due_soon_days || "7,3,1",
          overdue_repeat_days: Number(settings?.overdue_repeat_days || 3),
          max_sms_7_days: Number(settings?.max_sms_7_days || 3),
          max_sms_30_days: Number(settings?.max_sms_30_days || 8),
          minimum_hours_between_sms: Number(settings?.minimum_hours_between_sms || 24),
          skip_weekends: Boolean(settings?.skip_weekends),
          late_charge_type: settings?.late_charge_type || "none",
          late_charge_value: Number(settings?.late_charge_value || 0),
          late_charge_cap: Number(settings?.late_charge_cap || 0),
          reminder_template: settings?.reminder_template || "",
          customer_receipt_template: settings?.customer_receipt_template || "",
          payment_alert_template: settings?.payment_alert_template || "",
        },
        reason: "Updated Installment Finance SMS, reminder and late-fee policy from SMS History.",
      });
      setNotice("Finance SMS and late-fee settings saved. New agreements snapshot the policy; existing agreements keep their snapshot.");
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save Finance SMS settings.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEvents() {
    setSavingEvents(true);
    setError("");
    setNotice("");
    try {
      const payload = {};
      EVENT_KEYS.forEach((key) => { payload[key] = Boolean(eventSettings?.[key]); });
      await axiosClient.put("/equipment-catalogue/sales/professional/notification-settings", {
        settings: payload,
        reason: "Updated Installment Finance customer and boss event notification policy from SMS History.",
      });
      setNotice("Finance event notification policy saved with history.");
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save Finance notification event settings.");
    } finally {
      setSavingEvents(false);
    }
  }

  return (
    <main style={{ padding: "clamp(18px, 3vw, 32px)", maxWidth: 1500, margin: "0 auto" }}>
      <style>{`
        .finance-sms-event-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px}
        .finance-sms-event{padding:13px 14px;border:1px solid #d9e2dc;border-radius:12px;background:#f9fbfa}
        .finance-sms-event strong,.finance-sms-event span{display:block}
        .finance-sms-event strong{color:#173b68;font-size:.9rem}
        .finance-sms-event span{margin-top:4px;color:#647169;font-size:.8rem;line-height:1.4}
        .finance-sms-event input{margin-right:8px}
        @media(max-width:767px){
          .finance-sms-history-table,.finance-sms-history-table thead{display:none}
          .finance-sms-history-table,.finance-sms-history-table tbody,.finance-sms-history-table tr,.finance-sms-history-table td{display:block;width:100%;box-sizing:border-box}
          .finance-sms-history-table tr{margin-bottom:12px;border:1px solid #d9e2dc;border-radius:14px;background:#fff;overflow:hidden}
          .finance-sms-history-table td{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px;padding:10px 12px;border-bottom:1px solid #edf1ee;white-space:normal!important;max-width:none!important;min-width:0!important}
          .finance-sms-history-table td:last-child{border-bottom:0}
          .finance-sms-history-table td::before{content:attr(data-label);font-size:.72rem;font-weight:800;color:#647169;text-transform:uppercase;letter-spacing:.05em}
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#66736b", fontWeight: 700, letterSpacing: ".04em" }}>EQUIPMENT INSTALLMENT FINANCE</p>
          <h1 style={{ margin: "6px 0 0", color: "#122018" }}>SMS History &amp; Notification Control</h1>
          <p style={{ margin: "8px 0 0", color: "#647169" }}>One controlled place to review delivery history and manage customer, boss, reminder and late-fee communication policy.</p>
        </div>
        <button type="button" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      {error ? <div role="alert" style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: "#fff1f0", color: "#9c2d25" }}>{error}</div> : null}
      {notice ? <div role="status" style={{ marginBottom: 16, padding: 14, borderRadius: 12, background: "#edf9f1", color: "#14532d", border: "1px solid #83c5a1" }}>{notice}</div> : null}

      <section style={{ ...CARD, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <article><small>Automatic reminders</small><h2 style={{ margin: "4px 0" }}>{settings?.automatic_reminders_enabled ? "ON" : "OFF"}</h2><span>Scheduled due-soon, due-today and overdue messages.</span></article>
          <article><small>Boss payment alerts</small><h2 style={{ margin: "4px 0" }}>{settings?.boss_payment_alert_enabled ? "ON" : "OFF"}</h2><span>Payment receipts stay separate from due/overdue event alerts.</span></article>
          <article><small>Customer receipt SMS</small><h2 style={{ margin: "4px 0" }}>{settings?.customer_payment_receipt_sms_enabled ? "ON" : "OFF"}</h2><span>Payment confirmation after a committed receipt.</span></article>
          <article><small>Late-fee policy</small><h2 style={{ margin: "4px 0" }}>{settings ? (settings.late_charge_type === "none" ? "NONE" : settings.late_charge_type.toUpperCase()) : "—"}</h2><span>{settings ? feePolicy(settings) : "Load settings to view policy."}</span></article>
        </div>
      </section>

      {settings ? (
        <section style={{ ...CARD, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div><p style={{ margin: 0, color: "#66736b", fontWeight: 700 }}>MASTER FINANCE POLICY</p><h2 style={{ margin: "4px 0" }}>Finance SMS, Reminders &amp; Late-Fee Settings</h2></div>
            <button className="is-primary" type="button" onClick={saveSettings} disabled={saving}>{saving ? "Saving…" : "Save Finance policy"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14, marginTop: 16 }}>
            <label><input type="checkbox" checked={Boolean(settings.automatic_reminders_enabled)} onChange={(e) => updateSetting("automatic_reminders_enabled", e.target.checked)} /> Automatic reminders</label>
            <label><input type="checkbox" checked={Boolean(settings.boss_payment_alert_enabled)} onChange={(e) => updateSetting("boss_payment_alert_enabled", e.target.checked)} /> Boss payment alerts</label>
            <label><input type="checkbox" checked={Boolean(settings.customer_payment_receipt_sms_enabled)} onChange={(e) => updateSetting("customer_payment_receipt_sms_enabled", e.target.checked)} /> Customer payment receipts</label>
            <label><input type="checkbox" checked={Boolean(settings.deposit_alert_enabled)} onChange={(e) => updateSetting("deposit_alert_enabled", e.target.checked)} /> Opening-deposit alerts</label>
            <label><input type="checkbox" checked={Boolean(settings.settlement_alert_enabled)} onChange={(e) => updateSetting("settlement_alert_enabled", e.target.checked)} /> Settlement alerts</label>
            <label><input type="checkbox" checked={Boolean(settings.ownership_ready_alert_enabled)} onChange={(e) => updateSetting("ownership_ready_alert_enabled", e.target.checked)} /> Ownership-ready alerts</label>
            <label><input type="checkbox" checked={Boolean(settings.skip_weekends)} onChange={(e) => updateSetting("skip_weekends", e.target.checked)} /> Skip weekend reminder sends</label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginTop: 16 }}>
            <label>Boss phone<input value={settings.boss_payment_alert_phone || ""} onChange={(e) => updateSetting("boss_payment_alert_phone", e.target.value)} /></label>
            <label>Reminder time<input type="time" value={String(settings.reminder_time || "09:00:00").slice(0, 5)} onChange={(e) => updateSetting("reminder_time", e.target.value)} /></label>
            <label>Due-soon days<input value={settings.due_soon_days || "7,3,1"} onChange={(e) => updateSetting("due_soon_days", e.target.value)} /></label>
            <label>Overdue repeat (days)<input type="number" min="1" value={settings.overdue_repeat_days || 3} onChange={(e) => updateSetting("overdue_repeat_days", e.target.value)} /></label>
            <label>Max SMS / 7 days<input type="number" min="1" value={settings.max_sms_7_days || 3} onChange={(e) => updateSetting("max_sms_7_days", e.target.value)} /></label>
            <label>Max SMS / 30 days<input type="number" min="1" value={settings.max_sms_30_days || 8} onChange={(e) => updateSetting("max_sms_30_days", e.target.value)} /></label>
            <label>Minimum hours between SMS<input type="number" min="1" value={settings.minimum_hours_between_sms || 24} onChange={(e) => updateSetting("minimum_hours_between_sms", e.target.value)} /></label>
            <label>Late-fee type<select value={settings.late_charge_type || "none"} onChange={(e) => updateSetting("late_charge_type", e.target.value)}><option value="none">No late fee</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage of overdue installment</option></select></label>
            <label>Late-fee value<input type="number" min="0" step="0.01" value={settings.late_charge_value ?? 0} onChange={(e) => updateSetting("late_charge_value", e.target.value)} /></label>
            <label>Late-fee cap (0 = none)<input type="number" min="0" step="0.01" value={settings.late_charge_cap ?? 0} onChange={(e) => updateSetting("late_charge_cap", e.target.value)} /></label>
          </div>
          <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#fff9dc", border: "1px solid #ead37a", color: "#5a4300" }}>
            <strong>Customer-facing fee notice:</strong> {feePolicy(settings)} New agreements snapshot this policy at creation. Existing agreements retain their policy snapshot and are not silently rewritten.
          </div>
        </section>
      ) : null}

      {eventSettings ? (
        <section style={{ ...CARD, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div><p style={{ margin: 0, color: "#66736b", fontWeight: 700 }}>EVENT POLICY</p><h2 style={{ margin: "4px 0" }}>Customer &amp; Boss Notification Events</h2></div>
            <button className="is-primary" type="button" onClick={saveEvents} disabled={savingEvents}>{savingEvents ? "Saving…" : "Save event policy"}</button>
          </div>
          <div className="finance-sms-event-grid" aria-label="Finance SMS event matrix">
            {EVENT_KEYS.map((key) => (
              <label className="finance-sms-event" key={key}>
                <input type="checkbox" checked={Boolean(eventSettings[key])} onChange={(e) => updateEvent(key, e.target.checked)} />
                <strong>{prettyKey(key)}</strong>
                <span>{flag(eventSettings, key)}</span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ ...CARD, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #d9e2dc", background: "#f5f8f6" }}>
          <h2 style={{ margin: 0 }}>Message history</h2>
          <p style={{ margin: "6px 0 0", color: "#647169" }}>Every Installment Finance SMS attempt, recipient, event type, provider and result.</p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="finance-sms-history-table" style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse" }}>
            <thead><tr>{["Date / Time", "Phone", "Type", "Message", "Status", "Provider", "Sent By"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: 12, background: "#f5f8f6", borderBottom: "1px solid #d9e2dc", whiteSpace: "nowrap" }}>{heading}</th>)}</tr></thead>
            <tbody>{logs.map((log) => <tr key={log.id}>
              <td data-label="Date / Time" style={{ padding: 12, verticalAlign: "top", whiteSpace: "nowrap" }}>{new Date(log.submitted_at || log.created_at).toLocaleString("en-GB", { timeZone: "Africa/Accra" })}</td>
              <td data-label="Phone" style={{ padding: 12, verticalAlign: "top" }}>{log.recipient_phone || "—"}</td>
              <td data-label="Type" style={{ padding: 12, verticalAlign: "top" }}>{log.sms_type || "Finance"}</td>
              <td data-label="Message" style={{ padding: 12, verticalAlign: "top", minWidth: 340, maxWidth: 560, whiteSpace: "pre-wrap" }}>{log.message}</td>
              <td data-label="Status" style={{ padding: 12, verticalAlign: "top", fontWeight: 700 }}>{log.status || "Unknown"}</td>
              <td data-label="Provider" style={{ padding: 12, verticalAlign: "top" }}>{log.provider || "—"}</td>
              <td data-label="Sent By" style={{ padding: 12, verticalAlign: "top" }}>{log.sent_by_name || log.sent_by_username || "System"}</td>
            </tr>)}</tbody>
          </table>
          {!loading && logs.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: "#6b766f" }}>No Installment Finance SMS has been recorded yet.</div> : null}
        </div>
      </section>
    </main>
  );
}
