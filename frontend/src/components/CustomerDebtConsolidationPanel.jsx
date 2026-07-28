import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import CustomerDebtPrintPanel from "./CustomerDebtPrintPanel";
import DebtReminderSettingsPanel from "./DebtReminderSettingsPanel";
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

function customerMatches(customer, query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return true;

  return [
    customer?.customer_id,
    customer?.customer_name,
    customer?.customer_phone,
    customer?.customer_location,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .some((value) => String(value).toLowerCase().includes(term));
}

function debtMatches(debt, query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return true;

  const values = [
    debt?.id,
    debt?.receipt_number,
    debt?.status,
    debt?.payment_type,
    debt?.staff_name,
    debt?.amount_owed,
    debt?.amount_paid,
    debt?.balance,
    ...(debt?.items || []).flatMap((item) => [
      item?.product_name,
      item?.quantity,
      item?.unit_price,
      item?.line_total,
    ]),
    ...(debt?.payments || []).flatMap((payment) => [
      payment?.payment_method,
      payment?.received_by_name,
      payment?.notes,
      payment?.amount,
    ]),
  ];

  return values
    .filter((value) => value !== undefined && value !== null && value !== "")
    .some((value) => String(value).toLowerCase().includes(term));
}

function customerOptionLabel(customer) {
  return `#${customer.customer_id} — ${customer.customer_name} — ${
    customer.customer_phone || "No phone"
  } — ${customer.customer_location || "No location"} — ${formatMoney(
    customer.outstanding_balance
  )}`;
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
  const [breakdownSearch, setBreakdownSearch] = useState("");

  const [mergeOpen, setMergeOpen] = useState(false);
  const [masterSearch, setMasterSearch] = useState("");
  const [duplicateSearch, setDuplicateSearch] = useState("");
  const [masterCustomerId, setMasterCustomerId] = useState("");
  const [sourceCustomerIds, setSourceCustomerIds] = useState([]);
  const [mergeReason, setMergeReason] = useState("");
  const [mergeConfirmation, setMergeConfirmation] = useState("");
  const [merging, setMerging] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sendingReminderCustomerId, setSendingReminderCustomerId] = useState(null);
  const [openingWhatsAppCustomerId, setOpeningWhatsAppCustomerId] = useState(null);

  const canMerge = ["admin", "manager"].includes(
    String(userRole || "").toLowerCase()
  );
  const canManageReminders = canMerge;

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

  useEffect(() => {
    if (!selectedCustomer) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setSelectedCustomer(null);
        setBreakdownSearch("");
      }
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedCustomer]);

  const filteredCustomers = useMemo(
    () => customers.filter((customer) => customerMatches(customer, search)),
    [customers, search]
  );

  const masterCandidates = useMemo(() => {
    const matches = customers.filter((customer) =>
      customerMatches(customer, masterSearch)
    );
    const selected = customers.find(
      (customer) => String(customer.customer_id) === String(masterCustomerId)
    );

    if (
      selected &&
      !matches.some(
        (customer) => String(customer.customer_id) === String(selected.customer_id)
      )
    ) {
      return [selected, ...matches];
    }

    return matches;
  }, [customers, masterCustomerId, masterSearch]);

  const duplicateCandidates = useMemo(
    () =>
      customers.filter(
        (customer) =>
          String(customer.customer_id) !== String(masterCustomerId) &&
          customerMatches(customer, duplicateSearch)
      ),
    [customers, duplicateSearch, masterCustomerId]
  );

  const visibleBreakdown = useMemo(
    () =>
      (selectedCustomer?.debts || []).filter((debt) =>
        debtMatches(debt, breakdownSearch)
      ),
    [breakdownSearch, selectedCustomer]
  );

  async function openCustomer(customerId) {
    setDetailLoading(true);
    setError("");
    setBreakdownSearch("");

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

  function closeCustomerDetail() {
    setSelectedCustomer(null);
    setBreakdownSearch("");
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
    setMasterSearch("");
    setDuplicateSearch("");
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
      closeCustomerDetail();
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

  async function sendCustomerReminderSms(customerId) {
    setMessage("");
    setError("");

    if (!canManageReminders) {
      setError("Only an administrator or manager can send debt reminders.");
      return;
    }

    setSendingReminderCustomerId(Number(customerId));
    try {
      const response = await axiosClient.post(
        `/debt-reminders/customer/${customerId}/sms`
      );
      setMessage(
        response.data.message || "Customer debt reminder SMS submitted successfully."
      );
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not send the customer debt reminder SMS."
      );
    } finally {
      setSendingReminderCustomerId(null);
    }
  }

  async function openCustomerReminderWhatsApp(customerId) {
    setMessage("");
    setError("");

    if (!canManageReminders) {
      setError("Only an administrator or manager can prepare debt reminders.");
      return;
    }

    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setOpeningWhatsAppCustomerId(Number(customerId));

    try {
      const response = await axiosClient.get(
        `/debt-reminders/customer/${customerId}/message`
      );
      const data = response.data || {};

      if (!data.channels?.whatsapp_enabled) {
        throw new Error(
          "WhatsApp reminders are disabled in Debt Reminder Settings."
        );
      }

      const digits = String(data.recipient_phone || "").replace(/\D/g, "");
      if (!digits) {
        throw new Error("This customer does not have a valid Ghana phone number.");
      }

      const url = `https://wa.me/${digits}?text=${encodeURIComponent(
        data.message || ""
      )}`;

      if (popup) {
        popup.location.href = url;
      } else {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) {
          throw new Error("Popup blocked. Allow popups and try WhatsApp again.");
        }
      }
    } catch (requestError) {
      if (popup && !popup.closed) popup.close();
      setError(
        requestError.response?.data?.message ||
          requestError.message ||
          "Could not prepare the WhatsApp debt reminder."
      );
    } finally {
      setOpeningWhatsAppCustomerId(null);
    }
  }

  function handleRecordPayment(debt) {
    if (typeof onRecordPayment === "function") {
      onRecordPayment(debt);
    }
    closeCustomerDetail();
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

      <DebtReminderSettingsPanel
        userRole={userRole}
        currentStoreCode={currentStoreCode}
        currentStoreName={currentStoreName}
      />

      {Number(unlinked?.debt_count || 0) > 0 ? (
        <div className="customer-debt-consolidation-warning">
          <strong>
            {unlinked.debt_count} older debt record(s) are not linked to a saved
            customer.
          </strong>
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
              Search by name, phone, location or customer ID. The ID and contact
              details help distinguish customers with identical names.
            </span>
          </div>

          <div className="customer-debt-merge-search-grid">
            <label>
              <span>Search Master Customer</span>
              <input
                type="search"
                value={masterSearch}
                onChange={(event) => setMasterSearch(event.target.value)}
                placeholder="Name, phone, location or customer ID"
              />
            </label>

            <label>
              <span>Search Duplicate Customer</span>
              <input
                type="search"
                value={duplicateSearch}
                onChange={(event) => setDuplicateSearch(event.target.value)}
                placeholder="Name, phone, location or customer ID"
              />
            </label>
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
              {masterCandidates.map((customer) => (
                <option key={customer.customer_id} value={customer.customer_id}>
                  {customerOptionLabel(customer)}
                </option>
              ))}
            </select>
            <small className="customer-debt-field-note">
              Showing {masterCandidates.length} matching customer record(s).
            </small>
          </label>

          <div className="customer-debt-merge-list">
            <div className="customer-debt-merge-list-heading">
              <div>
                <strong>Duplicate Customer Record(s) to Merge</strong>
                <span>Select only records belonging to the same real customer.</span>
              </div>
              <strong>{sourceCustomerIds.length} selected</strong>
            </div>

            {duplicateCandidates.length === 0 ? (
              <div className="customer-debt-consolidation-empty">
                No duplicate customer matches this search.
              </div>
            ) : null}

            {duplicateCandidates.map((customer) => (
              <label key={customer.customer_id}>
                <input
                  type="checkbox"
                  checked={sourceCustomerIds.includes(String(customer.customer_id))}
                  onChange={() => toggleSource(customer.customer_id)}
                />
                <span>
                  <strong>
                    #{customer.customer_id} — {customer.customer_name}
                  </strong>
                  <small>
                    {customer.customer_phone || "No phone"} · {customer.customer_location || "No location"}
                  </small>
                  <small>
                    {customer.debt_count} debt record(s) · {formatMoney(customer.outstanding_balance)} outstanding
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
        <div>
          <label htmlFor="customer-debt-search">Find Customer Debt</label>
          <span>
            Search by name, phone, location or the customer ID shown on each card.
          </span>
        </div>
        <div className="customer-debt-search-row">
          <input
            id="customer-debt-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone, location or customer ID"
          />
          {search ? (
            <button type="button" className="secondary-button" onClick={() => setSearch("")}>
              Clear
            </button>
          ) : null}
        </div>
        <small className="customer-debt-field-note">
          Showing {filteredCustomers.length} of {customers.length} customer account(s).
        </small>
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
                <div className="customer-debt-identity-line">
                  <span>Customer #{customer.customer_id}</span>
                  <h3>{customer.customer_name}</h3>
                </div>
                <p>
                  {customer.customer_phone || "No phone"} · {customer.customer_location || "No location"}
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

            <div className="customer-debt-card-actions">
              <button
                type="button"
                onClick={() => openCustomer(customer.customer_id)}
              >
                Open Full Debt Breakdown
              </button>

              {canManageReminders ? (
                <>
                  <button
                    type="button"
                    className="secondary-button customer-debt-reminder-button"
                    onClick={() => sendCustomerReminderSms(customer.customer_id)}
                    disabled={
                      !customer.customer_phone ||
                      sendingReminderCustomerId === Number(customer.customer_id)
                    }
                    title={
                      customer.customer_phone
                        ? "Send one consolidated SMS for this customer account"
                        : "Add a customer phone number before sending SMS"
                    }
                  >
                    {sendingReminderCustomerId === Number(customer.customer_id)
                      ? "Sending SMS..."
                      : "Send SMS Reminder"}
                  </button>
                  <button
                    type="button"
                    className="customer-debt-whatsapp-button"
                    onClick={() =>
                      openCustomerReminderWhatsApp(customer.customer_id)
                    }
                    disabled={
                      !customer.customer_phone ||
                      openingWhatsAppCustomerId === Number(customer.customer_id)
                    }
                    title={
                      customer.customer_phone
                        ? "Open a prepared consolidated WhatsApp reminder"
                        : "Add a customer phone number before using WhatsApp"
                    }
                  >
                    {openingWhatsAppCustomerId === Number(customer.customer_id)
                      ? "Opening WhatsApp..."
                      : "WhatsApp Reminder"}
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {selectedCustomer ? (
        <div
          className="modal-backdrop customer-debt-detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCustomerDetail();
          }}
        >
          <div
            className="customer-debt-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-debt-detail-title"
          >
            <div className="customer-debt-detail-header">
              <div>
                <p>Customer Debt Account</p>
                <h2 id="customer-debt-detail-title">
                  {selectedCustomer.customer?.name}
                </h2>
                <span>
                  Customer #{selectedCustomer.customer?.id} · {selectedCustomer.customer?.phone || "No phone"} · {selectedCustomer.customer?.location || "No location"} · {currentStoreCode} — {currentStoreName}
                </span>
              </div>

              <button
                type="button"
                className="secondary-button customer-debt-close-button"
                onClick={closeCustomerDetail}
              >
                Close
              </button>
            </div>

            <div className="customer-debt-detail-content">
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

              {canManageReminders ? (
                <div className="customer-debt-detail-reminder-actions">
                  <div>
                    <strong>Customer Follow-Up</strong>
                    <span>
                      Send one consolidated reminder for this customer’s complete
                      outstanding account.
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="secondary-button customer-debt-reminder-button"
                      onClick={() =>
                        sendCustomerReminderSms(selectedCustomer.customer?.id)
                      }
                      disabled={
                        !selectedCustomer.customer?.phone ||
                        sendingReminderCustomerId ===
                          Number(selectedCustomer.customer?.id)
                      }
                    >
                      {sendingReminderCustomerId ===
                      Number(selectedCustomer.customer?.id)
                        ? "Sending SMS..."
                        : "Send SMS Reminder"}
                    </button>
                    <button
                      type="button"
                      className="customer-debt-whatsapp-button"
                      onClick={() =>
                        openCustomerReminderWhatsApp(selectedCustomer.customer?.id)
                      }
                      disabled={
                        !selectedCustomer.customer?.phone ||
                        openingWhatsAppCustomerId ===
                          Number(selectedCustomer.customer?.id)
                      }
                    >
                      {openingWhatsAppCustomerId ===
                      Number(selectedCustomer.customer?.id)
                        ? "Opening WhatsApp..."
                        : "WhatsApp Reminder"}
                    </button>
                  </div>
                </div>
              ) : null}

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

              <div className="customer-debt-breakdown-search">
                <div>
                  <label htmlFor="customer-debt-breakdown-search">
                    Search This Customer's Debt Records
                  </label>
                  <span>
                    Find a receipt, item, payment method, staff member or amount.
                  </span>
                </div>
                <div className="customer-debt-search-row">
                  <input
                    id="customer-debt-breakdown-search"
                    type="search"
                    value={breakdownSearch}
                    onChange={(event) => setBreakdownSearch(event.target.value)}
                    placeholder="Receipt, item, staff, payment method or amount"
                  />
                  {breakdownSearch ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setBreakdownSearch("")}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <small className="customer-debt-field-note">
                  Showing {visibleBreakdown.length} of {selectedCustomer.debts?.length || 0} debt record(s).
                </small>
              </div>

              <div className="customer-debt-breakdown-list">
                {visibleBreakdown.length === 0 ? (
                  <div className="customer-debt-consolidation-empty">
                    No debt record matches this search.
                  </div>
                ) : null}

                {visibleBreakdown.map((debt) => (
                  <article key={debt.id} className="customer-debt-breakdown-card">
                    <div className="customer-debt-breakdown-heading">
                      <div>
                        <p>Receipt {debt.receipt_number || "-"}</p>
                        <h3>{formatMoney(debt.balance)} outstanding</h3>
                        <span>
                          Debt #{debt.id} · Debt Date: {formatBusinessDate(debt.created_at)} · Due Date: {formatBusinessDate(debt.due_date)}
                        </span>
                      </div>

                      <span
                        className={`customer-debt-status ${String(
                          debt.status || ""
                        ).toLowerCase()}`}
                      >
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
                                <td>
                                  {String(payment.payment_method || "-").toUpperCase()}
                                </td>
                                <td>{payment.received_by_name || "-"}</td>
                                <td>{payment.notes || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {Number(debt.balance || 0) > 0 ? (
                      <button type="button" onClick={() => handleRecordPayment(debt)}>
                        Record Payment for This Receipt
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
