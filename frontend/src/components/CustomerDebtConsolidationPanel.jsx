import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import CustomerDebtPrintPanel from "./CustomerDebtPrintPanel";
import { formatBusinessDate, formatBusinessDateTime } from "../utils/businessDate";
import "../styles/customerDebtConsolidation.css";

function formatMoney(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusLabel(value) {
  const status = String(value || "").toLowerCase();
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partial";
  return "Unpaid";
}

export default function CustomerDebtConsolidationPanel({
  currentStoreCode = "STORE",
  currentStoreName = "Selected Store",
  userRole = "",
  onRecordPayment,
  onRefresh,
}) {
  const [customers, setCustomers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [unlinked, setUnlinked] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [masterCustomerId, setMasterCustomerId] = useState("");
  const [sourceCustomerIds, setSourceCustomerIds] = useState([]);
  const [mergeReason, setMergeReason] = useState("");
  const [mergeConfirmation, setMergeConfirmation] = useState("");
  const [merging, setMerging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canMerge = ["admin", "manager"].includes(
    String(userRole || "").toLowerCase()
  );

  async function loadCustomers() {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/debt-customers");
      setCustomers(response.data.customers || []);
      setSummary(response.data.summary || null);
      setUnlinked(response.data.unlinked || null);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not load consolidated customer debts."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;

    return customers.filter((customer) =>
      [
        customer.customer_name,
        customer.customer_phone,
        customer.customer_location,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [customers, search]);

  async function openCustomer(customerId) {
    setDetailLoading(true);
    setError("");

    try {
      const response = await axiosClient.get(`/debt-customers/${customerId}`);
      setSelectedCustomer(response.data);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not load this customer's debt breakdown."
      );
    } finally {
      setDetailLoading(false);
    }
  }

  function toggleSource(customerId) {
    const cleanId = String(customerId);
    setSourceCustomerIds((current) =>
      current.includes(cleanId)
        ? current.filter((id) => id !== cleanId)
        : [...current, cleanId]
    );
  }

  function resetMergeForm() {
    setMasterCustomerId("");
    setSourceCustomerIds([]);
    setMergeReason("");
    setMergeConfirmation("");
  }

  async function mergeCustomers(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!masterCustomerId) {
      setError("Choose the master customer record to keep.");
      return;
    }

    const sources = sourceCustomerIds.filter(
      (id) => String(id) !== String(masterCustomerId)
    );

    if (sources.length === 0) {
      setError("Select at least one duplicate customer record.");
      return;
    }

    setMerging(true);

    try {
      const response = await axiosClient.post("/debt-customers/merge", {
        target_customer_id: Number(masterCustomerId),
        source_customer_ids: sources.map(Number),
        reason: mergeReason,
        confirmation: mergeConfirmation,
      });

      setMessage(response.data.message || "Customer records merged successfully.");
      resetMergeForm();
      setMergeOpen(false);
      setSelectedCustomer(null);
      await loadCustomers();
      if (typeof onRefresh === "function") {
        await onRefresh();
      }
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not merge the selected customer records."
      );
    } finally {
      setMerging(false);
    }
  }

  function handleRecordPayment(debt) {
    if (typeof onRecordPayment === "function") {
      onRecordPayment(debt);
    }
    setSelectedCustomer(null);
  }

  return (
    <section className="customer-debt-consolidation">
      <div className="customer-debt-consolidation-heading">
        <div>
          <p>Customer Debt Consolidation</p>
          <h2>One customer, one clear debt overview</h2>
          <span>
            Every receipt and payment remains separate for audit, while the screen
            combines the balances under the correct customer.
          </span>
        </div>

        <div className="customer-debt-consolidation-actions">
          <button type="button" onClick={loadCustomers} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {canMerge ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setMergeOpen((current) => !current);
                setError("");
                setMessage("");
              }}
            >
              {mergeOpen ? "Close Merge Tool" : "Merge Duplicate Customers"}
            </button>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="customer-debt-consolidation-message success">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="customer-debt-consolidation-message error">{error}</div>
      ) : null}

      <div className="customer-debt-consolidation-metrics">
        <div>
          <span>Customers Owing</span>
          <strong>{Number(summary?.customer_count || 0)}</strong>
        </div>
        <div>
          <span>Active Debt Records</span>
          <strong>{Number(summary?.active_debt_count || 0)}</strong>
        </div>
        <div>
          <span>Outstanding</span>
          <strong>{formatMoney(summary?.outstanding_balance)}</strong>
        </div>
        <div>
          <span>Overdue Records</span>
          <strong>{Number(summary?.overdue_debt_count || 0)}</strong>
        </div>
      </div>

      {Number(unlinked?.debt_count || 0) > 0 ? (
        <div className="customer-debt-consolidation-warning">
          <strong>{unlinked.debt_count} older debt record(s) are not linked to a saved customer.</strong>
          <span>
            Outstanding unlinked amount: {formatMoney(unlinked.outstanding_balance)}.
            These records remain visible in Individual Debt Records and are not
            changed automatically.
          </span>
        </div>
      ) : null}

      {mergeOpen && canMerge ? (
        <form className="customer-debt-merge-panel" onSubmit={mergeCustomers}>
          <div>
            <p>Controlled Customer Merge</p>
            <h3>Choose the correct master customer</h3>
            <span>
              Duplicate customer identities will be removed after their sales,
              debts and installment links are reassigned. Receipts, debt records,
              items and payments are preserved.
            </span>
          </div>

          <label>
            <span>Master Customer to Keep</span>
            <select
              value={masterCustomerId}
              onChange={(event) => {
                setMasterCustomerId(event.target.value);
                setSourceCustomerIds((current) =>
                  current.filter((id) => id !== event.target.value)
                );
              }}
            >
              <option value="">Choose master customer</option>
              {customers.map((customer) => (
                <option key={customer.customer_id} value={customer.customer_id}>
                  {customer.customer_name} — {customer.customer_phone || "No phone"} —{" "}
                  {formatMoney(customer.outstanding_balance)}
                </option>
              ))}
            </select>
          </label>

          <div className="customer-debt-merge-list">
            <strong>Duplicate Customer Record(s) to Merge</strong>
            <span>Select only records that belong to the same real customer.</span>

            {customers
              .filter(
                (customer) =>
                  String(customer.customer_id) !== String(masterCustomerId)
              )
              .map((customer) => (
                <label key={customer.customer_id}>
                  <input
                    type="checkbox"
                    checked={sourceCustomerIds.includes(
                      String(customer.customer_id)
                    )}
                    onChange={() => toggleSource(customer.customer_id)}
                  />
                  <span>
                    <strong>{customer.customer_name}</strong>
                    <small>
                      {customer.customer_phone || "No phone"} ·{" "}
                      {customer.debt_count} debt record(s) ·{" "}
                      {formatMoney(customer.outstanding_balance)}
                    </small>
                  </span>
                </label>
              ))}
          </div>

          <label>
            <span>Reason for Merge</span>
            <textarea
              value={mergeReason}
              onChange={(event) => setMergeReason(event.target.value)}
              placeholder="Example: Same customer was entered several times before reusable customer search was introduced."
            />
          </label>

          <label>
            <span>Confirmation</span>
            <input
              value={mergeConfirmation}
              onChange={(event) => setMergeConfirmation(event.target.value)}
              placeholder="Type MERGE"
              autoComplete="off"
            />
          </label>

          <button type="submit" disabled={merging}>
            {merging ? "Merging Safely..." : "Merge Selected Customers"}
          </button>
        </form>
      ) : null}

      <div className="customer-debt-consolidation-search">
        <label htmlFor="customer-debt-search">Find Customer Debt</label>
        <input
          id="customer-debt-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by customer name, phone or location"
        />
      </div>

      {detailLoading ? (
        <div className="customer-debt-consolidation-loading">
          Loading customer debt breakdown...
        </div>
      ) : null}

      <div className="customer-debt-consolidation-list">
        {filteredCustomers.length === 0 && !loading ? (
          <div className="customer-debt-consolidation-empty">
            No customer debt matches this search.
          </div>
        ) : null}

        {filteredCustomers.map((customer) => (
          <article
            key={customer.customer_id}
            className="customer-debt-consolidation-card"
          >
            <div className="customer-debt-consolidation-card-main">
              <div>
                <h3>{customer.customer_name}</h3>
                <p>
                  {customer.customer_phone || "No phone"} ·{" "}
                  {customer.customer_location || "No location"}
                </p>
                <small>
                  First debt: {formatBusinessDate(customer.first_debt_date)} · Last
                  debt: {formatBusinessDate(customer.last_debt_date)}
                </small>
              </div>

              <div className="customer-debt-consolidation-balance">
                <span>Total Outstanding</span>
                <strong>{formatMoney(customer.outstanding_balance)}</strong>
                <small>
                  {customer.active_debt_count} active of {customer.debt_count} debt
                  record(s)
                </small>
              </div>
            </div>

            <div className="customer-debt-consolidation-card-grid">
              <div>
                <span>Total Owed</span>
                <strong>{formatMoney(customer.total_owed)}</strong>
              </div>
              <div>
                <span>Total Paid</span>
                <strong>{formatMoney(customer.total_paid)}</strong>
              </div>
              <div>
                <span>Next Due Date</span>
                <strong>{formatBusinessDate(customer.next_due_date)}</strong>
              </div>
              <div>
                <span>Overdue</span>
                <strong>{Number(customer.overdue_count || 0)}</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={() => openCustomer(customer.customer_id)}
            >
              Open Full Debt Breakdown
            </button>
          </article>
        ))}
      </div>

      {selectedCustomer ? (
        <div className="modal-backdrop">
          <div className="customer-debt-detail-modal">
            <div className="customer-debt-detail-header">
              <div>
                <p>Customer Debt Account</p>
                <h2>{selectedCustomer.customer?.name}</h2>
                <span>
                  {selectedCustomer.customer?.phone || "No phone"} ·{" "}
                  {selectedCustomer.customer?.location || "No location"} ·{" "}
                  {currentStoreCode} — {currentStoreName}
                </span>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={() => setSelectedCustomer(null)}
              >
                Close
              </button>
            </div>

            <div className="customer-debt-detail-summary">
              <div>
                <span>Debt Records</span>
                <strong>{selectedCustomer.summary?.debt_count || 0}</strong>
              </div>
              <div>
                <span>Total Owed</span>
                <strong>{formatMoney(selectedCustomer.summary?.total_owed)}</strong>
              </div>
              <div>
                <span>Total Paid</span>
                <strong>{formatMoney(selectedCustomer.summary?.total_paid)}</strong>
              </div>
              <div>
                <span>Outstanding</span>
                <strong>
                  {formatMoney(selectedCustomer.summary?.outstanding_balance)}
                </strong>
              </div>
            </div>

            <CustomerDebtPrintPanel
              currentStoreCode={currentStoreCode}
              preferredCustomer={{
                customer_id: selectedCustomer.customer?.id,
                customer_name: selectedCustomer.customer?.name,
                customer_phone: selectedCustomer.customer?.phone,
                name: selectedCustomer.customer?.name,
                phone: selectedCustomer.customer?.phone,
              }}
              preferredCustomerId={selectedCustomer.customer?.id}
              reportType="debt"
            />

            <div className="customer-debt-breakdown-list">
              {(selectedCustomer.debts || []).map((debt) => (
                <article key={debt.id} className="customer-debt-breakdown-card">
                  <div className="customer-debt-breakdown-heading">
                    <div>
                      <p>Receipt {debt.receipt_number || "-"}</p>
                      <h3>
                        {formatMoney(debt.balance)} outstanding
                      </h3>
                      <span>
                        Debt Date: {formatBusinessDate(debt.created_at)} · Due Date:{" "}
                        {formatBusinessDate(debt.due_date)}
                      </span>
                    </div>

                    <span className={`customer-debt-status ${String(debt.status || "").toLowerCase()}`}>
                      {statusLabel(debt.status)}
                    </span>
                  </div>

                  <div className="customer-debt-breakdown-metrics">
                    <div>
                      <span>Sale Total</span>
                      <strong>{formatMoney(debt.sale_total || debt.amount_owed)}</strong>
                    </div>
                    <div>
                      <span>Debt Owed</span>
                      <strong>{formatMoney(debt.amount_owed)}</strong>
                    </div>
                    <div>
                      <span>Paid</span>
                      <strong>{formatMoney(debt.amount_paid)}</strong>
                    </div>
                    <div>
                      <span>Payment Type</span>
                      <strong>{String(debt.payment_type || "-").toUpperCase()}</strong>
                    </div>
                    <div>
                      <span>Sold By</span>
                      <strong>{debt.staff_name || "-"}</strong>
                    </div>
                    <div>
                      <span>Sale Time</span>
                      <strong>{formatBusinessDateTime(debt.sale_date)}</strong>
                    </div>
                  </div>

                  <h4>Items Bought</h4>
                  {(debt.items || []).length === 0 ? (
                    <p className="customer-debt-breakdown-empty">
                      No item breakdown is available for this older sale.
                    </p>
                  ) : (
                    <div className="customer-debt-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Qty</th>
                            <th>Unit Price</th>
                            <th>Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {debt.items.map((item) => (
                            <tr key={item.id}>
                              <td>{item.product_name}</td>
                              <td>{item.quantity}</td>
                              <td>{formatMoney(item.unit_price)}</td>
                              <td>{formatMoney(item.line_total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <h4>Payments on This Debt</h4>
                  {(debt.payments || []).length === 0 ? (
                    <p className="customer-debt-breakdown-empty">
                      No separate debt payment has been recorded yet.
                    </p>
                  ) : (
                    <div className="customer-debt-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Method</th>
                            <th>Received By</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {debt.payments.map((payment) => (
                            <tr key={payment.id}>
                              <td>{formatBusinessDateTime(payment.paid_at)}</td>
                              <td>{formatMoney(payment.amount)}</td>
                              <td>{String(payment.payment_method || "-").toUpperCase()}</td>
                              <td>{payment.received_by_name || "-"}</td>
                              <td>{payment.notes || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {Number(debt.balance || 0) > 0 ? (
                    <button
                      type="button"
                      onClick={() => handleRecordPayment(debt)}
                    >
                      Record Payment for This Receipt
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
