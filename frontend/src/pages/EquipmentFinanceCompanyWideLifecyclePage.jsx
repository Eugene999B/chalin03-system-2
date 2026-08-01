import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinanceFinalLifecycle.css";
import "../styles/equipmentFinancePhaseOne.css";

const API = "/equipment-catalogue/sales/finance-lifecycle";
const STAGES = new Set(["collections", "delivery", "ownership"]);
const COLLECTION_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "collections_officer",
  "equipment_business_manager",
  "equipment_business_accountant",
]);
const FINAL_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "equipment_business_manager",
  "equipment_business_accountant",
]);

function stageFrom(search) {
  const value = new URLSearchParams(search).get("stage");
  return STAGES.has(value) ? value : "collections";
}

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function label(value) {
  return String(value || "Not recorded")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value).slice(0, 10)
    : parsed.toLocaleDateString("en-GH", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function secureKey(prefix, agreementId) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Use a current browser before recording this Finance action.");
  return `${prefix}:${agreementId}:${uuid}`;
}

function currentRole(user, workspaceRole) {
  return String(
    workspaceRole || user?.workspace_role || user?.access_role || user?.role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function belongs(account, stage) {
  if (stage === "collections") {
    return account.reserved && !account.ownership_id && Number(account.outstanding_balance || 0) > 0.01;
  }
  if (stage === "delivery") {
    return account.reserved && account.delivery_eligible && !account.delivery_id && !account.ownership_id;
  }
  return account.reserved && Boolean(account.delivery_id) && account.fully_paid && !account.ownership_id;
}

function matches(account, search) {
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

function stageContent(stage) {
  if (stage === "delivery") {
    return {
      eyebrow: "Verified handover evidence",
      title: "Controlled Equipment Delivery",
      action: "Record delivery",
      empty: "No reserved agreement has reached its approved delivery threshold.",
    };
  }
  if (stage === "ownership") {
    return {
      eyebrow: "Settlement and title evidence",
      title: "Ownership Transfer",
      action: "Transfer ownership",
      empty: "No fully settled and delivered account is awaiting ownership transfer.",
    };
  }
  return {
    eyebrow: "Oldest-due-first allocation",
    title: "Installment Collections",
    action: "Record payment",
    empty: "No active reserved agreement currently requires payment.",
  };
}

function Field({ title, hint = "", wide = false, children }) {
  return (
    <label className={`finance-simple__field ${wide ? "is-wide" : ""}`}>
      <span>{title}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function verifiedDocuments(detail, categories) {
  return (detail?.case_documents || []).filter(
    (document) =>
      document.document_status === "verified" && categories.has(document.document_category)
  );
}

function initialForm(stage, account, detail) {
  if (stage === "collections") {
    const next = (detail?.schedule || []).find(
      (row) => !["paid", "cancelled", "waived"].includes(row.schedule_status)
    );
    const due = next
      ? Math.max(
          Number(next.scheduled_amount || 0) +
            Number(next.late_charge_amount || 0) -
            Number(next.waived_charge_amount || 0) -
            Number(next.amount_paid || 0),
          0
        )
      : Number(account.outstanding_balance || 0);
    return {
      amount: Math.min(due || Number(account.outstanding_balance || 0), Number(account.outstanding_balance || 0)).toFixed(2),
      payment_method: "cash",
      reference_number: "",
      notes: "",
      idempotency_key: secureKey("finance-collection", account.agreement_id),
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
      customer_signature_document_id: "",
      delivery_note_document_id: "",
      notes: "",
      idempotency_key: secureKey("finance-delivery", account.agreement_id),
    };
  }
  return {
    transfer_date: new Date().toISOString().slice(0, 10),
    ownership_document_id: "",
    registration_transfer_reference: "",
    notes: "",
    idempotency_key: secureKey("finance-ownership", account.agreement_id),
  };
}

function Dialog({ title, subtitle, onClose, children }) {
  return (
    <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={() => onClose()}>
      <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="finance-simple__section-header">
          <div><p className="finance-simple__eyebrow">Company-wide Finance</p><h2>{title}</h2><span className="finance-simple__muted">{subtitle}</span></div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function EquipmentFinanceCompanyWideLifecyclePage() {
  const location = useLocation();
  const stage = stageFrom(location.search);
  const copy = stageContent(stage);
  const { user, workspaceRole } = useAuth();
  const role = currentRole(user, workspaceRole);
  const owner = Boolean(user?.is_original_system_administrator);
  const canAct = owner || (stage === "collections" ? COLLECTION_ROLES.has(role) : FINAL_ROLES.has(role));

  const [readiness, setReadiness] = useState({ ready: null });
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const next = readinessResponse.data?.readiness || { ready: true };
      setReadiness(next);
      if (!next.ready) return;
      const response = await axiosClient.get(`${API}/accounts`);
      setAccounts(response.data?.accounts || []);
    } catch (error) {
      const next = error?.response?.data?.readiness;
      if (next?.ready === false) setReadiness(next);
      else setProblem(errorMessage(error, "Could not load Finance accounts."));
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

  const visible = useMemo(
    () => accounts.filter((account) => belongs(account, stage) && matches(account, search)),
    [accounts, search, stage]
  );

  async function open(account) {
    if (!canAct) {
      setProblem("Your role can view this queue but cannot complete this controlled Finance action.");
      return;
    }
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/accounts/${account.agreement_id}`);
      const nextDetail = response.data || {};
      setSelected(account);
      setDetail(nextDetail);
      setForm(initialForm(stage, account, nextDetail));
    } catch (error) {
      setProblem(errorMessage(error, "Could not open the Finance agreement file."));
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!selected || !form) return;
    setSaving(true);
    setProblem("");
    try {
      const suffix =
        stage === "collections"
          ? "collections"
          : stage === "delivery"
            ? "delivery"
            : "ownership-transfer";
      const response = await axiosClient.post(
        `${API}/accounts/${selected.agreement_id}/${suffix}`,
        form
      );
      if (stage === "collections") {
        setReceipt({
          payment_id: response.data?.payment_id,
          receipt_number: response.data?.receipt_number,
          boss_payment_alert: response.data?.boss_payment_alert,
        });
      }
      setSelected(null);
      setDetail(null);
      setForm(null);
      setNotice(response.data?.message || "Finance action completed.");
      await load();
    } catch (error) {
      setProblem(errorMessage(error, "Could not complete the Finance action."));
    } finally {
      setSaving(false);
    }
  }

  const signatureDocuments = verifiedDocuments(
    detail,
    new Set(["customer_signature", "buyer_signature", "signed_handover"])
  );
  const deliveryDocuments = verifiedDocuments(
    detail,
    new Set(["delivery_note", "delivery_evidence", "signed_handover"])
  );
  const ownershipDocuments = verifiedDocuments(
    detail,
    new Set(["ownership_document", "ownership_transfer", "registration_transfer"])
  );

  return (
    <main className="finance-simple">
      <header className="finance-simple__hero">
        <div>
          <p>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <span>
            Every action is tied to the exact customer, excavator and agreement. No Hire location is selected or stored.
          </span>
        </div>
        <div className="finance-simple__hero-actions">
          <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=operations&tab=case">Case Operations</Link>
          <Link className="finance-simple__button" to="/equipment-installment-finance/reports">Documents & Reports</Link>
        </div>
      </header>

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}
      {receipt ? (
        <div className="finance-simple__notice is-info">
          <strong>Receipt {receipt.receipt_number}</strong>
          <p>
            Payment allocation and outstanding balance are saved. Boss alert status: {label(receipt.boss_payment_alert?.status || "not confirmed")}.
          </p>
          <Link to="/equipment-installment-finance/applications?stage=operations&tab=case">Open receipt sharing and evidence</Link>
        </div>
      ) : null}

      <nav className="finance-simple__tabs" aria-label="Finance lifecycle stages">
        <Link className={stage === "collections" ? "is-active" : ""} to="/equipment-installment-finance/applications?stage=collections">Collections</Link>
        <Link className={stage === "delivery" ? "is-active" : ""} to="/equipment-installment-finance/applications?stage=delivery">Delivery</Link>
        <Link className={stage === "ownership" ? "is-active" : ""} to="/equipment-installment-finance/applications?stage=ownership">Ownership</Link>
      </nav>

      {readiness.ready === false ? (
        <section className="finance-simple__section">
          <h2>Finance lifecycle is being prepared</h2>
          <p>Missing: {(readiness.missing_tables || []).join(", ") || "company-wide stabilization"}</p>
        </section>
      ) : null}

      {readiness.ready === true ? (
        <section className="finance-simple__section">
          <div className="finance-simple__toolbar">
            <div><p className="finance-simple__eyebrow">Controlled queue</p><h2>{visible.length} account(s)</h2></div>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, agreement or excavator" />
          </div>
          {loading ? <div className="finance-simple__empty">Loading Finance accounts…</div> : null}
          {!loading && !visible.length ? <div className="finance-simple__empty">{copy.empty}</div> : null}
          <div className="finance-simple__cards">
            {visible.map((account) => (
              <article className="finance-simple__card" key={account.agreement_id}>
                <div className="finance-simple__machine-image">
                  {account.main_image_url ? <img src={account.main_image_url} alt={account.asset_name} /> : <span>🚜</span>}
                </div>
                <div className="finance-simple__card-body">
                  <div className="finance-simple__card-head">
                    <div><small>{account.agreement_number}</small><h3>{account.customer_name}</h3><p>{account.asset_code} — {account.asset_name}</p></div>
                    <span className={`finance-simple__pill ${account.overdue_amount > 0 ? "is-danger" : "is-good"}`}>{label(account.agreement_status)}</span>
                  </div>
                  <div className="finance-simple__facts">
                    <div><span>Outstanding</span><strong>{money(account.outstanding_balance)}</strong></div>
                    <div><span>Paid</span><strong>{money(account.amount_paid)}</strong></div>
                    <div><span>Next due</span><strong>{dateLabel(account.next_due_date)}</strong></div>
                    <div><span>Interval</span><strong>{account.payment_frequency === "custom" ? `Every ${account.payment_interval_days} days` : label(account.payment_frequency)}</strong></div>
                    <div><span>Delivery</span><strong>{label(account.delivery_status)}</strong></div>
                    <div><span>Ownership</span><strong>{label(account.ownership_status)}</strong></div>
                  </div>
                  <button className="is-primary" type="button" onClick={() => open(account)} disabled={!canAct}>{copy.action}</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {selected && form ? (
        <Dialog title={copy.action} subtitle={`${selected.agreement_number} · ${selected.customer_name} · ${selected.asset_code}`} onClose={() => setSelected(null)}>
          <div className="finance-simple__notice is-info">
            This action records no Hire enquiry, Hire contract, Hire job or Hire location.
          </div>
          <form onSubmit={submit}>
            <div className="finance-simple__grid">
              {stage === "collections" ? (
                <>
                  <Field title="Amount received" hint={`Cannot exceed ${money(selected.outstanding_balance)}.`}><input type="number" min="0.01" max={selected.outstanding_balance} step="0.01" required value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></Field>
                  <Field title="Payment method"><select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}><option value="cash">Cash</option><option value="momo">Mobile money</option><option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="other">Other</option></select></Field>
                  <Field title="Reference number" hint="Optional"><input value={form.reference_number} onChange={(event) => setForm((current) => ({ ...current, reference_number: event.target.value }))} /></Field>
                  <Field title="Collection notes" wide hint="Optional"><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
                </>
              ) : null}

              {stage === "delivery" ? (
                <>
                  <Field title="Machine condition"><select value={form.condition_status} onChange={(event) => setForm((current) => ({ ...current, condition_status: event.target.value }))}><option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option><option value="under_inspection">Under inspection</option></select></Field>
                  <Field title="Meter reading"><input type="number" min="0" step="0.01" required value={form.meter_reading} onChange={(event) => setForm((current) => ({ ...current, meter_reading: event.target.value }))} /></Field>
                  <Field title="Fuel level %"><input type="number" min="0" max="100" step="0.01" required value={form.fuel_level_percent} onChange={(event) => setForm((current) => ({ ...current, fuel_level_percent: event.target.value }))} /></Field>
                  <Field title="Receiving person"><input required value={form.receiving_person} onChange={(event) => setForm((current) => ({ ...current, receiving_person: event.target.value }))} /></Field>
                  <Field title="Receiving phone"><input value={form.receiving_phone} onChange={(event) => setForm((current) => ({ ...current, receiving_phone: event.target.value }))} /></Field>
                  <Field title="Destination" wide><input value={form.destination} onChange={(event) => setForm((current) => ({ ...current, destination: event.target.value }))} /></Field>
                  <Field title="Verified customer signature"><select required value={form.customer_signature_document_id} onChange={(event) => setForm((current) => ({ ...current, customer_signature_document_id: event.target.value }))}><option value="">Choose verified signature evidence</option>{signatureDocuments.map((document) => <option key={document.id} value={document.id}>{document.document_label} — {document.original_file_name}</option>)}</select></Field>
                  <Field title="Verified delivery note"><select required value={form.delivery_note_document_id} onChange={(event) => setForm((current) => ({ ...current, delivery_note_document_id: event.target.value }))}><option value="">Choose verified delivery evidence</option>{deliveryDocuments.map((document) => <option key={document.id} value={document.id}>{document.document_label} — {document.original_file_name}</option>)}</select></Field>
                  {!signatureDocuments.length || !deliveryDocuments.length ? <div className="finance-simple__notice is-warning"><strong>Verified handover documents are missing.</strong><p>Upload and verify them in Case Operations before delivery.</p></div> : null}
                  <Field title="Attachments, keys and tools" wide><textarea value={form.attachments_tools} onChange={(event) => setForm((current) => ({ ...current, attachments_tools: event.target.value }))} /></Field>
                  <Field title="Handover notes" wide><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
                </>
              ) : null}

              {stage === "ownership" ? (
                <>
                  <Field title="Transfer date"><input type="date" required value={form.transfer_date} onChange={(event) => setForm((current) => ({ ...current, transfer_date: event.target.value }))} /></Field>
                  <Field title="Registration transfer reference"><input value={form.registration_transfer_reference} onChange={(event) => setForm((current) => ({ ...current, registration_transfer_reference: event.target.value }))} /></Field>
                  <Field title="Verified ownership document" wide><select required value={form.ownership_document_id} onChange={(event) => setForm((current) => ({ ...current, ownership_document_id: event.target.value }))}><option value="">Choose verified ownership evidence</option>{ownershipDocuments.map((document) => <option key={document.id} value={document.id}>{document.document_label} — {document.original_file_name}</option>)}</select></Field>
                  {!ownershipDocuments.length ? <div className="finance-simple__notice is-warning"><strong>Verified ownership evidence is missing.</strong><p>Upload and verify it in Case Operations before ownership transfer.</p></div> : null}
                  <Field title="Ownership notes" wide><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
                </>
              ) : null}
            </div>
            <div className="finance-simple__sticky-actions">
              <span>{selected.asset_code} · {money(selected.outstanding_balance)} outstanding</span>
              <div><button type="button" onClick={() => setSelected(null)}>Cancel</button><button className="is-primary" type="submit" disabled={saving}>{saving ? "Saving…" : copy.action}</button></div>
            </div>
          </form>
        </Dialog>
      ) : null}
    </main>
  );
}
