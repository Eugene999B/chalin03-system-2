export default function HelpPage() {
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
          <p>Simple guide for using Chalin 03 Sales & Inventory System.</p>
        </div>
      </div>

      <div className="success-box">
        This system helps Chalin 03 manage sales, stock, debts, purchases,
        expenses, reports, receipts, and daily closing.
      </div>

      <div style={gridStyle}>
        <div style={cardStyle}>
          <h2>1. Daily Workflow</h2>
          <ol style={listStyle}>
            <li>Login with your username and password.</li>
            <li>Check Dashboard for sales, debts, and low stock.</li>
            <li>Add new products if stock arrives.</li>
            <li>Use New Sale to sell products.</li>
            <li>Print or download receipt after sale.</li>
            <li>Record debt payment when customer pays later.</li>
            <li>Do Daily Closing at the end of the day.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>2. Products</h2>
          <ol style={listStyle}>
            <li>Go to Products.</li>
            <li>Add product name, category, size, price, and quantity.</li>
            <li>Use low-stock level to know when to restock.</li>
            <li>Search products by name, barcode, category, or size.</li>
            <li>Admin can update or delete products if needed.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>3. New Sale</h2>
          <ol style={listStyle}>
            <li>Go to New Sale.</li>
            <li>Search and select product.</li>
            <li>Enter quantity.</li>
            <li>Add customer details if needed.</li>
            <li>Select payment type: cash, MoMo, bank, credit, or mixed.</li>
            <li>Save sale and print/download receipt.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>4. Debts</h2>
          <ol style={listStyle}>
            <li>Credit sales automatically create debt records.</li>
            <li>Go to Debts to see unpaid customers.</li>
            <li>Click record payment when customer pays.</li>
            <li>The balance reduces automatically.</li>
            <li>Paid debts will show as completed/paid.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>5. Purchases & Expenses</h2>
          <ol style={listStyle}>
            <li>Use Purchases when buying stock from suppliers.</li>
            <li>Purchase items increase product stock.</li>
            <li>Use Expenses for shop costs like transport, food, rent, etc.</li>
            <li>Reports will use these records for better business tracking.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>6. Reports & Exports</h2>
          <ol style={listStyle}>
            <li>Managers and admins can view Reports.</li>
            <li>Use date filters to check sales performance.</li>
            <li>Use Exports to download business records.</li>
            <li>Use Daily Closing to confirm end-of-day money.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>7. User Roles</h2>
          <ul style={listStyle}>
            <li>
              <strong>Cashier:</strong> Can sell, view products, debts, and
              basic records.
            </li>
            <li>
              <strong>Manager:</strong> Can access reports, purchases,
              expenses, returns, exports, and daily closing.
            </li>
            <li>
              <strong>Admin:</strong> Can manage users, settings, backups, and
              activity logs.
            </li>
            <li>
              <strong>System Administrator:</strong> Can access System
              Maintenance.
            </li>
          </ul>
        </div>

        <div style={cardStyle}>
          <h2>8. Install App</h2>
          <ol style={listStyle}>
            <li>Click Install App in the sidebar.</li>
            <li>Accept the browser install prompt.</li>
            <li>The system will appear like an app on the phone or computer.</li>
            <li>On iPhone, use Share then Add to Home Screen.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <h2>9. Important Safety Notes</h2>
          <ul style={listStyle}>
            <li>Do not share admin password.</li>
            <li>Change password regularly.</li>
            <li>Backup before clearing test data.</li>
            <li>Only use System Maintenance before real operation starts.</li>
            <li>Do not delete data after real business starts unless approved.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}