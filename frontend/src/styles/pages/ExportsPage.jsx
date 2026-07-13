import { useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function ExportsPage() {
  const { user, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const currentStoreCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentStoreName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const currentStoreLocation =
    branchLocation ||
    user?.branch_location ||
    user?.selected_branch?.branch_location ||
    user?.selected_branch?.location ||
    "";

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  function makeSafeFileName(value) {
    return String(value || "store")
      .replace(/[^a-z0-9]/gi, "-")
      .replace(/-+/g, "-")
      .toLowerCase();
  }

  function buildStoreFileName(baseName) {
    return `chalin03-${makeSafeFileName(currentStoreCode)}-${baseName}.xlsx`;
  }

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
      setError("Export failed. Make sure you are logged in as admin, manager or auditor.");
    }
  }

  if (role !== "admin" && role !== "manager" && role !== "auditor") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>
              You are not allowed to open Exports for {currentStoreCode} —{" "}
              {currentStoreName}.
            </p>
          </div>
        </div>

        <div className="error-box">
          Only admin, manager and auditor accounts can export business records.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Exports</h1>
          <p>
            Download business records as Excel files for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
          </p>
        </div>
      </div>

      <div
        style={{
          marginBottom: "18px",
          padding: "14px",
          borderRadius: "14px",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          color: "#1e3a8a",
          fontWeight: "800",
        }}
      >
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Export files are generated for this selected store only. The backend
          protects the real data separation, and the downloaded filename also
          includes the store code.
        </small>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="section-card">
        <h2>Date Filter - {currentStoreCode}</h2>
        <p>
          The date filter affects Sales, Expenses, Purchases, Returns, Stock
          Adjustments, Stock Transfers, Stock Movement Ledger, Debt Payments and
          Daily Closings exports for the selected store. Products, Low Stock and
          Debts export all records for the selected store.
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
          <h2>Products - {currentStoreCode}</h2>
          <p>Download product list, stock quantity, prices and barcode.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/products",
                buildStoreFileName("products")
              )
            }
          >
            Export Products
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Low Stock / Restock List - {currentStoreCode}</h2>
          <p>
            Download products that are low or out of stock, with suggested buy
            quantities and estimated restock cost.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/low-stock",
                buildStoreFileName("low-stock-restock")
              )
            }
          >
            Export Low Stock
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Stock Adjustments - {currentStoreCode}</h2>
          <p>
            Download stock corrections with old stock, new stock, reason and
            staff name.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/stock-adjustments",
                buildStoreFileName("stock-adjustments"),
                true
              )
            }
          >
            Export Stock Adjustments
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Stock Transfers - {currentStoreCode}</h2>
          <p>
            Download transfer requests, approvals, dispatches, receiving records
            and transfer item details between stores.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/stock-transfers",
                buildStoreFileName("stock-transfers"),
                true
              )
            }
          >
            Export Stock Transfers
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Stock Movement Ledger - {currentStoreCode}</h2>
          <p>
            Download one complete stock audit ledger showing purchases, sales,
            returns, stock adjustments, transfers in, transfers out and running
            balances for every product.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/stock-ledger",
                buildStoreFileName("stock-movement-ledger"),
                true
              )
            }
          >
            Export Stock Movement Ledger
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Daily Closings - {currentStoreCode}</h2>
          <p>
            Download end-of-day closing records with expected money, counted
            money and differences.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/daily-closings",
                buildStoreFileName("daily-closings"),
                true
              )
            }
          >
            Export Daily Closings
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Sales - {currentStoreCode}</h2>
          <p>Download sales history with receipt numbers and payment details.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/sales",
                buildStoreFileName("sales"),
                true
              )
            }
          >
            Export Sales
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Debts - {currentStoreCode}</h2>
          <p>Download customer debt records and outstanding balances.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile("/exports/debts", buildStoreFileName("debts"))
            }
          >
            Export Debts
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Debt Payments - {currentStoreCode}</h2>
          <p>
            Download customer debt payment history with method, receiver and
            date.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/debt-payments",
                buildStoreFileName("debt-payments"),
                true
              )
            }
          >
            Export Debt Payments
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Expenses - {currentStoreCode}</h2>
          <p>Download business expenses such as transport, rent and internet.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/expenses",
                buildStoreFileName("expenses"),
                true
              )
            }
          >
            Export Expenses
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Purchases - {currentStoreCode}</h2>
          <p>
            Download stock purchase records, supplier balances and supplier
            payment history.
          </p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/purchases",
                buildStoreFileName("purchases"),
                true
              )
            }
          >
            Export Purchases
          </button>
        </div>

        <div className="section-card export-card">
          <h2>Returns - {currentStoreCode}</h2>
          <p>Download returned item records with reasons and receipt numbers.</p>
          <button
            type="button"
            onClick={() =>
              downloadFile(
                "/exports/returns",
                buildStoreFileName("returns"),
                true
              )
            }
          >
            Export Returns
          </button>
        </div>
      </div>
    </div>
  );
}
