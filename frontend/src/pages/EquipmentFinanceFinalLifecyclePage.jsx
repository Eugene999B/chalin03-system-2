import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinanceFinalLifecycle.css";

const API = "/equipment-catalogue/sales/finance-lifecycle";
const COLLECTION_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "collections_officer",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const FINALISATION_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const STAGES = new Set(["collections", "delivery", "ownership"]);
const PAYMENT_METHODS = [
  ["cash", "Cash"],
  ["momo", "Mobile money"],
  ["bank", "Bank transfer"],
  ["cheque", "Cheque"],
  ["other", "Other"],
];
const CONDITIONS = ["excellent", "good", "fair", "damaged", "under_inspection"];

const money = (value) =>
  `GHS ${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const label = (value) =>
  String(value || "Not available")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const dateLabel = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const errorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

const today = () => new Date().toISOString().slice(0, 10);

function secureRequestKey(prefix, agreementId) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error(
      "This browser cannot create a secure Finance request key. Refresh with a current browser before recording the transaction."
    );
  }
  return `${prefix}:${agreementId}:${uuid}`;
}

function activeStage(search) {
  const value = new URLSearchParams(search).get("stage");
  return STAGES.has(value) ? value : "collections";
}

function stageCopy(stage) {
  if (stage === "delivery") {
    return {
      eyebrow: "Approved payment threshold to customer handover",
      title: "Record controlled excavator delivery and condition evidence",
      queue: "Delivery handover queue",
      empty: "No agreements are currently awaiting controlled delivery.",
      action: "Record handover",
    };
  }
  if (stage === "ownership") {
    return {
      eyebrow: "Fully settled account to final title evidence",
      title: "Transfer ownership only after settlement and handover",
      queue: "Ownership-transfer queue",
      empty: "No fully paid, delivered agreements are awaiting ownership transfer.",
      action: "Transfer ownership",
    };
  }
  return {
    eyebrow: "Installment receipts and exact schedule allocation",
    title: "Record partial, exact or above-period Finance payments",
    queue: "Collections queue",
    empty: "No reserved Finance agreements currently require collection.",
    action: "Record collection",
  };
}

function StatusPill({ value }) {
  return (
    <span className={`finance-lifecycle__status is-${String(value || "unknown")}`}>
      {label(value)}
    </span>
  );
}

function Drawer({ title, subtitle, onClose, children }) {
  return (
    <div
      className="finance-lifecycle__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="finance-lifecycle__drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <p>Equipment Installment Finance</p>
            <h2>{title}</h2>
            <span>{subtitle}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Finance action">
            ×
          </button>
        </header>
        <div className="finance-lifecycle__drawer-body">{children}</div>
      </section>
    </div>
  );
}

function Field({ title, hint, wide = false, children }) {
  return (
    <label className={`finance-lifecycle__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function nextScheduleBalance(detail, account) {
  const row = detail?.schedule?.find(
    (item) => !["paid", "cancelled", "waived"].includes(item.schedule_status)
  );
  if (!row) return Number(account.outstanding_balance || 0);
  return Math.max(
    Number(row.scheduled_amount || 0) +
      Number(row.late_charge_amount || 0) -
      Number(row.waived_charge_amount || 0) -
      Number(row.amount_paid || 0),
    0
  );
}

function initialForm(stage, account, detail) {
  if (stage === "collections") {
    const suggested = Math.min(
      nextScheduleBalance(detail, account) || Number(account.outstanding_balance || 0),
      Number(account.outstanding_balance || 0)
    );
    return {
      amount: suggested.toFixed(2),
      payment_method: "cash",
      reference_number: "",
      notes: "",
      idempotency_key: secureRequestKey("finance-collection", account.agreement_id),
    };
  }
  if (stage === "delivery") {
    return {
      destination: account.customer_address || "",
      meter_reading: String(account.current_meter || ""),
      fuel_level_percent: "",
      condition_status: "good",
      attachments_tools: "",
      receiving_person: account.customer_name || "",
      receiving_phone: account.customer_phone || "",
      customer_signature_url: "",
      delivery_note_url: "",
      notes: "",
      idempotency_key: secureRequestKey("finance-delivery", account.agreement_id),
    };
  }
  return {
    transfer_date: today(),
    ownership_document_url: "",
    registration_transfer_reference: "",
    notes: "",
    idempotency_key: secureRequestKey("finance-ownership", account.agreement_id),
  };
}

function belongsToStage(account, stage) {
  if (stage === "collections") {
    return account.reserved && !account.ownership_id && Number(account.outstanding_balance || 0) > 0.01;
  }
  if (stage === "delivery") {
    return account.reserved && !account.delivery_id && !account.ownership_id;
  }
  return account.reserved && Boolean(account.delivery_id) && account.fully_paid && !account.ownership_id;
}

function matchesSearch(account, search) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    account.agreement_number,
    account.application_number,
    account.customer_name,
    account.customer_phone,
    account.asset_code,
    account.asset_name,
    account.serial_number,
    account.chassis_number,
  ].some((value) => String(value || "").toLowerCase().includes(term));
}

function CollectionForm({ form, setForm, account, detail }) {
  const nextBalance = nextScheduleBalance(detail, account);
  return (
    <div className="finance-lifecycle__form-grid">
      <Field
        title="Amount received"
        hint={`Current period balance is ${money(nextBalance)}. A higher amount is allowed and advances future schedule lines; the total cannot exceed ${money(account.outstanding_balance)}.`}
      >
        <input
          type="number"
          min="0.01"
          max={account.outstanding_balance}
          step="0.01"
          required
          value={form.amount}
          onChange={(event) => setForm({ ...form, amount: event.target.value })}
        />
      </Field>
      <Field title="Payment method">
        <select
          value={form.payment_method}
          onChange={(event) => setForm({ ...form, payment_method: event.target.value })}
        >
          {PAYMENT_METHODS.map(([value, title]) => (
            <option value={value} key={value}>{title}</option>
          ))}
        </select>
      </Field>
      <Field title="Reference number">
        <input
          value={form.reference_number}
          onChange={(event) => setForm({ ...form, reference_number: event.target.value })}
          placeholder="MoMo, bank, cheque or internal reference"
        />
      </Field>
      <Field title="Collection notes" wide>
        <textarea
          rows="4"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </Field>
    </div>
  );
}

function DeliveryForm({ form, setForm }) {
  return (
    <div className="finance-lifecycle__form-grid">
      <Field title="Machine condition">
        <select value={form.condition_status} onChange={(event) => setForm({ ...form, condition_status: event.target.value })}>
          {CONDITIONS.map((condition) => <option value={condition} key={condition}>{label(condition)}</option>)}
        </select>
      </Field>
      <Field title="Meter reading"><input type="number" min="0" step="0.01" required value={form.meter_reading} onChange={(event) => setForm({ ...form, meter_reading: event.target.value })} /></Field>
      <Field title="Fuel level %"><input type="number" min="0" max="100" step="0.01" required value={form.fuel_level_percent} onChange={(event) => setForm({ ...form, fuel_level_percent: event.target.value })} /></Field>
      <Field title="Receiving person"><input required value={form.receiving_person} onChange={(event) => setForm({ ...form, receiving_person: event.target.value })} /></Field>
      <Field title="Receiving phone"><input value={form.receiving_phone} onChange={(event) => setForm({ ...form, receiving_phone: event.target.value })} /></Field>
      <Field title="Destination" wide><input value={form.destination} onChange={(event) => setForm({ ...form, destination: event.target.value })} /></Field>
      <Field title="Attachments, keys and tools" wide><textarea rows="3" value={form.attachments_tools} onChange={(event) => setForm({ ...form, attachments_tools: event.target.value })} /></Field>
      <Field title="Customer signature evidence URL" wide><input value={form.customer_signature_url} onChange={(event) => setForm({ ...form, customer_signature_url: event.target.value })} /></Field>
      <Field title="Delivery note evidence URL" wide><input value={form.delivery_note_url} onChange={(event) => setForm({ ...form, delivery_note_url: event.target.value })} /></Field>
      <Field title="Handover notes" wide><textarea rows="4" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
    </div>
  );
}

function OwnershipForm({ form, setForm }) {
  return (
    <div className="finance-lifecycle__form-grid">
      <Field title="Transfer date"><input type="date" required value={form.transfer_date} onChange={(event) => setForm({ ...form, transfer_date: event.target.value })} /></Field>
      <Field title="Registration / authority transfer reference"><input value={form.registration_transfer_reference} onChange={(event) => setForm({ ...form, registration_transfer_reference: event.target.value })} /></Field>
      <Field title="Ownership document evidence URL" wide><input value={form.ownership_document_url} onChange={(event) => setForm({ ...form, ownership_document_url: event.target.value })} /></Field>
      <Field title="Ownership notes" wide><textarea rows="4" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
    </div>
  );
}

export default function EquipmentFinanceFinalLifecyclePage() {
  const location = useLocation();
  const stage = activeStage(location.search);
  const copy = stageCopy(stage);
  const { user, workspaceRole } = useAuth();
  const role = String(
    workspaceRole || user?.workspace_role || user?.access_role || user?.role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const isSystemAdministrator = Boolean(user?.is_original_system_administrator);
  const canCollect = isSystemAdministrator || COLLECTION_ROLES.has(role);
  const canFinalise = isSystemAdministrator || FINALISATION_ROLES.has(role);
  const canAct = stage === "collections" ? canCollect : canFinalise;

  const [readiness, setReadiness] = useState({ ready: null });
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const nextReadiness = readinessResponse.data?.readiness || { ready: true };
      setReadiness(nextReadiness);
      if (!nextReadiness.ready) {
        setAccounts([]);
        return;
      }
      const response = await axiosClient.get(`${API}/accounts`);
      setAccounts(response.data?.accounts || []);
    } catch (error) {
      const responseReadiness = error?.response?.data?.readiness;
      if (responseReadiness?.ready === false) {
        setReadiness(responseReadiness);
        setAccounts([]);
        return;
      }
      setProblem(errorMessage(error, "Could not load the final Finance lifecycle."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelected(null);
    setDetail(null);
    setForm(null);
    setProblem("");
  }, [stage]);

  const stageAccounts = useMemo(
    () => accounts.filter((account) => belongsToStage(account, stage) && matchesSearch(account, search)),
    [accounts, search, stage]
  );
  const summary = useMemo(
    () => ({
      collections: accounts.filter((account) => belongsToStage(account, "collections")).length,
      delivery: accounts.filter((account) => belongsToStage(account, "delivery")).length,
      ownership: accounts.filter((account) => belongsToStage(account, "ownership")).length,
      outstanding: accounts.reduce((total, account) => total + Number(account.outstanding_balance || 0), 0),
    }),
    [accounts]
  );

  async function openAction(account) {
    if (!canAct) {
      setProblem(
        stage === "collections"
          ? "Only an authorised Finance Manager, Finance Accountant, Collections Officer, dual Equipment Business Manager/Accountant or protected System Administrator can record collections."
          : "Only an authorised Finance Manager, Finance Accountant, dual Equipment Business Manager/Accountant or protected System Administrator can complete this action."
      );
      return;
    }
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/accounts/${account.agreement_id}`);
      const serverAccount = response.data?.account || account;
      setSelected(serverAccount);
      setDetail(response.data || null);
      setForm(initialForm(stage, serverAccount, response.data || null));
    } catch (error) {
      setProblem(errorMessage(error, "Could not open the Finance lifecycle action."));
    }
  }

  function closeAction() {
    if (saving) return;
    setSelected(null);
    setDetail(null);
    setForm(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected || !form) return;
    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const endpoint = stage === "collections" ? "collections" : stage === "delivery" ? "delivery" : "ownership-transfer";
      const response = await axiosClient.post(`${API}/accounts/${selected.agreement_id}/${endpoint}`, form);
      const alert = response.data?.boss_payment_alert;
      setReceipt({
        stage,
        agreement_number: selected.agreement_number,
        number: response.data?.receipt_number || response.data?.delivery_number || response.data?.transfer_number,
        boss_alert_status: alert?.status || null,
      });
      const suffix =
        stage === "collections"
          ? alert?.ok
            ? " Boss payment alert was submitted after the payment committed."
            : alert?.status === "skipped"
              ? " Payment is saved; boss alert is disabled or missing a configured phone."
              : " Payment is saved; boss alert status requires attention."
          : "";
      setNotice(`${response.data?.message || "Finance lifecycle action recorded."}${suffix}`);
      setSelected(null);
      setDetail(null);
      setForm(null);
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not save the Finance lifecycle action."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="finance-lifecycle">
      <section className="finance-lifecycle__hero">
        <div>
          <p>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <span>Company-wide Installment Finance portfolio · no Hire-location selector required</span>
        </div>
        <div className="finance-lifecycle__hero-actions">
          <Link to="/equipment-installment-finance/applications?stage=documents">Agreement documents</Link>
          <Link to="/equipment-installment-finance/applications?stage=settings">Finance settings</Link>
          <button type="button" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </section>

      <section className="finance-lifecycle__boundary">
        <span aria-hidden="true">🛡️</span>
        <div>
          <strong>Finance-only money, delivery and ownership evidence</strong>
          <p>
            Collections allocate the oldest due line first and then future schedule lines, so a customer may pay late, partially or more than the expected period amount without losing money. A collection above the final account balance is rejected. The boss alert starts only after the payment transaction commits and cannot roll back a valid receipt. Delivery and ownership never create Hire work.
          </p>
        </div>
      </section>

      {problem ? <div className="finance-lifecycle__alert is-error">{problem}</div> : null}
      {notice ? <div className="finance-lifecycle__alert is-success">{notice}</div> : null}
      {receipt ? (
        <div className="finance-lifecycle__alert is-receipt">
          <strong>{label(receipt.stage)} evidence:</strong> {receipt.number || "Recorded"} · {receipt.agreement_number}
          {receipt.boss_alert_status ? ` · Boss alert: ${label(receipt.boss_alert_status)}` : ""}
        </div>
      ) : null}
      {!canAct ? <div className="finance-lifecycle__alert is-info">Your Finance role may review this company-wide queue but cannot complete its transaction.</div> : null}

      {readiness.ready === false ? (
        <section className="finance-lifecycle__foundation">
          <span aria-hidden="true">🏗️</span>
          <div>
            <p>Controlled additive migration required</p>
            <h2>Finance actions remain safely blocked until the professional schema is verified</h2>
            <span>No raw database error is exposed. Existing records remain untouched.</span>
            {readiness.missing_tables?.length ? <small>Missing tables: {readiness.missing_tables.join(", ")}</small> : null}
            {readiness.missing_columns?.length ? <small>Missing columns: {readiness.missing_columns.join(", ")}</small> : null}
          </div>
        </section>
      ) : null}

      {readiness.ready === true ? (
        <>
          <section className="finance-lifecycle__metrics">
            <article><span>💳</span><div><small>Collection accounts</small><strong>{summary.collections}</strong><p>Reserved accounts with a balance</p></div></article>
            <article><span>🚜</span><div><small>Awaiting delivery</small><strong>{summary.delivery}</strong><p>Threshold-approved handovers</p></div></article>
            <article><span>📜</span><div><small>Ownership ready</small><strong>{summary.ownership}</strong><p>Fully settled and delivered</p></div></article>
            <article><span>🏦</span><div><small>Portfolio outstanding</small><strong>{money(summary.outstanding)}</strong><p>Approved-credit balance</p></div></article>
          </section>

          <nav className="finance-lifecycle__stages" aria-label="Finance lifecycle stages">
            <Link className={stage === "collections" ? "is-active" : ""} to="/equipment-installment-finance/applications?stage=collections">Collections</Link>
            <Link className={stage === "delivery" ? "is-active" : ""} to="/equipment-installment-finance/applications?stage=delivery">Delivery Handover</Link>
            <Link className={stage === "ownership" ? "is-active" : ""} to="/equipment-installment-finance/applications?stage=ownership">Ownership Transfer</Link>
          </nav>

          <section className="finance-lifecycle__toolbar">
            <label>
              <span>Search {copy.queue.toLowerCase()}</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Agreement, customer, serial, chassis or machine" />
            </label>
          </section>

          <section className="finance-lifecycle__queue">
            <header><div><p>Controlled Finance work</p><h2>{copy.queue}</h2></div><small>{stageAccounts.length} record(s)</small></header>
            {loading ? <div className="finance-lifecycle__empty">Loading Finance accounts…</div> : null}
            {!loading && !stageAccounts.length ? <div className="finance-lifecycle__empty"><span aria-hidden="true">✅</span><strong>{copy.empty}</strong><p>No action is required for the current filter.</p></div> : null}
            {!loading && stageAccounts.length ? (
              <div className="finance-lifecycle__cards">
                {stageAccounts.map((account) => (
                  <article className="finance-lifecycle__card" key={account.agreement_id}>
                    <div className="finance-lifecycle__card-top">
                      <div><small>{account.agreement_number}</small><h3>{account.customer_name}</h3><p>{account.asset_code} · {account.asset_name}</p></div>
                      <StatusPill value={account.ownership_id ? "ownership_transferred" : account.delivery_id ? "delivered" : account.delivery_eligible ? "eligible" : "threshold_pending"} />
                    </div>
                    {account.main_image_url ? <img className="finance-lifecycle__machine-photo" src={account.main_image_url} alt={account.asset_name} /> : null}
                    <div className="finance-lifecycle__facts">
                      <div><span>Origin yard</span><strong>{account.equipment_origin_name || "Company-wide"}</strong></div>
                      <div><span>Outstanding</span><strong>{money(account.outstanding_balance)}</strong></div>
                      <div><span>Amount paid</span><strong>{money(account.amount_paid)}</strong></div>
                      <div><span>Next due</span><strong>{dateLabel(account.next_due_date)}</strong></div>
                      <div><span>Serial / chassis</span><strong>{account.serial_number || account.chassis_number || "—"}</strong></div>
                      <div><span>Machine state</span><strong>{label(account.equipment_commitment_status)}</strong></div>
                    </div>
                    {account.reconciliation_consistent === false ? <div className="finance-lifecycle__note is-warning">Receipt, allocation, schedule or ledger evidence needs reconciliation before this action can continue.</div> : null}
                    {stage === "delivery" && !account.delivery_eligible ? <div className="finance-lifecycle__note is-warning">Payment threshold not reached; delivery remains blocked.</div> : null}
                    <div className="finance-lifecycle__card-actions"><button type="button" className="is-primary" onClick={() => openAction(account)} disabled={!canAct || account.reconciliation_consistent === false || (stage === "delivery" && !account.delivery_eligible)}>{copy.action}</button></div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {selected && form ? (
        <Drawer title={`${copy.action}: ${selected.agreement_number}`} subtitle={`${selected.customer_name} · ${selected.asset_code} · ${selected.asset_name}`} onClose={closeAction}>
          {selected.main_image_url ? <img className="finance-lifecycle__drawer-machine" src={selected.main_image_url} alt={selected.asset_name} /> : null}
          {detail?.reconciliation?.consistent === false ? (
            <div className="finance-lifecycle__note is-warning" data-testid="final-lifecycle-reconciliation-warning">
              This account is locked because its active receipts, allocations, schedule and ledger do not reconcile. Correct the evidence before completing this action.
            </div>
          ) : null}
          <section className="finance-lifecycle__account-summary">
            <div><span>Purchase price</span><strong>{money(selected.total_amount)}</strong></div>
            <div><span>Paid</span><strong>{money(selected.amount_paid)}</strong></div>
            <div><span>Outstanding</span><strong>{money(selected.outstanding_balance)}</strong></div>
            <div><span>Next due</span><strong>{dateLabel(selected.next_due_date)}</strong></div>
          </section>
          {stage === "collections" && detail?.schedule?.length ? (
            <section className="finance-lifecycle__schedule"><h3>Schedule allocation preview</h3>{detail.schedule.map((row) => <div key={row.id}><span>#{row.sequence_number} · {dateLabel(row.due_date)}</span><strong>{money(Number(row.scheduled_amount || 0) + Number(row.late_charge_amount || 0) - Number(row.waived_charge_amount || 0) - Number(row.amount_paid || 0))}</strong><StatusPill value={row.schedule_status} /></div>)}</section>
          ) : null}
          <form onSubmit={submit}>
            {stage === "collections" ? <CollectionForm form={form} setForm={setForm} account={selected} detail={detail} /> : null}
            {stage === "delivery" ? <DeliveryForm form={form} setForm={setForm} /> : null}
            {stage === "ownership" ? <OwnershipForm form={form} setForm={setForm} /> : null}
            <div className="finance-lifecycle__drawer-actions"><button type="button" onClick={closeAction} disabled={saving}>Cancel</button><button type="submit" className="is-primary" disabled={saving || detail?.reconciliation?.consistent === false}>{saving ? "Saving controlled evidence…" : copy.action}</button></div>
          </form>
        </Drawer>
      ) : null}
    </main>
  );
}
