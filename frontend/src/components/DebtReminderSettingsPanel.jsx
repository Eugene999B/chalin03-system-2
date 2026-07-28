import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import { formatBusinessDateTime } from "../utils/businessDate";
import "../styles/debtReminderSettings.css";

const DEFAULT_FORM = {
  automatic_sms_enabled: false,
  manual_sms_enabled: true,
  manual_whatsapp_enabled: true,
  reminder_time: "09:00",
  due_soon_enabled: true,
  due_soon_days: "7, 3, 1",
  due_today_enabled: true,
  overdue_enabled: true,
  overdue_start_days: 1,
  overdue_repeat_days: 3,
  max_sms_7_days: 3,
  max_sms_30_days: 8,
  minimum_hours_between_sms: 24,
  minimum_balance: 1,
  skip_weekends: false,
  include_payment_phone: true,
  message_template:
    "CHALIN03: Dear {customer_name}, your outstanding balance at {store_name} is GHS {outstanding_balance} across {debt_count} debt receipt(s). {due_sentence} Please make payment promptly.{payment_sentence} Thank you.",
};

function normaliseForm(settings = {}) {
  return {
    ...DEFAULT_FORM,
    ...settings,
    due_soon_days: Array.isArray(settings.due_soon_days)
      ? settings.due_soon_days.join(", ")
      : settings.due_soon_days || DEFAULT_FORM.due_soon_days,
  };
}

function statusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "delivered") return "Delivered";
  if (value === "accepted") return "Accepted by Provider";
  if (value === "delivery_unknown") return "Delivery Unknown";
  if (value === "failed") return "Failed";
  return status || "Unknown";
}

function roleCanManage(role) {
  return ["admin", "manager"].includes(String(role || "").toLowerCase());
}

function ToggleField({ label, description, checked, onChange, disabled = false }) {
  return (
    <label className="debt-reminder-toggle-field">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}

export default function DebtReminderSettingsPanel({
  userRole = "",
  currentStoreCode = "STORE",
  currentStoreName = "Selected Store",
}) {
  const canManage = roleCanManage(userRole);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [savedSettings, setSavedSettings] = useState(DEFAULT_FORM);
  const [sms, setSms] = useState(null);
  const [automaticEffective, setAutomaticEffective] = useState(false);
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedSettings),
    [form, savedSettings]
  );

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setMessage("");
    setError("");
  }

  async function loadSettings({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/debt-reminders/settings");
      const next = normaliseForm(response.data.settings || {});
      setForm(next);
      setSavedSettings(next);
      setSms(response.data.sms || null);
      setAutomaticEffective(Boolean(response.data.automatic_effective));
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not load Debt Reminder Settings."
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function loadHistory() {
    if (!canManage) return;
    try {
      const response = await axiosClient.get("/debt-reminders/history?limit=12");
      setHistory(response.data.history || []);
    } catch {
      // Settings remain usable when history is temporarily unavailable.
    }
  }

  useEffect(() => {
    loadSettings();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStoreCode]);

  async function saveSettings(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!canManage) {
      setError("Only an administrator or manager can change Debt Reminder Settings.");
      return;
    }

    if (reason.trim().length < 5) {
      setError("Enter a clear change reason of at least 5 characters.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        due_soon_days: String(form.due_soon_days || "")
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isInteger(item)),
      };
      const response = await axiosClient.put("/debt-reminders/settings", {
        settings: payload,
        reason: reason.trim(),
      });
      const next = normaliseForm(response.data.settings || payload);
      setForm(next);
      setSavedSettings(next);
      setSms(response.data.sms || sms);
      setAutomaticEffective(
        Boolean(next.automatic_sms_enabled && response.data.sms?.automatic_available)
      );
      setReason("");
      setMessage(response.data.message || "Debt Reminder Settings saved.");
      await loadHistory();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not save Debt Reminder Settings."
      );
    } finally {
      setSaving(false);
    }
  }

  async function previewToday() {
    setMessage("");
    setError("");
    setLoading(true);
    try {
      const response = await axiosClient.get("/debt-reminders/preview");
      setPreview(response.data.preview || null);
      setSms(response.data.sms || sms);
      setMessage("Today’s debt reminder preview is ready.");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not preview today’s debt reminders."
      );
    } finally {
      setLoading(false);
    }
  }

  async function runNow() {
    setMessage("");
    setError("");

    if (!canManage) {
      setError("Only an administrator or manager can run debt reminders.");
      return;
    }

    const confirmed = window.confirm(
      "Send SMS now to every customer who is eligible under the saved Debt Reminder Settings? Anti-spam limits and daily duplicate protection will still apply."
    );
    if (!confirmed) return;

    setRunning(true);
    try {
      const response = await axiosClient.post("/debt-reminders/run", {
        confirmation: "SEND DEBT REMINDERS",
      });
      setMessage(response.data.message || "Debt reminder run completed.");
      await Promise.all([previewToday(), loadHistory()]);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not run debt reminders."
      );
    } finally {
      setRunning(false);
    }
  }

  const providerTone = !sms?.enabled
    ? "disabled"
    : sms?.live_sending
      ? "live"
      : sms?.provider === "mock"
        ? "mock"
        : "warning";

  return (
    <section className="debt-reminder-settings">
      <div className="debt-reminder-settings-summary">
        <div>
          <p>Debt Reminder Control</p>
          <h2>Automatic SMS & Customer Follow-Up</h2>
          <span>
            {currentStoreCode} — {currentStoreName}. One consolidated reminder is
            prepared per customer account, not one message per receipt.
          </span>
        </div>

        <div className="debt-reminder-settings-summary-actions">
          <span className={`debt-reminder-mode ${providerTone}`}>
            {automaticEffective
              ? "Automatic SMS Active"
              : form.automatic_sms_enabled
                ? "Automation Waiting for SMS Provider"
                : "Automatic SMS Off"}
          </span>
          <button type="button" onClick={() => setOpen((current) => !current)}>
            {open ? "Close Debt Settings" : "Debt Reminder Settings"}
          </button>
        </div>
      </div>

      <div className="debt-reminder-channel-grid">
        <div>
          <span>SMS Provider</span>
          <strong>{sms?.provider?.toUpperCase() || "Checking..."}</strong>
          <small>{sms?.mode_message || "Loading provider status..."}</small>
        </div>
        <div>
          <span>Automatic Schedule</span>
          <strong>{form.reminder_time} Ghana time</strong>
          <small>
            Server checks hourly and sends once the configured time is reached.
          </small>
        </div>
        <div>
          <span>WhatsApp</span>
          <strong>Prepared Manual Chat</strong>
          <small>
            Automatic WhatsApp requires an approved Meta WhatsApp Business API.
          </small>
        </div>
      </div>

      {message ? <div className="debt-reminder-message success">{message}</div> : null}
      {error ? <div className="debt-reminder-message error">{error}</div> : null}

      {open ? (
        <div className="debt-reminder-settings-body">
          <form onSubmit={saveSettings}>
            <fieldset disabled={!canManage || saving}>
              <legend>Automation and Manual Actions</legend>
              <div className="debt-reminder-toggle-grid">
                <ToggleField
                  label="Automatic SMS reminders"
                  description="Allow the backend scheduler to send eligible customer reminders automatically."
                  checked={form.automatic_sms_enabled}
                  onChange={(value) => updateField("automatic_sms_enabled", value)}
                />
                <ToggleField
                  label="Manual SMS reminders"
                  description="Show and permit Send SMS Reminder on customer debt accounts."
                  checked={form.manual_sms_enabled}
                  onChange={(value) => updateField("manual_sms_enabled", value)}
                />
                <ToggleField
                  label="WhatsApp reminder button"
                  description="Open a prepared WhatsApp message for the selected customer."
                  checked={form.manual_whatsapp_enabled}
                  onChange={(value) => updateField("manual_whatsapp_enabled", value)}
                />
                <ToggleField
                  label="Include payment phone"
                  description="Add the configured business/owner payment contact to reminder messages."
                  checked={form.include_payment_phone}
                  onChange={(value) => updateField("include_payment_phone", value)}
                />
              </div>
            </fieldset>

            <fieldset disabled={!canManage || saving}>
              <legend>Reminder Timing</legend>
              <div className="debt-reminder-form-grid">
                <label>
                  <span>Daily Send Time</span>
                  <input
                    type="time"
                    value={form.reminder_time}
                    onChange={(event) =>
                      updateField("reminder_time", event.target.value)
                    }
                  />
                  <small>Africa/Accra time.</small>
                </label>

                <label>
                  <span>Due-Soon Days</span>
                  <input
                    value={form.due_soon_days}
                    onChange={(event) =>
                      updateField("due_soon_days", event.target.value)
                    }
                    placeholder="7, 3, 1"
                  />
                  <small>Comma-separated days before the next due date.</small>
                </label>

                <label>
                  <span>Start Overdue Reminders After</span>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={form.overdue_start_days}
                    onChange={(event) =>
                      updateField("overdue_start_days", Number(event.target.value))
                    }
                  />
                  <small>Days after the earliest overdue date.</small>
                </label>

                <label>
                  <span>Repeat Overdue Reminder Every</span>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={form.overdue_repeat_days}
                    onChange={(event) =>
                      updateField("overdue_repeat_days", Number(event.target.value))
                    }
                  />
                  <small>Days between overdue reminders.</small>
                </label>
              </div>

              <div className="debt-reminder-toggle-grid compact">
                <ToggleField
                  label="Due-soon reminders"
                  description="Use the due-soon day list above."
                  checked={form.due_soon_enabled}
                  onChange={(value) => updateField("due_soon_enabled", value)}
                />
                <ToggleField
                  label="Due-today reminder"
                  description="Send once when the next debt payment is due today."
                  checked={form.due_today_enabled}
                  onChange={(value) => updateField("due_today_enabled", value)}
                />
                <ToggleField
                  label="Overdue reminders"
                  description="Repeat using the overdue timing rules above."
                  checked={form.overdue_enabled}
                  onChange={(value) => updateField("overdue_enabled", value)}
                />
                <ToggleField
                  label="Skip weekends"
                  description="Do not run automatic reminders on Saturday or Sunday."
                  checked={form.skip_weekends}
                  onChange={(value) => updateField("skip_weekends", value)}
                />
              </div>
            </fieldset>

            <fieldset disabled={!canManage || saving}>
              <legend>Customer Protection & SMS Cost Control</legend>
              <div className="debt-reminder-form-grid">
                <label>
                  <span>Maximum SMS in 7 Days</span>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={form.max_sms_7_days}
                    onChange={(event) =>
                      updateField("max_sms_7_days", Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  <span>Maximum SMS in 30 Days</span>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={form.max_sms_30_days}
                    onChange={(event) =>
                      updateField("max_sms_30_days", Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  <span>Minimum Hours Between SMS</span>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={form.minimum_hours_between_sms}
                    onChange={(event) =>
                      updateField(
                        "minimum_hours_between_sms",
                        Number(event.target.value)
                      )
                    }
                  />
                </label>
                <label>
                  <span>Minimum Outstanding Balance</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.minimum_balance}
                    onChange={(event) =>
                      updateField("minimum_balance", Number(event.target.value))
                    }
                  />
                  <small>Customers below this balance are skipped automatically.</small>
                </label>
              </div>
            </fieldset>

            <fieldset disabled={!canManage || saving}>
              <legend>Reminder Message</legend>
              <label className="debt-reminder-template-field">
                <span>Customer SMS Template</span>
                <textarea
                  value={form.message_template}
                  onChange={(event) =>
                    updateField("message_template", event.target.value)
                  }
                  rows="5"
                />
                <small>
                  Available: {"{customer_name}"}, {"{outstanding_balance}"},{" "}
                  {"{total_owed}"}, {"{total_paid}"}, {"{debt_count}"},{" "}
                  {"{overdue_count}"}, {"{next_due_date}"}, {"{store_name}"},{" "}
                  {"{store_code}"}, {"{payment_phone}"}, {"{due_sentence}"},{" "}
                  {"{payment_sentence}"}.
                </small>
              </label>
            </fieldset>

            {canManage ? (
              <div className="debt-reminder-save-row">
                <label>
                  <span>Reason for Settings Change</span>
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Example: Reduce reminders to protect customers and SMS credit"
                  />
                </label>
                <button type="submit" disabled={saving || !dirty}>
                  {saving ? "Saving..." : dirty ? "Save Debt Settings" : "Settings Saved"}
                </button>
              </div>
            ) : (
              <div className="debt-reminder-read-only">
                Settings are read-only. An administrator or manager can change reminder
                rules.
              </div>
            )}
          </form>

          {canManage ? (
            <div className="debt-reminder-operations">
              <div>
                <p>Controlled Reminder Run</p>
                <h3>Preview first, then send only eligible customers</h3>
                <span>
                  Daily duplicate protection, weekly/monthly limits and minimum-hour
                  spacing remain active even when Run Now is used.
                </span>
              </div>
              <div className="debt-reminder-operation-buttons">
                <button type="button" className="secondary-button" onClick={previewToday}>
                  {loading ? "Checking..." : "Preview Today"}
                </button>
                <button type="button" onClick={runNow} disabled={running}>
                  {running ? "Sending Eligible SMS..." : "Run Reminders Now"}
                </button>
              </div>
            </div>
          ) : null}

          {preview ? (
            <div className="debt-reminder-preview">
              <div className="debt-reminder-preview-grid">
                <div><span>Checked</span><strong>{preview.checked}</strong></div>
                <div><span>Eligible Today</span><strong>{preview.eligible}</strong></div>
                <div><span>Due Soon</span><strong>{preview.due_soon}</strong></div>
                <div><span>Due Today</span><strong>{preview.due_today}</strong></div>
                <div><span>Overdue</span><strong>{preview.overdue}</strong></div>
                <div><span>Limited/Skipped</span><strong>{preview.limited + preview.already_sent_today + preview.invalid_phone}</strong></div>
              </div>

              {preview.sample?.length ? (
                <div className="debt-reminder-preview-list">
                  {preview.sample.map((customer) => (
                    <div key={customer.customer_id}>
                      <span>Customer #{customer.customer_id}</span>
                      <strong>{customer.customer_name}</strong>
                      <small>
                        {customer.reminder_type.replaceAll("_", " ")} · GHS {Number(
                          customer.outstanding_balance || 0
                        ).toLocaleString("en-GB", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </small>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {canManage ? (
            <div className="debt-reminder-history">
              <div>
                <p>Recent Customer Debt SMS</p>
                <h3>Submission and delivery evidence</h3>
              </div>
              {history.length === 0 ? (
                <div className="debt-reminder-history-empty">
                  No customer-level debt reminder SMS has been recorded yet.
                </div>
              ) : (
                <div className="debt-reminder-history-list">
                  {history.map((item) => (
                    <div key={item.id}>
                      <span>{item.recipient_phone}</span>
                      <strong>{statusLabel(item.status)}</strong>
                      <small>
                        {formatBusinessDateTime(item.created_at)} · {item.provider || "-"}
                        {item.sent_by_name || item.sent_by_username
                          ? ` · ${item.sent_by_name || item.sent_by_username}`
                          : " · Automatic system"}
                      </small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
