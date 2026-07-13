import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import AuditUnlockRequestBox from "../components/AuditUnlockRequestBox";

const today = new Date().toISOString().slice(0, 10);

const emptyExpenseForm = {
  category: "",
  description: "",
  amount: "",
  expense_date: today,
};

export default function ExpensesPage() {
  const { user, branchId, branchCode, branchName, branchLocation } = useAuth();
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

  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({
    total_expenses: 0,
    expense_count: 0,
  });

  const [form, setForm] = useState(emptyExpenseForm);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [lockedPeriod, setLockedPeriod] = useState(null);
  const [unlockRequestAction, setUnlockRequestAction] = useState(
    "Record expense inside locked period"
  );

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function getLockedPeriodFromError(error) {
    const responseData = error?.response?.data;

    if (responseData?.code === "AUDIT_PERIOD_LOCKED") {
      return responseData.locked_period || null;
    }

    return null;
  }

  function getFriendlyApiError(error, fallbackMessage) {
    const responseData = error?.response?.data;

    if (responseData?.code === "AUDIT_PERIOD_LOCKED") {
      const lockedPeriodData = responseData.locked_period || {};
      const periodLabel =
        lockedPeriodData.period_label || "Approved accounting period";
      const approvedBy = lockedPeriodData.approved_by_name || "management";
      const reviewDate = lockedPeriodData.review_date || "";

      return [
        "This expense cannot be changed because the accounting period is locked.",
        `Locked Period: ${periodLabel}.`,
        `Reason: This period has already been approved by ${approvedBy}.`,
        reviewDate ? `Approval Date: ${reviewDate}.` : "",
        "Use the unlock request form below if a correction is needed.",
      ]
        .filter(Boolean)
        .join(" ");
    }

    return responseData?.message || fallbackMessage;
  }

  async function loadExpenses() {
    setError("");

    try {
      const response = await axiosClient.get("/expenses", {
        params: {
          search,
          from,
          to,
        },
      });

      setExpenses(response.data.expenses || []);
      setSummary(response.data.summary || {});
    } catch (error) {
      setError(
        getFriendlyApiError(
          error,
          "Failed to load expenses. Make sure you are admin or manager."
        )
      );
    }
  }

  useEffect(() => {
    loadExpenses();
    // Reload expenses when the selected store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  function handleChange(event) {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  }

  async function createExpense(event) {
    event.preventDefault();

    setMessage("");
    setError("");
    setLockedPeriod(null);
    setUnlockRequestAction("Record expense inside locked period");

    try {
      const response = await axiosClient.post("/expenses", {
        ...form,
        amount: Number(form.amount || 0),
      });

      setMessage(response.data.message || "Expense recorded successfully.");
      setForm(emptyExpenseForm);
      loadExpenses();
    } catch (error) {
      const period = getLockedPeriodFromError(error);

      if (period) {
        setLockedPeriod(period);
        setUnlockRequestAction("Record expense inside locked period");
      }

      setError(getFriendlyApiError(error, "Failed to record expense."));
    }
  }

  async function deleteExpense(expenseId) {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this expense?"
    );

    if (!confirmDelete) return;

    setMessage("");
    setError("");
    setLockedPeriod(null);
    setUnlockRequestAction("Delete expense inside locked period");

    try {
      const response = await axiosClient.delete(`/expenses/${expenseId}`);
      setMessage(response.data.message || "Expense deleted successfully.");
      loadExpenses();
    } catch (error) {
      const period = getLockedPeriodFromError(error);

      if (period) {
        setLockedPeriod(period);
        setUnlockRequestAction("Delete expense inside locked period");
      }

      setError(getFriendlyApiError(error, "Failed to delete expense."));
    }
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>
              You are not allowed to open Expenses for {currentStoreCode} —{" "}
              {currentStoreName}.
            </p>
          </div>
        </div>

        <div className="error-box">
          Only admin and manager accounts can record business expenses.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Expenses</h1>
          <p>
            Record business costs such as fuel, transport, rent, repairs and
            salary for{" "}
            <strong>
              {currentStoreCode} — {currentStoreName}
            </strong>
          </p>
        </div>

        <button onClick={loadExpenses}>Refresh</button>
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
          Expenses, expense summary, filters and delete actions are filtered to
          this selected store only.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <AuditUnlockRequestBox
        lockedPeriod={lockedPeriod}
        requestArea="expense"
        requestedAction={unlockRequestAction}
        onRequestSent={() => {
          setMessage(
            "Unlock request sent successfully. Admin or manager must review it."
          );
        }}
      />

      <div className="cards-grid expense-summary-grid">
        <div className="stat-card">
          <span>{currentStoreCode} Total Expenses</span>
          <strong>{formatMoney(summary.total_expenses)}</strong>
        </div>

        <div className="stat-card">
          <span>{currentStoreCode} Number of Expenses</span>
          <strong>{summary.expense_count || 0}</strong>
        </div>
      </div>

      <div className="two-column expenses-grid">
        <form className="section-card" onSubmit={createExpense}>
          <h2>Record Expense - {currentStoreCode}</h2>

          <div className="warning-box">
            You are working in {currentStoreCode} — {currentStoreName}. This
            expense will belong to this selected store only.
          </div>

          <label>Category</label>
          <select
            name="category"
            value={form.category}
            onChange={handleChange}
          >
            <option value="">Select category</option>
            <option value="Fuel">Fuel</option>
            <option value="Transport">Transport</option>
            <option value="Rent">Rent</option>
            <option value="Salary">Salary</option>
            <option value="Internet">Internet</option>
            <option value="Repairs">Repairs</option>
            <option value="Packaging">Packaging</option>
            <option value="Electricity">Electricity</option>
            <option value="Water">Water</option>
            <option value="Other">Other</option>
          </select>

          <label>Amount</label>
          <input
            type="number"
            name="amount"
            value={form.amount}
            onChange={handleChange}
            placeholder="Example: 50"
            min="0"
            step="0.01"
          />

          <label>Expense Date</label>
          <input
            type="date"
            name="expense_date"
            value={form.expense_date}
            onChange={handleChange}
          />

          <label>Description</label>
          <textarea
            name="description"
            value={form.description}
            onChange={handleChange}
            placeholder="Example: Fuel for delivery or spare parts pickup"
          />

          <button type="submit">Save Expense</button>
        </form>

        <div className="section-card">
          <h2>Filter Expenses - {currentStoreCode}</h2>

          <label>Search</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search category, description or staff"
          />

          <label>From Date</label>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />

          <label>To Date</label>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />

          <div className="filter-actions expense-filter-actions">
            <button type="button" onClick={loadExpenses}>
              Apply Filter
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSearch("");
                setFrom("");
                setTo("");
                loadExpenses({
                  search: "",
                  from: "",
                  to: "",
                });
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Expense Records - {currentStoreCode}</h2>

        {expenses.length === 0 ? (
          <p>No expenses recorded yet for {currentStoreCode}.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Store</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Recorded By</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {expenses.map((expense) => (
                <tr key={expense.id}>
                  <td>{new Date(expense.expense_date).toLocaleDateString()}</td>
                  <td>{expense.branch_code || expense.store_code || currentStoreCode}</td>
                  <td>
                    <strong>{expense.category}</strong>
                  </td>
                  <td>{expense.description || "-"}</td>
                  <td>{formatMoney(expense.amount)}</td>
                  <td>{expense.recorded_by_name || "-"}</td>
                  <td>
                    <button
                      type="button"
                      className="small-danger"
                      onClick={() => deleteExpense(expense.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}