import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import "../styles/installmentFinancePolicyAndLateFee.css";

const BASE = "/equipment-catalogue/sales/professional";

function stageFor(location) {
  if (location.pathname !== "/equipment-installment-finance/applications") return "home";
  return new URLSearchParams(location.search).get("stage") || "applications";
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? String(value).slice(0, 10)
    : date.toLocaleDateString("en-GH", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

function findBwlContent() {
  return document.querySelector(".bwl-content");
}

function findTermsHost() {
  return document.querySelector(".c03-start2-terms");
}

function setReactControlValue(element, value) {
  if (!element) return false;
  const prototype = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function findPaymentFrequencySelect() {
  const selects = [...document.querySelectorAll(".c03-start2-terms select")];
  return selects.find((select) => {
    const field = select.closest(".c03-start2-field");
    return /payment frequency/i.test(field?.querySelector("span")?.textContent || "");
  }) || null;
}

function findCustomIntervalInput() {
  const fields = [...document.querySelectorAll(".c03-start2-terms .c03-start2-field")];
  const field = fields.find((item) => /days between payments/i.test(item.querySelector("span")?.textContent || ""));
  return field?.querySelector("input") || null;
}

function WeekIntervalPicker({ policy }) {
  const [selected, setSelected] = useState(numberValue(policy?.default_week_interval_weeks) || 1);
  const intervals = [1, 2, 3, 4];

  useEffect(() => {
    const select = findPaymentFrequencySelect();
    const current = String(select?.value || "");
    if (current === "custom") {
      const input = findCustomIntervalInput();
      const days = numberValue(input?.value);
      if (days && days % 7 === 0 && days / 7 >= 1 && days / 7 <= 4) setSelected(days / 7);
    } else if (current === "weekly") {
      setSelected(1);
    } else if (current === "fortnightly") {
      setSelected(2);
    }
  }, []);

  function choose(weeks) {
    setSelected(weeks);
    const frequency = findPaymentFrequencySelect();
    if (!frequency) return;
    setReactControlValue(frequency, "custom");
    window.setTimeout(() => {
      const interval = findCustomIntervalInput();
      if (interval) setReactControlValue(interval, String(weeks * 7));
    }, 30);
  }

  return (
    <div className="c03-if-policy-week-picker">
      <div>
        <span className="c03-if-policy-kicker">Flexible payment spacing</span>
        <strong>Choose how often the customer pays</strong>
        <small>Every 1, 2, 3 or 4 weeks. The existing exact-date schedule remains in control.</small>
      </div>
      <div className="c03-if-policy-week-buttons" role="group" aria-label="Payment interval in weeks">
        {intervals.map((weeks) => (
          <button
            type="button"
            key={weeks}
            className={selected === weeks ? "is-selected" : ""}
            onClick={() => choose(weeks)}
          >
            <strong>{weeks}</strong>
            <span>{weeks === 1 ? "week" : "weeks"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PolicySettingsCard({ initialPolicy, onSaved }) {
  const [policy, setPolicy] = useState(initialPolicy);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => setPolicy(initialPolicy), [initialPolicy]);

  async function save(event) {
    event.preventDefault();
    if (reason.trim().length < 5) {
      setProblem("Enter a short reason for this Finance policy change.");
      return;
    }
    setSaving(true);
    setProblem("");
    setMessage("");
    try {
      const response = await axiosClient.put(`${BASE}/installment-policy`, {
        policy: {
          default_week_interval_weeks: Number(policy.default_week_interval_weeks),
          late_fee_trigger_mode: policy.late_fee_trigger_mode,
          late_fee_decision_mode: policy.late_fee_decision_mode,
        },
        reason,
      });
      setPolicy(response.data?.policy || policy);
      setMessage("Installment policy saved. New installment decisions will use this policy.");
      setReason("");
      onSaved?.(response.data?.policy || policy);
    } catch (error) {
      setProblem(error?.response?.data?.message || "Could not save the installment policy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="c03-if-policy-card">
      <header>
        <div>
          <span className="c03-if-policy-kicker">Simple company-wide rule</span>
          <h2>Installment payment & late-fee policy</h2>
          <p>Choose the rule once here. The installment workflow and arrears view use the saved Finance policy.</p>
        </div>
      </header>

      <form onSubmit={save}>
        <div className="c03-if-policy-grid">
          <label>
            <span>Default payment spacing</span>
            <select
              value={policy.default_week_interval_weeks}
              onChange={(event) => setPolicy((current) => ({ ...current, default_week_interval_weeks: event.target.value }))}
            >
              <option value="1">Every 1 week</option>
              <option value="2">Every 2 weeks</option>
              <option value="3">Every 3 weeks</option>
              <option value="4">Every 4 weeks</option>
            </select>
            <small>This is the suggested week spacing. Users can still choose another interval on an individual installment.</small>
          </label>

          <label>
            <span>When should the late fee become due?</span>
            <select
              value={policy.late_fee_trigger_mode}
              onChange={(event) => setPolicy((current) => ({ ...current, late_fee_trigger_mode: event.target.value }))}
            >
              <option value="each_missed_installment">After each missed installment + grace</option>
              <option value="after_final_due_plus_grace">Only after the final due date + grace</option>
            </select>
            <small>The second option matches the boss example: earlier missed payments do not add a late fee individually.</small>
          </label>

          <label>
            <span>Who decides the late fee?</span>
            <select
              value={policy.late_fee_decision_mode}
              onChange={(event) => setPolicy((current) => ({ ...current, late_fee_decision_mode: event.target.value }))}
            >
              <option value="automatic">Apply automatically when eligible</option>
              <option value="boss_approval">Show to authorised Finance management for approval</option>
            </select>
            <small>When approval is selected, the fee remains a proposal until management approves or declines it.</small>
          </label>

          <div className="c03-if-policy-readonly">
            <span>Existing Finance Settings still control the money</span>
            <strong>{String(policy.late_charge_type || "none").replaceAll("_", " ")} · {money(policy.late_charge_value)} · cap {money(policy.late_charge_cap)}</strong>
            <small>Grace period: {numberValue(policy.default_grace_days)} day(s). No fee is created when the saved late-charge type is “none” or its value is zero.</small>
          </div>
        </div>

        <div className="c03-if-policy-save">
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for this policy change" />
          <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Installment Policy"}</button>
        </div>
        {problem ? <div className="c03-if-policy-message is-error">{problem}</div> : null}
        {message ? <div className="c03-if-policy-message is-success">{message}</div> : null}
      </form>
    </section>
  );
}

function LateFeeQueue() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");
  const [workingId, setWorkingId] = useState("");
  const [reasons, setReasons] = useState({});

  async function load() {
    setLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${BASE}/late-fees/pending`);
      setItems(response.data?.items || []);
    } catch (error) {
      setProblem(error?.response?.data?.message || "Could not load late-fee decisions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function decide(item, decision) {
    setWorkingId(String(item.decision.id));
    setProblem("");
    try {
      await axiosClient.post(`${BASE}/agreements/${item.agreement.id}/late-fee/decision`, {
        decision,
        reason: reasons[item.decision.id] || "",
      });
      await load();
    } catch (error) {
      setProblem(error?.response?.data?.message || "Could not save the late-fee decision.");
    } finally {
      setWorkingId("");
    }
  }

  if (loading) return <section className="c03-if-policy-queue"><strong>Checking late-fee decisions…</strong></section>;
  if (problem) return <section className="c03-if-policy-queue is-error">{problem}</section>;
  if (!items.length) return null;

  return (
    <section className="c03-if-policy-queue">
      <header>
        <div>
          <span className="c03-if-policy-kicker">Management decision required</span>
          <h2>Late-fees waiting for approval</h2>
          <p>Approve to add the proposed fee to the installment ledger, or decline to waive it.</p>
        </div>
        <button type="button" onClick={load}>Refresh</button>
      </header>
      <div className="c03-if-policy-queue-list">
        {items.map((item) => (
          <article key={item.decision.id}>
            <div className="c03-if-policy-queue-main">
              <strong>{item.agreement.agreement_number}</strong>
              <span>{item.agreement.customer_name} · {item.agreement.customer_phone || "No phone"}</span>
              <small>{item.agreement.asset_code} · {item.agreement.asset_name}</small>
            </div>
            <div className="c03-if-policy-queue-amount">
              <span>Proposed late fee</span>
              <strong>{money(item.decision.proposed_amount)}</strong>
              <small>Eligible {dateLabel(item.decision.eligible_on)}</small>
            </div>
            <div className="c03-if-policy-queue-actions">
              <input
                value={reasons[item.decision.id] || ""}
                onChange={(event) => setReasons((current) => ({ ...current, [item.decision.id]: event.target.value }))}
                placeholder="Decision reason (optional)"
              />
              <button type="button" className="is-approve" disabled={workingId === String(item.decision.id)} onClick={() => decide(item, "approve")}>Approve</button>
              <button type="button" className="is-decline" disabled={workingId === String(item.decision.id)} onClick={() => decide(item, "decline")}>Decline</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function InstallmentFinancePolicyAndLateFee() {
  const location = useLocation();
  const stage = stageFor(location);
  const [host, setHost] = useState(null);
  const [termsHost, setTermsHost] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [policyError, setPolicyError] = useState("");

  const showQueue = useMemo(
    () => ["arrears", "customer-portfolios", "collections", "accounts"].includes(stage),
    [stage]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setHost(findBwlContent());
      setTermsHost(findTermsHost());
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [stage, location.pathname, location.search]);

  useEffect(() => {
    if (!location.pathname.startsWith("/equipment-installment-finance")) return undefined;
    axiosClient.get(`${BASE}/installment-policy`)
      .then((response) => setPolicy(response.data?.policy || null))
      .catch((error) => setPolicyError(error?.response?.data?.message || "Could not load the installment Finance policy."));
    return undefined;
  }, [location.pathname]);

  if (!location.pathname.startsWith("/equipment-installment-finance")) return null;

  const children = [];
  if (stage === "settings" && policy && host) {
    children.push(createPortal(<PolicySettingsCard initialPolicy={policy} onSaved={setPolicy} />, host));
  }
  if (stage === "start" && policy && termsHost) {
    children.push(createPortal(<WeekIntervalPicker policy={policy} />, termsHost));
  }
  if (showQueue && host) {
    children.push(createPortal(<LateFeeQueue />, host));
  }
  if (policyError && stage === "settings" && host) {
    children.push(createPortal(<section className="c03-if-policy-message is-error">{policyError}</section>, host));
  }

  return <>{children}</>;
}
