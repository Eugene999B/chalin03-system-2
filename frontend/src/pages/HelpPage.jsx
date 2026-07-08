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

  const badgeStyle = {
    display: "inline-block",
    padding: "5px 10px",
    borderRadius: "999px",
    background: "#eff6ff",
    color: "#1e3a8a",
    fontSize: "12px",
    fontWeight: "900",
    marginBottom: "10px",
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
        expenses, reports, receipts, audit controls, daily closing, stock
        transfers, stock adjustments, stock movement ledger, SMS alerts and
        multi-store records.
      </div>

      <div style={gridStyle}>
        <div style={cardStyle}>
          <span style={badgeStyle}>Store Control</span>
          <h2>1. Store Selection</h2>
          <ol style={listStyle}>
            <li>Choose the correct store on the login page before logging in.</li>
            <li>Always check the selected store name at the top of the system.</li>
            <li>
              Sales, debts, stock, purchases, expenses, returns and reports
              belong to the selected store.
            </li>
            <li>To switch store, logout, select another store, and login again.</li>
            <li>
              Do not record a sale, purchase, transfer, return or stock
              adjustment until the selected store is correct.
            </li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Daily Work</span>
          <h2>2. Daily Workflow</h2>
          <ol style={listStyle}>
            <li>Login with your username, password and selected store.</li>
            <li>Check Dashboard for sales, debts, stock value and low stock.</li>
            <li>Add or update products if stock arrives.</li>
            <li>Use New Sale to sell products from the selected store.</li>
            <li>Print or download receipt after sale.</li>
            <li>Record debt payment when customer pays later.</li>
            <li>Record expenses, purchases and returns when needed.</li>
            <li>Use stock transfers when moving items between stores.</li>
            <li>Use Daily Closing for the selected store at the end of the day.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Inventory</span>
          <h2>3. Products</h2>
          <ol style={listStyle}>
            <li>Go to Products.</li>
            <li>Add product name, category, excavator type, price and quantity.</li>
            <li>Use low-stock level to know when to restock.</li>
            <li>Search products by name, barcode, category or excavator type.</li>
            <li>Product stock is separated by store.</li>
            <li>Admin or manager can edit products and adjust stock.</li>
            <li>Admin can delete or disable products when necessary.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Stock Control</span>
          <h2>4. Stock Adjustment</h2>
          <ol style={listStyle}>
            <li>Go to Products.</li>
            <li>Click Adjust Stock on the product.</li>
            <li>Choose Increase Stock, Decrease Stock or Set Exact Stock.</li>
            <li>Enter the quantity and the reason.</li>
            <li>
              Use this for damaged items, lost items, physical count correction,
              wrong entry correction or stock count update.
            </li>
            <li>The system records old stock, new stock, reason, date and user.</li>
            <li>
              Recent Stock Adjustment Records show at the bottom of the Products
              page.
            </li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Stock Audit</span>
          <h2>5. Product Stock Movement Ledger</h2>
          <ol style={listStyle}>
            <li>Go to Products.</li>
            <li>Find the product you want to inspect.</li>
            <li>Click View Ledger.</li>
            <li>
              The ledger shows how the product stock moved from opening stock to
              current stock.
            </li>
            <li>
              It includes purchases, sales, returns, stock adjustments, transfers
              in and transfers out.
            </li>
            <li>
              Use the running balance to understand why the current stock is what
              it is.
            </li>
            <li>
              This is useful when stock quantity is questioned during audit or
              physical counting.
            </li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Two Stores</span>
          <h2>6. Stock Transfers Between Stores</h2>
          <ol style={listStyle}>
            <li>Go to Stock Transfers.</li>
            <li>Select the source store and destination store.</li>
            <li>Add products and quantities to transfer.</li>
            <li>Create the transfer request.</li>
            <li>Approve the transfer when management agrees.</li>
            <li>Dispatch the transfer to reduce stock from the source store.</li>
            <li>Receive the transfer to add stock to the destination store.</li>
            <li>
              Download the Transfer Note PDF for printing or physical signing.
            </li>
          </ol>

          <div className="warning-box" style={{ marginTop: "12px" }}>
            Approval does not move stock. Dispatch reduces the source store.
            Receive increases the destination store.
          </div>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Sales</span>
          <h2>7. New Sale</h2>
          <ol style={listStyle}>
            <li>Go to New Sale.</li>
            <li>Confirm the selected store before selling.</li>
            <li>Search and select product.</li>
            <li>Enter quantity.</li>
            <li>Add customer details if needed.</li>
            <li>Select payment type: cash, MoMo, bank, credit or mixed.</li>
            <li>Save sale and print or download receipt.</li>
            <li>For credit sales, debt is created automatically.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Customers</span>
          <h2>8. Debts</h2>
          <ol style={listStyle}>
            <li>Credit sales automatically create debt records.</li>
            <li>Go to Debts to see unpaid customers for the selected store.</li>
            <li>Record payment when the customer pays.</li>
            <li>The balance reduces automatically.</li>
            <li>Paid debts will show as completed or paid.</li>
            <li>Debt records help management follow customers who owe money.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Purchasing</span>
          <h2>9. Purchases & Suppliers</h2>
          <ol style={listStyle}>
            <li>Use Purchases when buying stock from suppliers.</li>
            <li>Confirm the selected store before saving a purchase.</li>
            <li>Purchase items increase stock only in the selected store.</li>
            <li>Supplier records are also separated by store.</li>
            <li>Record supplier balance payments when paying later.</li>
            <li>Use purchase history to track how stock entered the business.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Shop Costs</span>
          <h2>10. Expenses & Returns</h2>
          <ol style={listStyle}>
            <li>Use Expenses for shop costs like transport, rent and repairs.</li>
            <li>Expenses are saved under the selected store.</li>
            <li>Use Returns when a customer returns an item.</li>
            <li>Returns increase stock only in the selected store.</li>
            <li>Managers and admins should review returns carefully.</li>
            <li>Returns and expenses affect business reports.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Reports</span>
          <h2>11. Reports, Exports & Daily Closing</h2>
          <ol style={listStyle}>
            <li>Managers and admins can view Reports.</li>
            <li>Use date filters to check sales performance.</li>
            <li>Reports show data for the selected store only.</li>
            <li>Use Exports to download selected-store business records.</li>
            <li>
              Export Stock Movement Ledger to download a full product stock audit
              workbook.
            </li>
            <li>Use Daily Closing to confirm end-of-day money for a store.</li>
            <li>Daily Closing helps compare system sales and cash available.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Export Files</span>
          <h2>12. Excel Exports</h2>
          <ol style={listStyle}>
            <li>Go to Exports.</li>
            <li>Use the date filter if you want records within a date range.</li>
            <li>Products, Low Stock and Debts export all records for the store.</li>
            <li>
              Sales, Expenses, Purchases, Returns, Stock Adjustments, Stock
              Transfers, Stock Movement Ledger, Debt Payments and Daily Closings
              can use the date filter.
            </li>
            <li>
              Use Stock Movement Ledger export when management wants to review
              stock movements for all products.
            </li>
            <li>
              Use Stock Transfers export when management wants to review
              movements between stores.
            </li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Accounting</span>
          <h2>13. Advanced Accounting Intelligence</h2>
          <ol style={listStyle}>
            <li>Use this page to review advanced accounting signals.</li>
            <li>Check profit, loss, stock movement and suspicious changes.</li>
            <li>Review sales, expenses, debts, purchases and returns together.</li>
            <li>Managers should use it to detect business mistakes early.</li>
            <li>
              The page helps management understand whether the store is healthy.
            </li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>SMS</span>
          <h2>14. SMS Center</h2>
          <ol style={listStyle}>
            <li>Use SMS Center to send business messages to customers.</li>
            <li>Use templates for debt reminders and customer notices.</li>
            <li>Confirm recipient numbers carefully before sending live SMS.</li>
            <li>Check SMS status to see successful and failed messages.</li>
            <li>Retry failed SMS only after confirming the phone number.</li>
            <li>Only approved users should send bulk SMS.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Audit</span>
          <h2>15. Audit Controls</h2>
          <ol style={listStyle}>
            <li>Audit Sign-Off locks approved accounting periods.</li>
            <li>Locked periods stop changes inside approved records.</li>
            <li>Staff can request unlock when a correction is needed.</li>
            <li>Admin or manager must review unlock requests.</li>
            <li>Audit history and unlock requests are separated by store.</li>
            <li>Use audit controls before presenting final reports.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>System Safety</span>
          <h2>16. Backup, Restore & Maintenance</h2>
          <ol style={listStyle}>
            <li>Backup and Restore are full-system actions.</li>
            <li>Maintenance clear test data is also a full-system action.</li>
            <li>These actions are not limited to the selected store.</li>
            <li>Backup before clearing test data.</li>
            <li>Only use Maintenance before real operation starts.</li>
            <li>Do not reset or clear real business data without approval.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Permissions</span>
          <h2>17. User Roles</h2>
          <ul style={listStyle}>
            <li>
              <strong>Cashier:</strong> Can sell, view products, debts and basic
              records.
            </li>
            <li>
              <strong>Manager:</strong> Can access reports, purchases, expenses,
              returns, exports, stock adjustments, stock transfers, daily closing
              and audit review areas.
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
          <span style={badgeStyle}>PWA</span>
          <h2>18. Install App</h2>
          <ol style={listStyle}>
            <li>Click Install App in the sidebar.</li>
            <li>Accept the browser install prompt.</li>
            <li>The system will appear like an app on the phone or computer.</li>
            <li>On iPhone, use Share then Add to Home Screen.</li>
            <li>Always use the official Chalin 03 link when opening the app.</li>
          </ol>
        </div>

        <div style={cardStyle}>
          <span style={badgeStyle}>Security</span>
          <h2>19. Important Safety Notes</h2>
          <ul style={listStyle}>
            <li>Do not share admin password.</li>
            <li>Change password regularly.</li>
            <li>Always confirm the selected store before recording sales.</li>
            <li>Always enter clear reasons for stock adjustments.</li>
            <li>
              Use stock transfers instead of manually reducing one store and
              increasing another.
            </li>
            <li>
              Use stock movement ledger when product quantity does not look
              correct.
            </li>
            <li>Backup before clearing test data.</li>
            <li>Only use System Maintenance before real operation starts.</li>
            <li>Do not delete data after real business starts unless approved.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}