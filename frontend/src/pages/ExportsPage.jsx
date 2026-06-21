import { useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function ExportsPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  async function downloadFile(endpoint, filename, useDateFilter = false) {
    setError("");

    try {
      const response = await axiosClient.get(endpoint, {
        params: useDateFilter
          ? {
              from,
              to,
            }
          : {},
        responseType: "blob",
      });

      const fileUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");

      link.href = fileUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (error) {
      setError("Export failed. Make sure you are logged in as admin or manager.");
    }
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open Exports.</p>
          </div>
        </div>

        <div className="error-box">
          Only admin and manager accounts can export business records.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Exports</h1>
          <p>Download business records as Excel files</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="section-card">
        <h2>Date Filter</h2>
        <p>
          The date filter affects Sales, Expenses, Purchases, Returns, Stock
          Adjustments, Debt Payments and Daily Closings exports. Products, Low
          Stock and Debts export all records.
        </p>

        <div className="filter-grid export-filter-grid">
          <div>
            <label>From Date</label>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>

          <div>
            <label>To Date</label>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          <div className="filter-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              Clear Dates
            </button>
          </div>
        </div>
      </div>

      <div className="exports-grid">
        <div className="section-card export-card">
          <h2>Products</h2>
          <p>Download product list, stock quantity, prices and barcode.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile("/exports/products", "chalin03-products.xlsx")
            }
          >
            Export Products
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Low Stock / Restock List</h2>
          <p>
            Download products that are low or out of stock, with suggested buy
            quantities and estimated restock cost.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/low-stock",
                "chalin03-low-stock-restock.xlsx"
              )
            }
          >
            Export Low Stock
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Stock Adjustments</h2>
          <p>
            Download stock corrections with old stock, new stock, reason and
            staff name.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/stock-adjustments",
                "chalin03-stock-adjustments.xlsx",
                true
              )
            }
          >
            Export Stock Adjustments
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Daily Closings</h2>
          <p>
            Download end-of-day closing records with expected money, counted
            money and differences.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/daily-closings",
                "chalin03-daily-closings.xlsx",
                true
              )
            }
          >
            Export Daily Closings
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Sales</h2>
          <p>Download sales history with receipt numbers and payment details.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile("/exports/sales", "chalin03-sales.xlsx", true)
            }
          >
            Export Sales
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Debts</h2>
          <p>Download customer debt records and outstanding balances.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile("/exports/debts", "chalin03-debts.xlsx")
            }
          >
            Export Debts
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Debt Payments</h2>
          <p>
            Download customer debt payment history with method, receiver and
            date.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/debt-payments",
                "chalin03-debt-payments.xlsx",
                true
              )
            }
          >
            Export Debt Payments
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Expenses</h2>
          <p>Download business expenses such as transport, rent and internet.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile("/exports/expenses", "chalin03-expenses.xlsx", true)
            }
          >
            Export Expenses
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Purchases</h2>
          <p>
            Download stock purchase records, supplier balances and supplier
            payment history.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile("/exports/purchases", "chalin03-purchases.xlsx", true)
            }
          >
            Export Purchases
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Returns</h2>
          <p>Download returned item records with reasons and receipt numbers.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile("/exports/returns", "chalin03-returns.xlsx", true)
            }
          >
            Export Returns
          </button>
        </div>
      </div>
    </div>
  );
}