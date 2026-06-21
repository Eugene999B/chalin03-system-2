import { useState } from "react";
import axiosClient from "../api/axiosClient";

export default function CustomerStatementPage() {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [statement, setStatement] = useState(null);

  const [searching, setSearching] = useState(false);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatDateTime(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleDateString();
  }

  function isVoidedSale(sale) {
    return Number(sale.is_voided || 0) === 1 || sale.sale_status === "cancelled";
  }

  function makeSafeFileName(value) {
    return String(value || "customer")
      .replace(/[^a-z0-9]/gi, "-")
      .replace(/-+/g, "-")
      .toLowerCase();
  }

  async function searchCustomers(event) {
    event.preventDefault();

    setError("");
    setStatement(null);

    if (!query.trim()) {
      setCustomers([]);
      setError("Enter customer name or phone number.");
      return;
    }

    setSearching(true);

    try {
      const response = await axiosClient.get("/customer-statements/search", {
        params: {
          query: query.trim(),
        },
      });

      setCustomers(response.data.customers || []);
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to search customer records."
      );
    } finally {
      setSearching(false);
    }
  }

  async function loadStatement(customer) {
    setError("");
    setLoadingStatement(true);

    try {
      const response = await axiosClient.get("/customer-statements", {
        params: {
          name: customer.customer_name || "",
          phone: customer.customer_phone || "",
        },
      });

      setStatement(response.data);
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to load customer statement."
      );
    } finally {
      setLoadingStatement(false);
    }
  }

  async function exportStatement() {
    setError("");

    if (!statement?.customer?.name && !statement?.customer?.phone) {
      setError("Load a customer statement before exporting.");
      return;
    }

    setExporting(true);

    try {
      const response = await axiosClient.get("/exports/customer-statement", {
        params: {
          name: statement.customer?.name || "",
          phone: statement.customer?.phone || "",
        },
        responseType: "blob",
      });

      const fileUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");

      const safeName = makeSafeFileName(
        statement.customer?.phone || statement.customer?.name || "customer"
      );

      link.href = fileUrl;
      link.setAttribute(
        "download",
        `chalin03-customer-statement-${safeName}.xlsx`
      );

      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (error) {
      setError(
        "Failed to export customer statement. Make sure the backend export route is working."
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Customer Statement</h1>
          <p>Search a customer and view sales, debts, payments and balance</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="section-card">
        <h2>Search Customer</h2>

        <form onSubmit={searchCustomers} className="filter-grid">
          <div>
            <label>Customer Name or Phone</label>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Example: Ama or 024..."
            />
          </div>

          <div className="filter-actions">
            <button type="submit" disabled={searching}>
              {searching ? "Searching..." : "Search"}
            </button>
          </div>
        </form>
      </div>

      {customers.length > 0 && (
        <div className="section-card">
          <h2>Search Results</h2>

          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Sales Count</th>
                <th>Total Sales</th>
                <th>Sales Balance</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {customers.map((customer, index) => (
                <tr key={`${customer.customer_phone || "no-phone"}-${index}`}>
                  <td>{customer.customer_name || "-"}</td>
                  <td>{customer.customer_phone || "-"}</td>
                  <td>{Number(customer.sales_count || 0)}</td>
                  <td>{formatMoney(customer.total_sales)}</td>
                  <td>{formatMoney(customer.sales_balance)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => loadStatement(customer)}
                      disabled={loadingStatement}
                    >
                      View Statement
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loadingStatement && (
        <div className="section-card">
          <p>Loading customer statement...</p>
        </div>
      )}

      {statement && (
        <>
          <div className="section-card">
            <div className="page-header">
              <div>
                <h2>
                  Statement for {statement.customer?.name || "Customer"}{" "}
                  {statement.customer?.phone
                    ? `(${statement.customer.phone})`
                    : ""}
                </h2>
                <p>Customer sales, debts, payments and outstanding balance</p>
              </div>

              <button
                type="button"
                onClick={exportStatement}
                disabled={exporting}
              >
                {exporting ? "Exporting..." : "Export Statement"}
              </button>
            </div>

            <div className="cards-grid">
              <div className="stat-card">
                <span>Total Sales</span>
                <strong>{formatMoney(statement.summary?.total_sales)}</strong>
              </div>

              <div className="stat-card">
                <span>Total Paid on Sales</span>
                <strong>
                  {formatMoney(statement.summary?.total_paid_on_sales)}
                </strong>
              </div>

              <div className="stat-card">
                <span>Debt Payments</span>
                <strong>
                  {formatMoney(statement.summary?.total_debt_payments)}
                </strong>
              </div>

              <div className="stat-card">
                <span>Total Received</span>
                <strong>{formatMoney(statement.summary?.total_received)}</strong>
              </div>

              <div className="stat-card">
                <span>Outstanding Balance</span>
                <strong>
                  {formatMoney(statement.summary?.total_outstanding)}
                </strong>
              </div>

              <div className="stat-card">
                <span>Debts Count</span>
                <strong>{Number(statement.summary?.debts_count || 0)}</strong>
              </div>
            </div>
          </div>

          <div className="section-card">
            <h2>Sales History</h2>

            {statement.sales?.length === 0 ? (
              <p>No sales found for this customer.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Receipt</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Staff</th>
                  </tr>
                </thead>

                <tbody>
                  {statement.sales.map((sale) => {
                    const voided = isVoidedSale(sale);

                    return (
                      <tr key={sale.id}>
                        <td>{formatDateTime(sale.created_at)}</td>
                        <td>{sale.receipt_number}</td>
                        <td>{voided ? "VOIDED" : formatMoney(sale.total)}</td>
                        <td>
                          {voided ? "VOIDED" : formatMoney(sale.amount_paid)}
                        </td>
                        <td>{voided ? "VOIDED" : formatMoney(sale.balance)}</td>
                        <td>{sale.payment_type}</td>
                        <td>{voided ? "Voided/Cancelled" : sale.sale_status}</td>
                        <td>{sale.staff_name || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="section-card">
            <h2>Debt Records</h2>

            {statement.debts?.length === 0 ? (
              <p>No debt records found for this customer.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Receipt</th>
                    <th>Amount Owed</th>
                    <th>Amount Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>Due Date</th>
                  </tr>
                </thead>

                <tbody>
                  {statement.debts.map((debt) => (
                    <tr key={debt.id}>
                      <td>{formatDateTime(debt.created_at)}</td>
                      <td>{debt.receipt_number || "-"}</td>
                      <td>{formatMoney(debt.amount_owed)}</td>
                      <td>{formatMoney(debt.amount_paid)}</td>
                      <td>{formatMoney(debt.balance)}</td>
                      <td>{debt.status}</td>
                      <td>{formatDate(debt.due_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="section-card">
            <h2>Debt Payment History</h2>

            {statement.debt_payments?.length === 0 ? (
              <p>No debt payments found for this customer.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Receipt</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Received By</th>
                    <th>Notes</th>
                  </tr>
                </thead>

                <tbody>
                  {statement.debt_payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{formatDateTime(payment.paid_at)}</td>
                      <td>{payment.receipt_number || "-"}</td>
                      <td>{formatMoney(payment.amount)}</td>
                      <td>{payment.payment_method}</td>
                      <td>{payment.received_by_name || "-"}</td>
                      <td>{payment.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}