import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const CONFIRMATION_TEXT = "CLEAR CHALIN03 TEST DATA";

const TABLE_LABELS = {
  sms_log: "SMS logs",
  activity_log: "Activity logs",

  audit_reapproval_log: "Audit reapproval logs",
  audit_unlock_requests: "Audit unlock requests",
  audit_signoffs: "Audit signoffs",

  debt_payments: "Debt payments",
  debts: "Customer debts",

  returns: "Returns",

  sale_items: "Sale items",
  sales: "Sales",

  purchase_payments: "Purchase payments",
  purchase_items: "Purchase items",
  purchases: "Purchases",

  expenses: "Expenses",
  daily_closings: "Daily closings",

  stock_adjustments: "Stock adjustments",
  stock_transfer_items: "Stock transfer items",
  stock_transfers: "Stock transfers",

  customers: "Customers",
  suppliers: "Suppliers",
  products: "Products",
};

const TABLE_GROUPS = {
  sms_log: "Communication",
  activity_log: "System audit",

  audit_reapproval_log: "Audit / accounting",
  audit_unlock_requests: "Audit / accounting",
  audit_signoffs: "Audit / accounting",

  debt_payments: "Debts",
  debts: "Debts",

  returns: "Sales / returns",

  sale_items: "Sales / returns",
  sales: "Sales / returns",

  purchase_payments: "Purchases / suppliers",
  purchase_items: "Purchases / suppliers",
  purchases: "Purchases / suppliers",

  expenses: "Expenses / closing",
  daily_closings: "Expenses / closing",

  stock_adjustments: "Inventory / stock ledger",
  stock_transfer_items: "Inventory / stock ledger",
  stock_transfers: "Inventory / stock ledger",

  customers: "Contacts",
  suppliers: "Contacts",
  products: "Inventory / stock ledger",
};

const PROTECTED_LABELS = {
  branches: "Branches / stores",
  users: "Users / login accounts",
  user_branch_access: "User store access",
  settings: "Business and receipt settings",
};

export default function MaintenancePage() {
  const { user, branchCode, branchName, branchLocation } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

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

  const [summary, setSummary] = useState(null);
  const [systemAdminPassword, setSystemAdminPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const requiredConfirmation =
    summary?.confirmation_required || CONFIRMATION_TEXT;

  async function loadSummary() {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.get(
        "/maintenance/business-data-summary"
      );

      setSummary(response.data);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load maintenance data summary."
      );
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function clearBusinessData(event) {
    event.preventDefault();

    const confirmBrowser = window.confirm(
      "This will permanently clear test/business data across ALL stores. Users, store records and settings will be kept. Do you want to continue?"
    );

    if (!confirmBrowser) {
      return;
    }

    const secondConfirm = window.confirm(
      "Final warning: this action is system-wide, not only the selected store. It will clear business/test records for MAIN, AJAKAA and any other store. Continue?"
    );

    if (!secondConfirm) {
      return;
    }

    const backupConfirm = window.confirm(
      "Backup reminder: make sure you have downloaded or created a fresh backup before clearing. Continue only if backup is done or the data is only test data."
    );

    if (!backupConfirm) {
      return;
    }

    setClearing(true);
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.delete(
        "/maintenance/clear-business-data",
        {
          data: {
            system_admin_password: systemAdminPassword,
            confirmation,
          },
        }
      );

      setMessage(response.data.message || "Business data cleared successfully.");
      setSystemAdminPassword("");
      setConfirmation("");

      await loadSummary();
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Something went wrong while clearing business data."
      );
    } finally {
      setClearing(false);
    }
  }

  const counts = summary?.counts || {};
  const tableNames = Object.keys(counts);

  const totalRecords = useMemo(() => {
    return tableNames.reduce(
      (sum, tableName) => sum + Number(counts[tableName] || 0),
      0
    );
  }, [counts, tableNames]);

  const groupedTables = useMemo(() => {
    return tableNames.reduce((groups, tableName) => {
      const groupName = TABLE_GROUPS[tableName] || "Other";

      if (!groups[groupName]) {
        groups[groupName] = [];
      }

      groups[groupName].push(tableName);
      return groups;
    }, {});
  }, [tableNames]);

  const protectedTables = summary?.protected_tables || [];
  const tablesToClear = summary?.tables_to_clear || tableNames;
  const clearEnabled = summary?.clear_enabled !== false;
  const systemAdminOnly = summary?.system_admin_only !== false;
  const clearScope = summary?.clear_scope || "full_system_all_stores";

  const canClear =
    clearEnabled &&
    systemAdminPassword.trim().length > 0 &&
    confirmation === requiredConfirmation &&
    !clearing;

  function formatCount(value) {
    return Number(value || 0).toLocaleString();
  }

  function getTableLabel(tableName) {
    return TABLE_LABELS[tableName] || tableName;
  }

  function getProtectedLabel(tableName) {
    return PROTECTED_LABELS[tableName] || tableName;
  }

  if (!isAdmin) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>
              You are not allowed to open System Maintenance from{" "}
              {currentStoreCode} — {currentStoreName}.
            </p>
          </div>
        </div>

        <div className="error-box">
          Only admin accounts can open system maintenance. The backend still
          requires the main System Administrator password before clearing data.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>System Maintenance</h1>
          <p>
            Clear test data safely before the business starts real operation.
          </p>
        </div>

        <button type="button" onClick={loadSummary} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div
        style={{
          marginBottom: "18px",
          padding: "14px",
          borderRadius: "14px",
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          color: "#9a3412",
          fontWeight: "800",
        }}
      >
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Maintenance is system-wide. It is not limited to the selected store.
          Clearing test/business data will clear records across all stores while
          keeping users, branches, store access and settings.
        </small>
      </div>

      <div className="warning-box">
        <strong>Important:</strong> This page is for the main System
        Administrator only. It clears business/test records across all stores,
        but keeps users, branches, user store access and business settings.
      </div>

      <div className="error-box">
        <strong>Backup first:</strong> Before clearing anything, create or
        download a backup. This action removes stock ledger source history too,
        including sales, purchases, returns, stock adjustments and stock
        transfers.
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="two-column">
        <div className="section-card">
          <h2>Maintenance Scope</h2>

          <div className="receipt-info-grid">
            <p>
              <strong>Scope:</strong> {clearScope}
            </p>
            <p>
              <strong>System Admin Only:</strong>{" "}
              {systemAdminOnly ? "Yes" : "No"}
            </p>
            <p>
              <strong>Clear Enabled:</strong> {clearEnabled ? "Yes" : "No"}
            </p>
            <p>
              <strong>Total Clearable Records:</strong>{" "}
              {formatCount(totalRecords)}
            </p>
          </div>

          {!clearEnabled && (
            <div className="warning-box">
              Clearing is disabled on the backend. In production, the Railway
              backend variable ALLOW_CLEAR_BUSINESS_DATA must be set to true
              only when you intentionally want to clear test data.
            </div>
          )}

          <h3>Protected Data</h3>
          <p>These records will not be deleted:</p>

          <ul style={{ lineHeight: "1.8", fontWeight: "700" }}>
            {protectedTables.length > 0 ? (
              protectedTables.map((tableName) => (
                <li key={tableName}>
                  {getProtectedLabel(tableName)} ({tableName})
                </li>
              ))
            ) : (
              <>
                <li>Users / login accounts</li>
                <li>Branches / stores</li>
                <li>User store access</li>
                <li>Business settings</li>
                <li>Receipt settings</li>
                <li>System Administrator account</li>
              </>
            )}
          </ul>

          <div className="warning-box">
            Do not use this after real business operation has started unless you
            are intentionally resetting the whole system across all stores.
          </div>
        </div>

        <div className="section-card">
          <h2>Records That Will Be Cleared</h2>
          <p>
            These counts represent clearable business/test records across all
            stores.
          </p>

          {loading ? (
            <p>Loading summary...</p>
          ) : tableNames.length === 0 ? (
            <p>No clearable records found or summary not loaded.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Table</th>
                  <th>Records</th>
                </tr>
              </thead>

              <tbody>
                {Object.entries(groupedTables).map(([groupName, names]) =>
                  names.map((tableName) => (
                    <tr key={tableName}>
                      <td>{groupName}</td>
                      <td>
                        <strong>{getTableLabel(tableName)}</strong>
                        <br />
                        <small>{tableName}</small>
                      </td>
                      <td>{formatCount(counts[tableName])}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="section-card" style={{ marginTop: "18px" }}>
        <h2>Inventory and Ledger Data That Will Be Cleared</h2>
        <p>
          The Stock Movement Ledger is calculated from other business records.
          Clearing the tables below also clears the source history used to build
          the ledger.
        </p>

        <div className="receipt-info-grid">
          <p>
            <strong>Sales:</strong> sales and sale_items
          </p>
          <p>
            <strong>Purchases:</strong> purchases and purchase_items
          </p>
          <p>
            <strong>Returns:</strong> returns
          </p>
          <p>
            <strong>Stock Adjustments:</strong> stock_adjustments
          </p>
          <p>
            <strong>Stock Transfers:</strong> stock_transfers and
            stock_transfer_items
          </p>
          <p>
            <strong>Products:</strong> products
          </p>
        </div>

        <div className="warning-box">
          If the business has already started real operation, do not clear these
          records unless the owner has approved a full reset and a backup has
          been made.
        </div>
      </div>

      <div className="section-card" style={{ marginTop: "18px" }}>
        <h2>Backend Clear List</h2>
        <p>
          This is the exact list returned by the backend route. It helps confirm
          that the frontend and backend agree before clearing.
        </p>

        {tablesToClear.length === 0 ? (
          <p>No backend clear list loaded.</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            {tablesToClear.map((tableName) => (
              <span
                key={tableName}
                style={{
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: "999px",
                  color: "#0f172a",
                  fontSize: "12px",
                  fontWeight: "900",
                  padding: "6px 10px",
                }}
              >
                {tableName}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="section-card" style={{ marginTop: "18px" }}>
        <h2>Clear Test / Business Data</h2>

        <p>
          To continue, type the System Administrator password and the exact
          confirmation text.
        </p>

        <div className="error-box">
          This action is not for only {currentStoreCode}. It clears business
          records across all stores and removes stock movement ledger source
          history.
        </div>

        <div className="warning-box">
          Type exactly: <strong>{requiredConfirmation}</strong>
        </div>

        <form onSubmit={clearBusinessData}>
          <label>System Administrator Password</label>
          <input
            type="password"
            value={systemAdminPassword}
            onChange={(event) => setSystemAdminPassword(event.target.value)}
            placeholder="Enter System Administrator password"
          />

          <label>Confirmation Text</label>
          <input
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={requiredConfirmation}
          />

          <button type="submit" className="danger-button" disabled={!canClear}>
            {clearing ? "Clearing..." : "Clear Test Data Across All Stores"}
          </button>
        </form>
      </div>
    </div>
  );
}
