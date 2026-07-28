import { useCallback, useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceContext } from "../context/WorkspaceContext";
import "../styles/equipmentInstallmentCommand.css";

const API = "/equipment-catalogue/sales/installment-command";
const RUN_CONFIRMATION = "RUN INSTALLMENT REMINDERS";

const defaultSettings = {
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
  max_messages_per_run: 50,
  skip_weekends: false,
  include_payment_phone: true,
  message_template:
    "CHALIN03: Dear {customer_name}, your equipment installment {agreement_number} for {equipment_name} has GHS {outstanding_balance} outstanding. {due_sentence}{payment_sentence} Thank you.",
};

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function number(value) {
  return Number(value || 0).toLocaleString("en-GB");
}

function label(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function dateTimeLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorText(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function riskClass(value) {
  return `installment-command__risk is-${String(value || "low").toLowerCase()}`;
}

function Metric({ title, value, detail, tone = "" }) {
  return (
    <article className={`installment-command__metric ${tone ? `is-${tone}` : ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Toggle({ title, detail, checked, onChange }) {
  return (
    <label className="installment-command__toggle">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function Drawer({ title, subtitle, close, children }) {
  return (
    <div
      className="installment-command__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="installment-command__drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <p>Installment Account</p>
            <h2>{title}</h2>
            <span>{subtitle}</span>
          </div>
          <button type="button" onClick={close} aria-label="Close account">
            ×
          </button>
        </header>
        <div className="installment-command__drawer-body">{children}</div>
      </section>
    </div>
  );
}

function Empty({ title, detail }) {
  return (
    <div className="installment-command__empty">
      <span>📋</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function AccountCard({ account, onOpen, onSms, onWhatsApp, canManage, busyId }) {
  const paidPercent = Number(account.total_amount || 0) > 0
    ? Math.min(
        100,
        (Number(account.amount_paid || 0) / Number(account.total_amount || 1)) * 100
      )
    : 0;

  return (
    <article className="installment-command__account-card">
      <div className="installment-command__account-top">
        <div>
          <small>{account.agreement_number}</small>
          <h3>{account.customer_name_snapshot}</h3>
          <p>
            {account.asset_code_snapshot} · {account.asset_name_snapshot}
          </p>
        </div>
        <span className={riskClass(account.risk_band)}>
          {label(account.risk_band)} · {number(account.risk_score)}
        </span>
      </div>

      <div className="installment-command__progress" aria-label="Payment progress">
        <i style={{ width: `${paidPercent}%` }} />
      </div>

      <dl className="installment-command__facts">
        <div>
          <dt>Outstanding</dt>
          <dd>{money(account.outstanding_balance)}</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd>{money(account.overdue_amount)}</dd>
        </div>
        <div>
          <dt>Next payment</dt>
          <dd>{money(account.next_payment_amount)}</dd>
        </div>
        <div>
          <dt>Next due</dt>
          <dd>{dateLabel(account.next_schedule_due_date || account.next_due_date)}</dd>
        </div>
        <div>
          <dt>Days past due</dt>
          <dd>{number(account.days_past_due)}</dd>
        </div>
        <div>
          <dt>Last payment</dt>
          <dd>{dateLabel(account.last_payment_at)}</dd>
        </div>
      </dl>

      <div className="installment-command__action-note">
        <strong>Recommended action</strong>
        <span>{account.recommended_action}</span>
      </div>

      <div className="installment-command__card-actions">
        <button type="button" onClick={() => onOpen(account.id)}>
          Open Account
        </button>
        {canManage ? (
          <>
            <button
              type="button"
              className="is-secondary"
              onClick={() => onSms(account.id)}
              disabled={busyId === account.id}
            >
              {busyId === account.id ? "Sending…" : "SMS"}
            </button>
            <button
              type="button"
              className="is-whatsapp"
              onClick={() => onWhatsApp(account.id)}
              disabled={busyId === account.id}
            >
              WhatsApp
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

export default function EquipmentInstallmentCommandPage() {
  const { effectivePermissions = [], user } = useAuth();
  const { selectedContext, selectedContextId, automaticAccess } = useWorkspaceContext();
  const role = String(user?.role || "").toLowerCase();
  const canManage =
    effectivePermissions.includes("fleet.assets.manage") ||
    ["admin", "manager", "administrator", "system_administrator"].includes(role);

  const [tab, setTab] = useState("portfolio");
  const [portfolio, setPortfolio] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "", risk: "", aging: "" });
  const [settings, setSettings] = useState(defaultSettings);
  const [savedSettings, setSavedSettings] = useState(defaultSettings);
  const [settingsReason, setSettingsReason] = useState("");
  const [smsStatus, setSmsStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [preview, setPreview] = useState(null);
  const [accountDetail, setAccountDetail] = useState(null);
  const [followUp, setFollowUp] = useState({
    follow_up_type: "phone_call",
    outcome: "reached",
    promise_date: "",
    promise_amount: "",
    next_action_date: "",
    notes: "",
  });
  const [loading, setLoading] = useState(true);
  const [accountLoading, setAccountLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const locationName =
    selectedContext?.name ||
    (automaticAccess && !selectedContextId
      ? "All Equipment Sales & Hire locations"
      : "Choose an Equipment Sales & Hire location");
  const hasSpecificLocation = Boolean(selectedContextId);

  const loadPortfolio = useCallback(async () => {
    const [portfolioResponse, collectionsResponse] = await Promise.all([
      axiosClient.get(`${API}/portfolio`),
      axiosClient.get(`${API}/collections`, { params: filters }),
    ]);
    setPortfolio(portfolioResponse.data || null);
    setAccounts(collectionsResponse.data?.accounts || []);
  }, [filters, selectedContextId]);

  const loadSettings = useCallback(async () => {
    if (!hasSpecificLocation) {
      setSmsStatus(null);
      setHistory([]);
      setPreview(null);
      return;
    }
    const [settingsResponse, historyResponse] = await Promise.all([
      axiosClient.get(`${API}/settings`),
      axiosClient.get(`${API}/reminders/history`, { params: { limit: 50 } }),
    ]);
    const current = settingsResponse.data?.settings || defaultSettings;
    const form = {
      ...defaultSettings,
      ...current,
      due_soon_days: Array.isArray(current.due_soon_days)
        ? current.due_soon_days.join(", ")
        : String(current.due_soon_days || "7, 3, 1"),
    };
    setSettings(form);
    setSavedSettings(form);
    setSmsStatus(settingsResponse.data?.sms || null);
    setHistory(historyResponse.data?.history || []);
  }, [hasSpecificLocation, selectedContextId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadPortfolio(), loadSettings()]);
    } catch (requestError) {
      setError(errorText(requestError, "Could not load the Installment Command Centre."));
    } finally {
      setLoading(false);
    }
  }, [loadPortfolio, loadSettings]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const dirtySettings = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [savedSettings, settings]
  );

  const summary = portfolio?.summary || {};
  const automaticEffective = Boolean(
    settings.automatic_sms_enabled && smsStatus?.automatic_available
  );

  async function openAccount(agreementId) {
    setAccountLoading(true);
    setError("");
    try {
      const response = await axiosClient.get(`${API}/agreements/${agreementId}`);
      setAccountDetail(response.data || null);
      setFollowUp({
        follow_up_type: "phone_call",
        outcome: "reached",
        promise_date: "",
        promise_amount: "",
        next_action_date: "",
        notes: "",
      });
    } catch (requestError) {
      setError(errorText(requestError, "Could not load the installment account."));
    } finally {
      setAccountLoading(false);
    }
  }

  async function sendSms(agreementId) {
    if (!hasSpecificLocation) {
      setError("Choose a specific Equipment Sales & Hire location before sending SMS.");
      return;
    }
    setBusyAccountId(Number(agreementId));
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(`${API}/agreements/${agreementId}/sms`);
      setMessage(response.data?.message || "Installment reminder SMS submitted.");
      await loadSettings();
      if (accountDetail?.agreement?.id === agreementId) await openAccount(agreementId);
    } catch (requestError) {
      setError(errorText(requestError, "Could not send the installment reminder SMS."));
    } finally {
      setBusyAccountId(null);
    }
  }

  async function openWhatsApp(agreementId) {
    if (!hasSpecificLocation) {
      setError("Choose a specific Equipment Sales & Hire location before using WhatsApp.");
      return;
    }
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setBusyAccountId(Number(agreementId));
    setError("");
    try {
      const response = await axiosClient.get(
        `${API}/agreements/${agreementId}/reminder-message`
      );
      const data = response.data || {};
      if (!data.channels?.whatsapp_enabled) {
        throw new Error("WhatsApp reminders are disabled in Installment Settings.");
      }
      const digits = String(data.recipient_phone || "").replace(/\D/g, "");
      if (!digits) throw new Error("This customer does not have a valid Ghana phone number.");
      const url = `https://wa.me/${digits}?text=${encodeURIComponent(data.message || "")}`;
      if (popup) popup.location.href = url;
      else {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) throw new Error("Popup blocked. Allow popups and try again.");
      }
    } catch (requestError) {
      if (popup && !popup.closed) popup.close();
      setError(errorText(requestError, "Could not prepare the WhatsApp reminder."));
    } finally {
      setBusyAccountId(null);
    }
  }

  async function submitFollowUp(event) {
    event.preventDefault();
    const agreementId = accountDetail?.agreement?.id;
    if (!agreementId || !hasSpecificLocation) return;
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(
        `${API}/agreements/${agreementId}/follow-ups`,
        followUp
      );
      setMessage(response.data?.message || "Installment follow-up recorded.");
      await Promise.all([openAccount(agreementId), loadPortfolio()]);
    } catch (requestError) {
      setError(errorText(requestError, "Could not record the installment follow-up."));
    } finally {
      setBusy(false);
    }
  }

  function updateSetting(name, value) {
    setSettings((current) => ({ ...current, [name]: value }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!hasSpecificLocation) {
      setError("Choose a specific location before saving installment settings.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...settings,
        due_soon_days: String(settings.due_soon_days)
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value > 0),
      };
      const response = await axiosClient.put(`${API}/settings`, {
        settings: payload,
        reason: settingsReason,
      });
      setMessage(response.data?.message || "Installment settings saved.");
      setSettingsReason("");
      await loadSettings();
    } catch (requestError) {
      setError(errorText(requestError, "Could not save installment settings."));
    } finally {
      setBusy(false);
    }
  }

  async function previewReminders() {
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.get(`${API}/reminders/preview`);
      setPreview(response.data?.preview || null);
      setSmsStatus(response.data?.sms || smsStatus);
      setMessage("Today’s installment reminder preview is ready.");
    } catch (requestError) {
      setError(errorText(requestError, "Could not preview installment reminders."));
    } finally {
      setBusy(false);
    }
  }

  async function runReminders() {
    const confirmed = window.confirm(
      "Send SMS now to every eligible equipment installment account under the saved customer-protection limits?"
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      const response = await axiosClient.post(`${API}/reminders/run`, {
        confirmation: RUN_CONFIRMATION,
      });
      setMessage(response.data?.message || "Installment reminder run completed.");
      await Promise.all([previewReminders(), loadSettings(), loadPortfolio()]);
    } catch (requestError) {
      setError(errorText(requestError, "Could not run installment reminders."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="installment-command">
      <section className="installment-command__hero">
        <div>
          <p>Equipment Sales &amp; Hire</p>
          <h1>Installment Command Centre</h1>
          <span>
            {locationName}. Portfolio risk, expected collections, customer follow-up,
            reminders and complete account evidence.
          </span>
        </div>
        <div className="installment-command__hero-actions">
          <a href="/equipment-hire-operations/fleet?view=sales">Sales Workspace</a>
          <a href="/equipment-hire-operations/fleet?view=reports">Documents &amp; Reports</a>
          <button type="button" onClick={refresh} disabled={loading || busy}>
            Refresh
          </button>
        </div>
      </section>

      {message ? <div className="installment-command__notice is-success">{message}</div> : null}
      {error ? <div className="installment-command__notice is-error">{error}</div> : null}
      {!hasSpecificLocation ? (
        <div className="installment-command__notice is-warning">
          Portfolio reporting can show all authorised locations. Choose one location before
          saving settings, recording follow-up or contacting customers.
        </div>
      ) : null}

      <nav className="installment-command__tabs" aria-label="Installment command sections">
        {[
          ["portfolio", "Portfolio"],
          ["collections", `Collections ${accounts.length}`],
          ["reminders", "Reminder Control"],
          ["settings", "Installment Settings"],
        ].map(([value, title]) => (
          <button
            type="button"
            key={value}
            className={tab === value ? "is-active" : ""}
            onClick={() => setTab(value)}
          >
            {title}
          </button>
        ))}
      </nav>

      {loading ? <div className="installment-command__loading">Loading installment portfolio…</div> : null}

      {!loading && tab === "portfolio" ? (
        <>
          <section className="installment-command__metrics">
            <Metric
              title="Active Accounts"
              value={number(summary.active_accounts)}
              detail={`${number(summary.overdue_accounts)} overdue`}
            />
            <Metric
              title="Portfolio Outstanding"
              value={money(summary.outstanding_amount)}
              detail={`${Number(summary.portfolio_at_risk_rate || 0).toFixed(1)}% at risk`}
              tone="primary"
            />
            <Metric
              title="Collected"
              value={money(summary.collected_amount)}
              detail={`${Number(summary.collection_rate || 0).toFixed(1)}% collection rate`}
              tone="success"
            />
            <Metric
              title="Overdue Amount"
              value={money(summary.overdue_amount)}
              detail={`${number(summary.critical_risk_accounts)} critical-risk account(s)`}
              tone="danger"
            />
            <Metric
              title="Due Next 7 Days"
              value={money(summary.due_next_7_days)}
              detail={`${number(summary.due_today_accounts)} due today`}
              tone="warning"
            />
            <Metric
              title="Due Next 30 Days"
              value={money(summary.due_next_30_days)}
              detail="Expected scheduled cash flow"
            />
          </section>

          <div className="installment-command__portfolio-grid">
            <section className="installment-command__panel">
              <header>
                <div>
                  <p>Receivables Control</p>
                  <h2>Portfolio Aging</h2>
                </div>
                <strong>{money(summary.outstanding_amount)}</strong>
              </header>
              <div className="installment-command__aging">
                {(portfolio?.aging || []).map((row) => {
                  const width = Number(summary.outstanding_amount || 0) > 0
                    ? Math.min(
                        100,
                        (Number(row.outstanding_amount || 0) /
                          Number(summary.outstanding_amount || 1)) *
                          100
                      )
                    : 0;
                  return (
                    <article key={row.aging_bucket}>
                      <div>
                        <strong>{label(row.aging_bucket)}</strong>
                        <span>{number(row.accounts)} account(s)</span>
                      </div>
                      <b>{money(row.outstanding_amount)}</b>
                      <div><i style={{ width: `${width}%` }} /></div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="installment-command__panel">
              <header>
                <div>
                  <p>Next 90 Days</p>
                  <h2>Expected Collections</h2>
                </div>
              </header>
              <div className="installment-command__forecast">
                {(portfolio?.forecast || []).length ? (
                  portfolio.forecast.slice(0, 16).map((row) => (
                    <article key={String(row.due_date)}>
                      <div>
                        <strong>{dateLabel(row.due_date)}</strong>
                        <span>{number(row.accounts)} account(s)</span>
                      </div>
                      <b>{money(row.expected_amount)}</b>
                    </article>
                  ))
                ) : (
                  <Empty
                    title="No expected collections"
                    detail="No unpaid schedule lines fall within the next 90 days."
                  />
                )}
              </div>
            </section>
          </div>

          <section className="installment-command__section">
            <header>
              <div>
                <p>Management Attention</p>
                <h2>Urgent Installment Accounts</h2>
              </div>
              <button type="button" onClick={() => setTab("collections")}>Open Collections Queue</button>
            </header>
            <div className="installment-command__account-grid">
              {(portfolio?.urgent_accounts || []).length ? (
                portfolio.urgent_accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    onOpen={openAccount}
                    onSms={sendSms}
                    onWhatsApp={openWhatsApp}
                    canManage={canManage && hasSpecificLocation}
                    busyId={busyAccountId}
                  />
                ))
              ) : (
                <Empty
                  title="No urgent accounts"
                  detail="There are no high or critical risk installment accounts in this view."
                />
              )}
            </div>
          </section>
        </>
      ) : null}

      {!loading && tab === "collections" ? (
        <section className="installment-command__section">
          <header>
            <div>
              <p>Collections Work Queue</p>
              <h2>Every Installment Account</h2>
              <span>Prioritised by default, arrears, next due date and account risk.</span>
            </div>
          </header>
          <form
            className="installment-command__filters"
            onSubmit={(event) => {
              event.preventDefault();
              loadPortfolio().catch((requestError) =>
                setError(errorText(requestError, "Could not apply collection filters."))
              );
            }}
          >
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              placeholder="Customer, phone, agreement or equipment"
            />
            <select
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="due_soon">Due soon</option>
              <option value="payment_due">Payment due</option>
              <option value="overdue">Overdue</option>
              <option value="defaulted">Defaulted</option>
              <option value="completed">Completed</option>
            </select>
            <select
              value={filters.risk}
              onChange={(event) => setFilters({ ...filters, risk: event.target.value })}
            >
              <option value="">All risk bands</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={filters.aging}
              onChange={(event) => setFilters({ ...filters, aging: event.target.value })}
            >
              <option value="">All aging</option>
              <option value="current">Current</option>
              <option value="1_7_days">1–7 days</option>
              <option value="8_30_days">8–30 days</option>
              <option value="31_60_days">31–60 days</option>
              <option value="61_90_days">61–90 days</option>
              <option value="over_90_days">Over 90 days</option>
            </select>
            <button type="submit">Apply</button>
          </form>
          <div className="installment-command__account-grid">
            {accounts.length ? (
              accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  onOpen={openAccount}
                  onSms={sendSms}
                  onWhatsApp={openWhatsApp}
                  canManage={canManage && hasSpecificLocation}
                  busyId={busyAccountId}
                />
              ))
            ) : (
              <Empty
                title="No installment accounts match"
                detail="Change the collection filters or create an installment agreement in Sales Workspace."
              />
            )}
          </div>
        </section>
      ) : null}

      {!loading && tab === "reminders" ? (
        <section className="installment-command__section">
          <header>
            <div>
              <p>Customer Follow-Up</p>
              <h2>Reminder Control &amp; Evidence</h2>
              <span>Preview eligible accounts before any controlled bulk SMS run.</span>
            </div>
            <span className={`installment-command__mode ${automaticEffective ? "is-live" : ""}`}>
              {automaticEffective
                ? "Automatic SMS Active"
                : settings.automatic_sms_enabled
                  ? "Waiting for SMS Provider"
                  : "Automatic SMS Off"}
            </span>
          </header>

          {!hasSpecificLocation ? (
            <Empty
              title="Choose a location"
              detail="Reminder controls and evidence are location-specific."
            />
          ) : (
            <>
              <div className="installment-command__reminder-summary">
                <article>
                  <span>SMS Provider</span>
                  <strong>{smsStatus?.provider?.toUpperCase() || "Checking"}</strong>
                  <small>{smsStatus?.mode_message || "Provider status unavailable."}</small>
                </article>
                <article>
                  <span>Scheduled Time</span>
                  <strong>{settings.reminder_time} Ghana time</strong>
                  <small>Automatic checks run hourly after the saved time.</small>
                </article>
                <article>
                  <span>WhatsApp</span>
                  <strong>Prepared Manual Chat</strong>
                  <small>Automatic WhatsApp needs an approved Meta Business API.</small>
                </article>
              </div>

              {canManage ? (
                <div className="installment-command__run-box">
                  <div>
                    <h3>Controlled reminder run</h3>
                    <p>
                      Weekly, monthly, minimum-hour, duplicate and per-run limits remain
                      active when Run Now is used.
                    </p>
                  </div>
                  <div>
                    <button type="button" onClick={previewReminders} disabled={busy}>
                      Preview Today
                    </button>
                    <button
                      type="button"
                      className="is-primary"
                      onClick={runReminders}
                      disabled={busy}
                    >
                      Run Reminders Now
                    </button>
                  </div>
                </div>
              ) : null}

              {preview ? (
                <div className="installment-command__preview">
                  <Metric title="Checked" value={number(preview.checked)} detail="Open accounts" />
                  <Metric title="Eligible" value={number(preview.eligible)} detail="Can send now" tone="success" />
                  <Metric title="Overdue" value={number(preview.overdue)} detail="Eligible overdue" tone="danger" />
                  <Metric title="Due Today" value={number(preview.due_today)} detail="Eligible today" tone="warning" />
                  <Metric title="Limited" value={number(preview.limited)} detail="Protected by limits" />
                  <Metric title="Invalid Phone" value={number(preview.invalid_phone)} detail="Needs correction" />
                </div>
              ) : null}

              <div className="installment-command__history">
                <h3>Recent Installment Reminder Evidence</h3>
                {history.length ? (
                  history.map((row) => (
                    <article key={row.id}>
                      <div>
                        <strong>{row.agreement_number} · {row.customer_name}</strong>
                        <span>{label(row.reminder_type)} · {row.recipient_phone}</span>
                        <small>{row.message_preview}</small>
                      </div>
                      <div>
                        <b>{label(row.delivery_status)}</b>
                        <span>{dateTimeLabel(row.sent_at || row.created_at)}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <Empty
                    title="No reminder evidence yet"
                    detail="SMS and automatic reminder attempts will appear here."
                  />
                )}
              </div>
            </>
          )}
        </section>
      ) : null}

      {!loading && tab === "settings" ? (
        <section className="installment-command__section">
          <header>
            <div>
              <p>Installment Governance</p>
              <h2>Customer Protection &amp; Collection Settings</h2>
              <span>These rules apply only to the selected Equipment Sales &amp; Hire location.</span>
            </div>
          </header>

          {!hasSpecificLocation ? (
            <Empty
              title="Choose a location"
              detail="Installment settings cannot be changed from the all-locations view."
            />
          ) : (
            <form className="installment-command__settings" onSubmit={saveSettings}>
              <fieldset disabled={!canManage || busy}>
                <legend>Communication Channels</legend>
                <div className="installment-command__toggle-grid">
                  <Toggle
                    title="Automatic SMS reminders"
                    detail="Allow the backend to send eligible installment reminders automatically."
                    checked={settings.automatic_sms_enabled}
                    onChange={(value) => updateSetting("automatic_sms_enabled", value)}
                  />
                  <Toggle
                    title="Manual SMS reminders"
                    detail="Permit staff to send one protected reminder from an account."
                    checked={settings.manual_sms_enabled}
                    onChange={(value) => updateSetting("manual_sms_enabled", value)}
                  />
                  <Toggle
                    title="WhatsApp reminder button"
                    detail="Open a prepared message for manual review and sending."
                    checked={settings.manual_whatsapp_enabled}
                    onChange={(value) => updateSetting("manual_whatsapp_enabled", value)}
                  />
                  <Toggle
                    title="Include payment phone"
                    detail="Add the location payment contact to customer reminders."
                    checked={settings.include_payment_phone}
                    onChange={(value) => updateSetting("include_payment_phone", value)}
                  />
                </div>
              </fieldset>

              <fieldset disabled={!canManage || busy}>
                <legend>Timing &amp; Arrears Rules</legend>
                <div className="installment-command__form-grid">
                  <label>
                    <span>Daily Send Time</span>
                    <input
                      type="time"
                      value={settings.reminder_time}
                      onChange={(event) => updateSetting("reminder_time", event.target.value)}
                    />
                    <small>Africa/Accra time.</small>
                  </label>
                  <label>
                    <span>Due-Soon Days</span>
                    <input
                      value={settings.due_soon_days}
                      onChange={(event) => updateSetting("due_soon_days", event.target.value)}
                      placeholder="7, 3, 1"
                    />
                    <small>Comma-separated days before payment is due.</small>
                  </label>
                  <label>
                    <span>Start Overdue Reminders After</span>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={settings.overdue_start_days}
                      onChange={(event) =>
                        updateSetting("overdue_start_days", Number(event.target.value))
                      }
                    />
                    <small>Days after the oldest unpaid due date.</small>
                  </label>
                  <label>
                    <span>Repeat Overdue Every</span>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={settings.overdue_repeat_days}
                      onChange={(event) =>
                        updateSetting("overdue_repeat_days", Number(event.target.value))
                      }
                    />
                    <small>Days between overdue reminders.</small>
                  </label>
                </div>
                <div className="installment-command__toggle-grid is-compact">
                  <Toggle
                    title="Due-soon reminders"
                    detail="Use the due-soon day list."
                    checked={settings.due_soon_enabled}
                    onChange={(value) => updateSetting("due_soon_enabled", value)}
                  />
                  <Toggle
                    title="Due-today reminders"
                    detail="Send once on the payment due date."
                    checked={settings.due_today_enabled}
                    onChange={(value) => updateSetting("due_today_enabled", value)}
                  />
                  <Toggle
                    title="Overdue reminders"
                    detail="Use the arrears timing rules."
                    checked={settings.overdue_enabled}
                    onChange={(value) => updateSetting("overdue_enabled", value)}
                  />
                  <Toggle
                    title="Skip weekends"
                    detail="Do not run automatic SMS on Saturday or Sunday."
                    checked={settings.skip_weekends}
                    onChange={(value) => updateSetting("skip_weekends", value)}
                  />
                </div>
              </fieldset>

              <fieldset disabled={!canManage || busy}>
                <legend>Customer Protection &amp; SMS Cost Control</legend>
                <div className="installment-command__form-grid">
                  <label>
                    <span>Maximum SMS in 7 Days</span>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={settings.max_sms_7_days}
                      onChange={(event) =>
                        updateSetting("max_sms_7_days", Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    <span>Maximum SMS in 30 Days</span>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={settings.max_sms_30_days}
                      onChange={(event) =>
                        updateSetting("max_sms_30_days", Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    <span>Minimum Hours Between SMS</span>
                    <input
                      type="number"
                      min="1"
                      max="720"
                      value={settings.minimum_hours_between_sms}
                      onChange={(event) =>
                        updateSetting(
                          "minimum_hours_between_sms",
                          Number(event.target.value)
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Maximum Messages Per Run</span>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={settings.max_messages_per_run}
                      onChange={(event) =>
                        updateSetting("max_messages_per_run", Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    <span>Minimum Outstanding Balance</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settings.minimum_balance}
                      onChange={(event) =>
                        updateSetting("minimum_balance", Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset disabled={!canManage || busy}>
                <legend>Customer Message</legend>
                <label className="installment-command__template">
                  <span>SMS Template</span>
                  <textarea
                    rows="6"
                    value={settings.message_template}
                    onChange={(event) =>
                      updateSetting("message_template", event.target.value)
                    }
                  />
                  <small>
                    Available: {"{customer_name}"}, {"{agreement_number}"},{" "}
                    {"{equipment_name}"}, {"{outstanding_balance}"},{" "}
                    {"{overdue_amount}"}, {"{next_payment_amount}"},{" "}
                    {"{next_due_date}"}, {"{location_name}"},{" "}
                    {"{payment_phone}"}, {"{due_sentence}"}, {"{payment_sentence}"}.
                  </small>
                </label>
              </fieldset>

              {canManage ? (
                <div className="installment-command__save-row">
                  <label>
                    <span>Reason for Settings Change</span>
                    <input
                      value={settingsReason}
                      onChange={(event) => setSettingsReason(event.target.value)}
                      placeholder="Example: Protect customers and control collection SMS frequency"
                    />
                  </label>
                  <button type="submit" disabled={busy || !dirtySettings}>
                    {busy ? "Saving…" : dirtySettings ? "Save Installment Settings" : "Settings Saved"}
                  </button>
                </div>
              ) : (
                <div className="installment-command__readonly">
                  Settings are read-only. A user with Equipment management permission can
                  change them.
                </div>
              )}
            </form>
          )}
        </section>
      ) : null}

      {accountLoading ? (
        <div className="installment-command__loading is-overlay">Loading account evidence…</div>
      ) : null}

      {accountDetail ? (
        <Drawer
          title={accountDetail.agreement?.agreement_number}
          subtitle={`${accountDetail.agreement?.customer_name_snapshot} · ${accountDetail.agreement?.asset_name_snapshot}`}
          close={() => setAccountDetail(null)}
        >
          <div className="installment-command__account-summary">
            <Metric
              title="Outstanding"
              value={money(accountDetail.agreement?.outstanding_balance)}
              detail={label(accountDetail.agreement?.agreement_status)}
              tone="primary"
            />
            <Metric
              title="Overdue"
              value={money(accountDetail.agreement?.overdue_amount)}
              detail={`${number(accountDetail.agreement?.days_past_due)} days past due`}
              tone="danger"
            />
            <Metric
              title="Risk"
              value={label(accountDetail.agreement?.risk_band)}
              detail={`Score ${number(accountDetail.agreement?.risk_score)}`}
              tone="warning"
            />
            <Metric
              title="Next Payment"
              value={money(accountDetail.agreement?.next_payment_amount)}
              detail={dateLabel(accountDetail.agreement?.next_schedule_due_date)}
            />
          </div>

          <section className="installment-command__account-section">
            <header><h3>Customer &amp; Equipment</h3></header>
            <dl className="installment-command__detail-grid">
              <div><dt>Customer</dt><dd>{accountDetail.agreement?.customer_name_snapshot}</dd></div>
              <div><dt>Phone</dt><dd>{accountDetail.agreement?.customer_phone_snapshot || "—"}</dd></div>
              <div><dt>Customer ID</dt><dd>{accountDetail.agreement?.customer_id_number || "Not recorded"}</dd></div>
              <div><dt>Guarantor</dt><dd>{accountDetail.agreement?.guarantor_name || "Not recorded"}</dd></div>
              <div><dt>Equipment</dt><dd>{accountDetail.agreement?.asset_code_snapshot} · {accountDetail.agreement?.asset_name_snapshot}</dd></div>
              <div><dt>Location</dt><dd>{accountDetail.agreement?.hire_location_name}</dd></div>
              <div><dt>Total</dt><dd>{money(accountDetail.agreement?.total_amount)}</dd></div>
              <div><dt>Paid</dt><dd>{money(accountDetail.agreement?.amount_paid)}</dd></div>
            </dl>
            {canManage && hasSpecificLocation ? (
              <div className="installment-command__card-actions">
                <button type="button" onClick={() => sendSms(accountDetail.agreement.id)}>Send SMS Reminder</button>
                <button type="button" className="is-whatsapp" onClick={() => openWhatsApp(accountDetail.agreement.id)}>WhatsApp Reminder</button>
                <a href="/equipment-hire-operations/fleet?view=sales">Record Payment in Sales Workspace</a>
              </div>
            ) : null}
          </section>

          <section className="installment-command__account-section">
            <header><h3>Payment Schedule</h3></header>
            <div className="installment-command__table-wrap">
              <table>
                <thead><tr><th>#</th><th>Due</th><th>Scheduled</th><th>Paid</th><th>Charges</th><th>Status</th></tr></thead>
                <tbody>
                  {(accountDetail.schedule || []).map((row) => (
                    <tr key={row.id}>
                      <td>{row.sequence_number}</td>
                      <td>{dateLabel(row.due_date)}</td>
                      <td>{money(row.scheduled_amount)}</td>
                      <td>{money(row.amount_paid)}</td>
                      <td>{money(Number(row.late_charge_amount || 0) - Number(row.waived_charge_amount || 0))}</td>
                      <td><span className={`installment-command__status is-${row.schedule_status}`}>{label(row.schedule_status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="installment-command__account-section">
            <header><h3>Payments</h3></header>
            <div className="installment-command__timeline">
              {(accountDetail.payments || []).length ? accountDetail.payments.map((row) => (
                <article key={row.id}>
                  <div><strong>{row.receipt_number}</strong><span>{label(row.payment_method)} · {label(row.payment_category)}</span></div>
                  <div><b>{money(row.amount)}</b><span>{dateTimeLabel(row.payment_date)}</span></div>
                </article>
              )) : <p>No payment evidence recorded.</p>}
            </div>
          </section>

          <section className="installment-command__account-section">
            <header>
              <div><h3>Collections Follow-Up</h3><p>Calls, WhatsApp, promises, guarantor contact and recovery notes.</p></div>
            </header>
            {canManage && hasSpecificLocation ? (
              <form className="installment-command__follow-up-form" onSubmit={submitFollowUp}>
                <label><span>Follow-up Type</span><select value={followUp.follow_up_type} onChange={(event) => setFollowUp({ ...followUp, follow_up_type: event.target.value })}><option value="phone_call">Phone call</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="field_visit">Field visit</option><option value="promise_to_pay">Promise to pay</option><option value="guarantor_contact">Guarantor contact</option><option value="recovery_review">Recovery review</option><option value="account_note">Account note</option></select></label>
                <label><span>Outcome</span><select value={followUp.outcome} onChange={(event) => setFollowUp({ ...followUp, outcome: event.target.value })}><option value="reached">Reached</option><option value="not_reached">Not reached</option><option value="promised_payment">Promised payment</option><option value="paid_or_settled">Paid or settled</option><option value="disputed">Disputed</option><option value="reschedule_requested">Reschedule requested</option><option value="guarantor_engaged">Guarantor engaged</option><option value="escalated">Escalated</option><option value="note_only">Note only</option></select></label>
                <label><span>Promise Date</span><input type="date" value={followUp.promise_date} onChange={(event) => setFollowUp({ ...followUp, promise_date: event.target.value })} /></label>
                <label><span>Promise Amount</span><input type="number" min="0" step="0.01" value={followUp.promise_amount} onChange={(event) => setFollowUp({ ...followUp, promise_amount: event.target.value })} /></label>
                <label><span>Next Action Date</span><input type="date" value={followUp.next_action_date} onChange={(event) => setFollowUp({ ...followUp, next_action_date: event.target.value })} /></label>
                <label className="is-wide"><span>Follow-up Notes</span><textarea required rows="4" value={followUp.notes} onChange={(event) => setFollowUp({ ...followUp, notes: event.target.value })} placeholder="Who was contacted, what was discussed, agreed payment and next action." /></label>
                <button type="submit" disabled={busy}>{busy ? "Recording…" : "Record Follow-Up"}</button>
              </form>
            ) : null}
            <div className="installment-command__timeline">
              {(accountDetail.follow_ups || []).length ? accountDetail.follow_ups.map((row) => (
                <article key={row.id}>
                  <div>
                    <strong>{label(row.metadata?.follow_up_type)} · {label(row.metadata?.outcome || row.outcome)}</strong>
                    <span>{row.metadata?.notes || row.details}</span>
                    {row.metadata?.promise_date ? <small>Promise: {dateLabel(row.metadata.promise_date)} · {money(row.metadata.promise_amount)}</small> : null}
                    {row.metadata?.next_action_date ? <small>Next action: {dateLabel(row.metadata.next_action_date)}</small> : null}
                  </div>
                  <div><b>{row.recorded_by_name || row.recorded_by_username || "System"}</b><span>{dateTimeLabel(row.created_at)}</span></div>
                </article>
              )) : <p>No collection follow-up has been recorded yet.</p>}
            </div>
          </section>

          <section className="installment-command__account-section">
            <header><h3>Reminder Evidence</h3></header>
            <div className="installment-command__timeline">
              {(accountDetail.reminders || []).length ? accountDetail.reminders.map((row) => (
                <article key={row.id}>
                  <div><strong>{label(row.reminder_type)}</strong><span>{row.message_preview}</span></div>
                  <div><b>{label(row.delivery_status)}</b><span>{dateTimeLabel(row.sent_at || row.created_at)}</span></div>
                </article>
              )) : <p>No reminders have been recorded for this agreement.</p>}
            </div>
          </section>
        </Drawer>
      ) : null}
    </main>
  );
}
