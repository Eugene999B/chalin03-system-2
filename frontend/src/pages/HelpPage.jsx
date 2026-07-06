import { useAuth } from "../context/AuthContext";

export default function HelpPage() {
  const { user, branchCode, branchName, branchLocation } = useAuth();

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

  const cardStyle = {
    background: "#ffffff",
    borderRadius: "16px",
    padding: "20px",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
    border: "1px solid #e5e7eb",
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "18px",
  };

  const listStyle = {
    lineHeight: "1.8",
    paddingLeft: "20px",
    marginBottom: 0,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Help / User Guide</h1>
          <p>
            Simple guide for using Chalin 03 Sales & Inventory System in{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
            .
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
          Most daily records are separated by selected store. To work in another
          store, logout, choose the correct store on the login page, and login
          again.
        </small>
      </div>

      <div className="success-box">
        This system helps Chalin 03 manage sales, stock, debts, purchases,
        expenses, reports, receipts, audit controls, daily closing and
        multi-store records.
      </div>

      <div style={gridStyle}>
        <div style={cardStyle}>
          <h2>1. Store Selection</h2>
          <ol style={listStyle}>
            <li>Choose the correct store on the login page before logging in.</li>
            <li>
              Always check the selected store name at the top of the system.
            </li>
            <li>
              Sales, debts, stock, purchases, expenses, returns and reports
              belong to the selected store.
            </li>
            <li>
              To switch store, logout, select another store, and login again.
            </li>
            <li>
              Do not record a sale or purchase until you are sure the selected
              store is correct.
            </li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>2. Daily Workflow</h2>
          <ol style={listStyle}>
            <li>Login with your username, password and selected store.</li>
            <li>Check Dashboard for sales, debts, and low stock.</li>
            <li>Add or update products if stock arrives.</li>
            <li>Use New Sale to sell products from the selected store.</li>
            <li>Print or download receipt after sale.</li>
            <li>Record debt payment when customer pays later.</li>
            <li>Do Daily Closing for the selected store at the end of the day.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>3. Products</h2>
          <ol style={listStyle}>
            <li>Go to Products.</li>
            <li>Add product name, category, size, price, and quantity.</li>
            <li>Use low-stock level to know when to restock.</li>
            <li>Search products by name, barcode, category, or size.</li>
            <li>Product stock is separated by store.</li>
            <li>Admin can update or delete products if needed.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>4. New Sale</h2>
          <ol style={listStyle}>
            <li>Go to New Sale.</li>
            <li>Confirm the selected store before selling.</li>
            <li>Search and select product.</li>
            <li>Enter quantity.</li>
            <li>Add customer details if needed.</li>
            <li>Select payment type: cash, MoMo, bank, credit, or mixed.</li>
            <li>Save sale and print/download receipt.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>5. Debts</h2>
          <ol style={listStyle}>
            <li>Credit sales automatically create debt records.</li>
            <li>Go to Debts to see unpaid customers for the selected store.</li>
            <li>Record payment when customer pays.</li>
            <li>The balance reduces automatically.</li>
            <li>Paid debts will show as completed/paid.</li>
            <li>WhatsApp reminders include the selected store details.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>6. Purchases & Suppliers</h2>
          <ol style={listStyle}>
            <li>Use Purchases when buying stock from suppliers.</li>
            <li>Confirm the selected store before saving a purchase.</li>
            <li>Purchase items increase stock only in the selected store.</li>
            <li>Supplier records are also separated by store.</li>
            <li>Record supplier balance payments when paying later.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>7. Expenses & Returns</h2>
          <ol style={listStyle}>
            <li>Use Expenses for shop costs like transport, rent and repairs.</li>
            <li>Expenses are saved under the selected store.</li>
            <li>Use Returns when a customer returns an item.</li>
            <li>Returns increase stock only in the selected store.</li>
            <li>Managers and admins should review returns carefully.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>8. Reports, Exports & Daily Closing</h2>
          <ol style={listStyle}>
            <li>Managers and admins can view Reports.</li>
            <li>Use date filters to check sales performance.</li>
            <li>Reports show data for the selected store only.</li>
            <li>Use Exports to download selected-store business records.</li>
            <li>Use Daily Closing to confirm end-of-day money for a store.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>9. Audit Controls</h2>
          <ol style={listStyle}>
            <li>Audit Sign-Off locks approved accounting periods.</li>
            <li>Locked periods stop changes inside approved records.</li>
            <li>Staff can request unlock when a correction is needed.</li>
            <li>Admin or manager must review unlock requests.</li>
            <li>Audit history and unlock requests are separated by store.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>10. Backup, Restore & Maintenance</h2>
          <ol style={listStyle}>
            <li>Backup and Restore are full-system actions.</li>
            <li>Maintenance clear test data is also a full-system action.</li>
            <li>These actions are not limited to the selected store.</li>
            <li>Backup before clearing test data.</li>
            <li>Only use Maintenance before real operation starts.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>11. User Roles</h2>
          <ul style={listStyle}>
            <li>
              <strong>Cashier:</strong> Can sell, view products, debts, and
              basic records.
            </li>
            <li>
              <strong>Manager:</strong> Can access reports, purchases,
              expenses, returns, exports, daily closing and audit review areas.
            </li>
            <li>
              <strong>Admin:</strong> Can manage users, settings, backups,
              activity logs and sensitive system areas.
            </li>
            <li>
              <strong>System Administrator:</strong> Can access System
              Maintenance and full reset actions.
            </li>
          </ul>
        </div>

        <div style={cardStyle}>
          <h2>12. Install App</h2>
          <ol style={listStyle}>
            <li>Click Install App in the sidebar.</li>
            <li>Accept the browser install prompt.</li>
            <li>The system will appear like an app on the phone or computer.</li>
            <li>On iPhone, use Share then Add to Home Screen.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>13. Important Safety Notes</h2>
          <ul style={listStyle}>
            <li>Do not share admin password.</li>
            <li>Change password regularly.</li>
            <li>Always confirm the selected store before recording sales.</li>
            <li>Backup before clearing test data.</li>
            <li>Only use System Maintenance before real operation starts.</li>
            <li>Do not delete data after real business starts unless approved.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
