import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const today = new Date().toISOString().slice(0, 10);

const emptyExpenseForm = {
  category: "",
  description: "",
  amount: "",
  expense_date: today,
};

export default function ExpensesPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState({
    total_expenses: 0,
    expense_count: 0,
  });

  const [form, setForm] = useState(emptyExpenseForm);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function getFriendlyApiError(error, fallbackMessage) {
    const responseData = error?.response?.data;

    if (responseData?.code === "AUDIT_PERIOD_LOCKED") {
      const lockedPeriod = responseData.locked_period || {};
      const periodLabel =
        lockedPeriod.period_label || "Approved accounting period";
      const approvedBy = lockedPeriod.approved_by_name || "management";
      const reviewDate = lockedPeriod.review_date || "";

      return [
        "This expense cannot be changed because the accounting period is locked.",
        `Locked Period: ${periodLabel}.`,
        `Reason: This period has already been approved by ${approvedBy}.`,
        reviewDate ? `Approval Date: ${reviewDate}.` : "",
        "Ask the admin or manager to review the audit sign-off before recording or deleting expenses inside this period.",
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
  }, []);

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

    try {
      const response = await axiosClient.post("/expenses", {
        ...form,
        amount: Number(form.amount || 0),
      });

      setMessage(response.data.message || "Expense recorded successfully.");
      setForm(emptyExpenseForm);
      loadExpenses();
    } catch (error) {
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

    try {
      const response = await axiosClient.delete(`/expenses/${expenseId}`);
      setMessage(response.data.message || "Expense deleted successfully.");
      loadExpenses();
    } catch (error) {
      setError(getFriendlyApiError(error, "Failed to delete expense."));
    }
  }

  if (role !== "admin" && role !== "manager") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open Expenses.</p>
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
            salary
          </p>
        </div>

        <button onClick={loadExpenses}>Refresh</button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid expense-summary-grid">
        <div className="stat-card">
          <span>Total Expenses</span>
          <strong>{formatMoney(summary.total_expenses)}</strong>
        </div>

        <div className="stat-card">
          <span>Number of Expenses</span>
          <strong>{summary.expense_count || 0}</strong>
        </div>
      </div>

      <div className="two-column expenses-grid">
        <form className="section-card" onSubmit={createExpense}>
          <h2>Record Expense</h2>

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
          <h2>Filter Expenses</h2>

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
                setTimeout(loadExpenses, 0);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h2>Expense Records</h2>

        {expenses.length === 0 ? (
          <p>No expenses recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
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