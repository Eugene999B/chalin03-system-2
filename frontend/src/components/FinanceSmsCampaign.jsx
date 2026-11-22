import { useCallback, useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import "../styles/financeSmsCampaign.css";

const API = "/sms/finance-campaign";
const CONFIRMATION = "SEND EXCAVATOR OFFER";

function readableStatus(value) {
  return String(value || "pending").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyError(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

export default function FinanceSmsCampaign({ canManage = false }) {
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [mode, setMode] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [manualPhone, setManualPhone] = useState("");
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const [consent, setConsent] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const [audience, smsHistory] = await Promise.all([
        axiosClient.get(API + "/preview"),
        axiosClient.get(API + "/history"),
      ]);
      setPreview(audience.data);
      setHistory(smsHistory.data?.messages || []);
      setMessage((previous) => previous || audience.data?.default_message || "");
    } catch (error) {
      setProblem(friendlyError(error, "Finance SMS audience could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  const customers = preview?.recipients || [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter((row) =>
      !term ||
      String(row.customer_name || "").toLowerCase().includes(term) ||
      String(row.masked_phone || "").includes(term) ||
      String(row.portfolio_status || "").toLowerCase().includes(term)
    );
  }, [customers, search]);

  const selected = new Set(selectedIds);
  const recipientCount = mode === "all"
    ? Number(preview?.valid_unique_phone_count || 0)
    : mode === "selected"
      ? customers.filter((row) => selected.has(row.customer_id)).length
      : manualPhone.trim() ? 1 : 0;
  const ready =
    canManage &&
    preview?.live_sending &&
    !loading &&
    !sending &&
    recipientCount > 0 &&
    message.trim().length > 0 &&
    message.length <= 480 &&
    verified &&
    consent &&
    confirmation.trim().toUpperCase() === CONFIRMATION;

  function toggleCustomer(id) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  function selectVisible() {
    setSelectedIds((current) => [...new Set([...current, ...filtered.map((row) => row.customer_id)])]);
  }

  async function submit(event) {
    event.preventDefault();
    if (!ready) return;
    setSending(true);
    setProblem("");
    setNotice("");
    setOutcome(null);
    try {
      const response = await axiosClient.post(API + "/send", {
        target_type: mode,
        customer_ids: mode === "selected" ? selectedIds : undefined,
        phone: mode === "single" ? manualPhone : undefined,
        message,
        offer_verified: verified,
        contact_consent_confirmed: consent,
        confirmation,
      });
      setOutcome(response.data);
      setNotice("Campaign submitted to the SMS provider. Check each delivery status below; accepted does not mean delivered.");
      setConfirmation("");
      setVerified(false);
      setConsent(false);
      const refreshed = await axiosClient.get(API + "/history");
      setHistory(refreshed.data?.messages || []);
    } catch (error) {
      setProblem(friendlyError(error, "The SMS campaign could not be submitted."));
    } finally {
      setSending(false);
    }
  }

  if (!canManage) return null;

  return (
    <section className="finance-sms" id="finance-sms-campaign" aria-label="Finance SMS campaign centre">
      <header className="finance-sms__hero">
        <div>
          <p className="finance-sms__eyebrow">Equipment Finance / Communications</p>
          <h2>Installment SMS Centre</h2>
          <p>
            Reach Finance customers about available excavators, ready-cash sales and approved
            installment offers. Finance recipients are separate from Spare Parts customers.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading || sending} className="finance-sms__refresh">
          {loading ? "Checking…" : "↻ Refresh audience"}
        </button>
      </header>

      {problem ? <div className="finance-sms__feedback finance-sms__feedback--error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-sms__feedback" role="status">{notice}</div> : null}

      <div className="finance-sms__stats">
        <article><span>Finance customers</span><strong>{preview?.finance_customer_count ?? "—"}</strong><small>All Finance portfolio records</small></article>
        <article><span>Eligible unique phones</span><strong>{preview?.valid_unique_phone_count ?? "—"}</strong><small>After validation and deduplication</small></article>
        <article><span>Invalid / missing</span><strong>{preview?.invalid_count ?? "—"}</strong><small>Excluded from sending</small></article>
        <article><span>Duplicates removed</span><strong>{preview?.duplicate_count ?? "—"}</strong><small>One message per phone</small></article>
      </div>

      <div className="finance-sms__grid">
        <form className="finance-sms__panel" onSubmit={submit}>
          <div className="finance-sms__heading">
            <div><span className="finance-sms__eyebrow">01 / Create campaign</span><h3>Excavator discount offer</h3></div>
            <span className={"finance-sms__provider " + (preview?.live_sending ? "is-live" : "is-off")}>
              {preview?.live_sending ? "Live SMS ready" : "SMS offline / mock"}
            </span>
          </div>
          <p className="finance-sms__hint">
            The preview uses actual Finance records. Confirm current excavator availability and
            approved discount terms before notifying customers.
          </p>

          <fieldset className="finance-sms__mode">
            <legend>Choose recipients</legend>
            <div className="finance-sms__mode-buttons">
              {[
                ["all", "All Finance customers"],
                ["selected", "Selected customers"],
                ["single", "One phone"],
              ].map(([value, title]) => (
                <button key={value} type="button"
                  className={mode === value ? "is-selected" : ""}
                  aria-pressed={mode === value}
                  onClick={() => { setMode(value); setConfirmation(""); }}>
                  {title}
                </button>
              ))}
            </div>
          </fieldset>

          {mode === "single" ? (
            <label className="finance-sms__field">
              <span>Ghana mobile number</span>
              <input type="tel" autoComplete="tel" value={manualPhone}
                onChange={(event) => setManualPhone(event.target.value)}
                placeholder="0240000000" maxLength={20} />
              <small>Enter 10 digits (starting 02 or 05) or the correct +233 number.</small>
            </label>
          ) : null}

          {mode === "selected" ? (
            <div className="finance-sms__recipient-picker">
              <div className="finance-sms__picker-top">
                <strong>{selectedIds.length} selected</strong>
                <button type="button" onClick={selectVisible}>Select displayed</button>
                <button type="button" onClick={() => setSelectedIds([])}>Clear</button>
              </div>
              <input aria-label="Search Finance customers" value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search Finance customer or account status" />
              <div className="finance-sms__recipient-list">
                {filtered.map((customer) => (
                  <label key={customer.customer_id}>
                    <input type="checkbox" checked={selected.has(customer.customer_id)}
                      onChange={() => toggleCustomer(customer.customer_id)} />
                    <span><strong>{customer.customer_name}</strong><small>{customer.masked_phone} · {readableStatus(customer.portfolio_status)}</small></span>
                  </label>
                ))}
                {!filtered.length ? <p>No matching Finance customers with valid phones.</p> : null}
              </div>
            </div>
          ) : null}

          <label className="finance-sms__field">
            <span>Customer SMS message</span>
            <textarea value={message} rows={4} maxLength={480}
              onChange={(event) => setMessage(event.target.value)} />
            <small>{message.length}/480 characters. Keep the offer clear; no unapproved price promises.</small>
          </label>

          <div className="finance-sms__confirmation">
            <div className="finance-sms__confirmation-title">
              <strong>02 / Final safety check</strong>
              <span>{recipientCount} recipient{recipientCount === 1 ? "" : "s"}</span>
            </div>
            <label><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
              <span>I have verified the excavator is available and the discount and payment terms are approved.</span></label>
            <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I confirm these recipients may receive promotional messages and have excluded anyone who opted out.</span></label>
            <label className="finance-sms__field">
              <span>Type <strong>{CONFIRMATION}</strong> to authorise the live send</span>
              <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
                placeholder={CONFIRMATION} autoComplete="off" />
            </label>
          </div>
          <div className="finance-sms__send-row">
            <span>Provider status is tracked; submission does not guarantee delivery.</span>
            <button type="submit" disabled={!ready}>{sending ? "Submitting…" : "Send campaign SMS"}</button>
          </div>
        </form>

        <aside className="finance-sms__panel finance-sms__history">
          <div className="finance-sms__heading">
            <div><span className="finance-sms__eyebrow">03 / Delivery evidence</span><h3>Campaign activity</h3></div>
            <span className="finance-sms__history-count">{history.length}</span>
          </div>
          {outcome ? (
            <div className="finance-sms__outcome" role="status">
              <strong>{outcome.total_recipients} recipients checked</strong>
              <div>
                {Object.entries(outcome.counts || {}).map(([status, count]) =>
                  <span key={status}>{readableStatus(status)}: {count}</span>)}
              </div>
            </div>
          ) : null}
          <p className="finance-sms__hint">
            Previous attempts are checked before sending so this campaign is not blindly resent.
            Review failures separately; a pending or accepted result may already have consumed SMS credit.
          </p>
          <div className="finance-sms__history-list">
            {history.map((item) => (
              <article key={item.id}>
                <div><strong>{item.masked_phone}</strong>
                  <small>{item.created_at ? new Date(item.created_at).toLocaleString() : "Date not available"}</small>
                </div>
                <span className={"finance-sms__status is-" + String(item.status || "unknown").replace(/[^a-z_-]/g, "")}>
                  {readableStatus(item.status)}
                </span>
              </article>
            ))}
            {!history.length ? <div className="finance-sms__empty">No SMS submissions for this promotion yet.</div> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
