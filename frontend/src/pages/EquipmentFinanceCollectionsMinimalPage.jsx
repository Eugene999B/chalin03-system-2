import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/equipmentFinancePhaseOne.css";
import "../styles/equipmentFinanceSimplifiedWorkspace.css";

const API = "/equipment-catalogue/sales/finance-lifecycle";
const COLLECTION_ROLES = new Set([
  "finance_manager",
  "finance_accountant",
  "collections_officer",
  "equipment_business_manager",
  "equipment_business_accountant",
]);

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
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
}

function nextDueLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return due < today ? "—" : dateLabel(value);
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function requestKey(agreementId) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error("Use a current browser before recording a Finance payment.");
  }
  return `finance-collection:${agreementId}:${uuid}`;
}

function isCollectable(account) {
  return (
    account.reserved &&
    !account.ownership_id &&
    Number(account.outstanding_balance || 0) > 0.01
  );
}

export default function EquipmentFinanceCollectionsMinimalPage({ embedded = false }) {
  const location = useLocation();
  const requestedAgreement = new URLSearchParams(location.search).get("agreement");
  const { user, workspaceRole } = useAuth();
  const role = String(
    workspaceRole || user?.workspace_role || user?.access_role || user?.role || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const canCollect =
    Boolean(user?.is_original_system_administrator) ||
    ["admin", "administrator", "manager", "system_administrator", "super_admin"].includes(role) ||
    COLLECTION_ROLES.has(role);

  const [readiness, setReadiness] = useState({ ready: null });
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    amount: "",
    payment_method: "cash",
    reference_number: "",
    notes: "",
    idempotency_key: "",
  });

  const closeDetail = useCallback(() => {
    setSelected(null);
    setDetail(null);
  }, []);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setProblem("");
    try {
      const readinessResponse = await axiosClient.get(`${API}/readiness`);
      const nextReadiness = readinessResponse.data?.readiness || { ready: true };
      setReadiness(nextReadiness);
      if (!nextReadiness.ready) {
        setAccounts([]);
        return [];
      }
      const response = await axiosClient.get(`${API}/accounts`);
      const nextAccounts = response.data?.accounts || [];
      setAccounts(nextAccounts);
      return nextAccounts;
    } catch (error) {
      const responseReadiness = error?.response?.data?.readiness;
      if (responseReadiness?.ready === false) {
        setReadiness(responseReadiness);
        setAccounts([]);
        return [];
      }
      setProblem(errorMessage(error, "Could not load Finance accounts."));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (account) => {
    if (!account?.agreement_id) return;
    setDetailLoading(true);
    setProblem("");
    try {
      const response = await axiosClient.get(`${API}/accounts/${account.agreement_id}`);
      const serverAccount = response.data?.account || account;
      setSelected(serverAccount);
      setDetail(response.data || null);
      setForm({
        amount: "",
        payment_method: "cash",
        reference_number: "",
        notes: "",
        idempotency_key: requestKey(serverAccount.agreement_id),
      });
    } catch (error) {
      setProblem(errorMessage(error, "Could not load the Finance account file."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function prepare() {
      const nextAccounts = await loadAccounts();
      if (!active || !requestedAgreement) return;
      const requested = nextAccounts.find(
        (account) => String(account.agreement_id) === String(requestedAgreement)
      );
      if (requested) await loadDetail(requested);
    }
    prepare();
    return () => {
      active = false;
    };
  }, [loadAccounts, loadDetail, requestedAgreement]);

  const visibleAccounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return accounts.filter((account) => {
      if (!isCollectable(account)) return false;
      if (!term) return true;
      return [
        account.agreement_number,
        account.application_number,
        account.customer_name,
        account.customer_phone,
        account.asset_code,
        account.asset_name,
        account.serial_number,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [accounts, search]);

  async function recordPayment(event) {
    event.preventDefault();
    if (!selected) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setProblem("Enter a valid payment amount.");
      return;
    }
    if (amount > Number(selected.outstanding_balance || 0) + 0.01) {
      setProblem("The payment cannot exceed the official outstanding balance.");
      return;
    }

    setSaving(true);
    setProblem("");
    setNotice("");
    try {
      const response = await axiosClient.post(
        `${API}/accounts/${selected.agreement_id}/collections`,
        form
      );
      const receiptNumber = response.data?.receipt_number;
      setNotice(
        `${response.data?.message || "Payment recorded."}${
          receiptNumber ? ` Receipt: ${receiptNumber}.` : ""
        }`
      );
      const nextAccounts = await loadAccounts();
      const updatedAccount =
        response.data?.account ||
        nextAccounts.find(
          (account) => String(account.agreement_id) === String(selected.agreement_id)
        ) ||
        selected;
      await loadDetail(updatedAccount);
    } catch (error) {
      setProblem(errorMessage(error, "Could not record the Finance payment."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`finance-simple finance-simplified ${embedded ? "finance-simplified__embedded" : ""}`} data-testid="finance-collections-minimal">
      {!embedded ? (
        <header className="finance-simple__hero">
          <div>
            <p>Search, select, then record</p>
            <h1>Collections &amp; Payment History</h1>
            <span>
              Search an active account first. The payment form and complete account details open
              only after the correct customer agreement is selected.
            </span>
          </div>
          <div className="finance-simple__hero-actions">
            <Link className="finance-simple__button" to="/equipment-installment-finance">Workflow home</Link>
            <Link className="finance-simple__button" to="/equipment-installment-finance/applications?stage=deposit">Opening deposit</Link>
          </div>
        </header>
      ) : null}

      {problem ? <div className="finance-simple__notice is-error" role="alert">{problem}</div> : null}
      {notice ? <div className="finance-simple__notice" role="status">{notice}</div> : null}
      {!embedded ? (
        <div className="finance-simple__notice is-info">
          Official balances are returned by the backend from committed receipts and schedule allocations.
        </div>
      ) : null}

      {readiness.ready === false ? (
        <section className="finance-simple__section">
          <h2>Collections are not ready</h2>
          <p>Missing: {(readiness.missing_tables || readiness.missing_columns || []).join(", ")}</p>
        </section>
      ) : null}

      {readiness.ready === true ? (
        <section className="finance-simple__section">
          <div className="finance-simple__toolbar">
            <div>
              <p className="finance-simple__eyebrow">Choose account</p>
              <h2>{visibleAccounts.length} payment-ready account(s)</h2>
            </div>
            <input
              aria-label="Search payment-ready Finance accounts"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search agreement, customer, phone or excavator"
              autoComplete="off"
            />
          </div>

          {loading ? <div className="finance-simple__empty">Loading official accounts…</div> : null}
          {!loading && !visibleAccounts.length ? (
            <div className="finance-simple__empty">No reserved installment account currently has an outstanding balance.</div>
          ) : null}

          <div className="finance-simplified__compact-register">
            {visibleAccounts.map((account) => (
              <article className="finance-simplified__compact-record" key={account.agreement_id}>
                <div>
                  <small>{account.agreement_number}</small>
                  <h3>{account.customer_name}</h3>
                  <p>{account.asset_code} — {account.asset_name}</p>
                </div>
                <div className="finance-simplified__compact-fact">
                  <span>Official balance</span>
                  <strong data-testid="collection-official-balance">{money(account.outstanding_balance)}</strong>
                </div>
                <div className="finance-simplified__compact-fact">
                  <span>Next due</span>
                  <strong>{nextDueLabel(account.next_due_date)}</strong>
                </div>
                <div className="finance-simplified__compact-record-actions">
                  <button
                    className="is-primary"
                    type="button"
                    disabled={!canCollect}
                    onClick={() => loadDetail(account)}
                  >
                    Select Account
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {selected ? (
        <div className="finance-simple__dialog-backdrop" role="presentation" onMouseDown={closeDetail}>
          <section className="finance-simple__dialog" role="dialog" aria-modal="true" aria-label="Finance account and payment entry" data-testid="finance-account-detail" onMouseDown={(event) => event.stopPropagation()}>
            <div className="finance-simple__section-header">
              <div>
                <p className="finance-simple__eyebrow">Selected account</p>
                <h2>{selected.agreement_number}</h2>
                <span className="finance-simple__muted">{selected.customer_name} · {selected.asset_code} {selected.asset_name}</span>
              </div>
              <button type="button" onClick={closeDetail}>Close</button>
            </div>

            {detailLoading ? <div className="finance-simple__empty">Loading account details…</div> : null}
            {!detailLoading ? (
              <>
                {detail?.reconciliation?.consistent === false ? (
                  <div className="finance-simple__alert is-warning" data-testid="finance-reconciliation-warning">
                    This account is temporarily locked because its receipts, allocations, schedule and ledger do not reconcile.
                  </div>
                ) : null}
                <div className="finance-simple__summary">
                  <article><span>Purchase price</span><strong>{money(selected.total_amount)}</strong></article>
                  <article><span>Total paid</span><strong>{money(selected.amount_paid)}</strong></article>
                  <article><span>Official balance</span><strong data-testid="account-detail-official-balance">{money(selected.outstanding_balance)}</strong></article>
                  <article><span>Next due</span><strong>{nextDueLabel(selected.next_due_date)}</strong></article>
                </div>

                <form onSubmit={recordPayment}>
                  <div className="finance-simple__grid">
                    <label className="finance-simple__field">
                      <span>Amount received</span>
                      <input type="number" min="0.01" max={selected.outstanding_balance} step="0.01" required value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
                    </label>
                    <label className="finance-simple__field">
                      <span>Payment method</span>
                      <select value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}>
                        <option value="cash">Cash</option>
                        <option value="momo">Mobile money</option>
                        <option value="bank">Bank transfer</option>
                        <option value="cheque">Cheque</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="finance-simple__field">
                      <span>Reference number</span>
                      <input value={form.reference_number} onChange={(event) => setForm((current) => ({ ...current, reference_number: event.target.value }))} />
                    </label>
                    <label className="finance-simple__field">
                      <span>Payment note</span>
                      <input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
                    </label>
                  </div>
                  <div className="finance-simple__sticky-actions">
                    <span>Maximum: {money(selected.outstanding_balance)}</span>
                    <div>
                      <button type="button" onClick={closeDetail}>Cancel</button>
                      <button className="is-primary" type="submit" disabled={!canCollect || saving || detail?.reconciliation?.consistent === false}>
                        {saving ? "Recording payment…" : "Record Payment"}
                      </button>
                    </div>
                  </div>
                </form>

                <details>
                  <summary>Show payment schedule and receipt history</summary>
                  <div className="finance-simple__grid">
                    <section className="finance-simple__section">
                      <h3>Payment schedule</h3>
                      <div className="finance-simple__schedule-list">
                        {(detail?.schedule || []).map((row) => (
                          <article key={row.id || row.sequence_number}>
                            <span>Payment {row.sequence_number}</span>
                            <strong>{dateLabel(row.due_date)}</strong>
                            <b>{money(row.scheduled_amount)}</b>
                            <small>{label(row.schedule_status)}</small>
                          </article>
                        ))}
                      </div>
                    </section>
                    <section className="finance-simple__section" data-testid="payment-history">
                      <h3>Payment history</h3>
                      {!(detail?.payments || []).length ? <div className="finance-simple__empty">No payment has been recorded.</div> : (
                        <div className="finance-simple__schedule-list">
                          {(detail?.payments || []).map((payment) => (
                            <article key={payment.id} data-testid="payment-history-row">
                              <span>{payment.receipt_number || payment.payment_number}</span>
                              <strong>{dateLabel(payment.payment_date)}</strong>
                              <b>{money(payment.amount)}</b>
                              <small>{label(payment.payment_method)}</small>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </details>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}