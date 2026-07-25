import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";
import AuditUnlockRequestBox from "../components/AuditUnlockRequestBox";
import ExpenseVoidApprovalPanel from "../components/ExpenseVoidApprovalPanel";
import { useAuth } from "../context/AuthContext";
import "../styles/expensesFunding.css";

const today = new Date().toISOString().slice(0, 10);

const emptyExpenseForm = {
  category: "",
  description: "",
  amount: "",
  payment_method: "cash",
  funding_source: "",
  affects_daily_closing: null,
  closing_treatment_note: "",
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
    closing_expenses: 0,
    externally_funded_expenses: 0,
    voided_expense_count: 0,
  });

  const [form, setForm] = useState(emptyExpenseForm);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [voidTarget, setVoidTarget] = useState(null);

  const [lockedPeriod, setLockedPeriod] = useState(null);
  const [unlockRequestAction, setUnlockRequestAction] = useState(
    "Record expense inside locked period"
  );

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function getLockedPeriodFromError(apiError) {
    const responseData = apiError?.response?.data;

    if (responseData?.code === "AUDIT_PERIOD_LOCKED") {
      return responseData.locked_period || null;
    }

    return null;
  }

  function getFriendlyApiError(apiError, fallbackMessage) {
    const responseData = apiError?.response?.data;

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

  async function loadExpenses(overrides = null) {
    setError("");

    const requestedFilters =
      overrides && !overrides.nativeEvent
        ? overrides
        : { search, from, to };

    try {
      const response = await axiosClient.get("/expenses", {
        params: requestedFilters,
      });

      setExpenses(response.data.expenses || []);
      setSummary(response.data.summary || {});
    } catch (apiError) {
      setError(
        getFriendlyApiError(
          apiError,
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
    const { name, value } = event.target;

    if (name === "funding_source") {
      const affectsDailyClosing = value === "today_sales_receipts";
      setForm((current) => ({
        ...current,
        funding_source: value,
        affects_daily_closing: value ? affectsDailyClosing : null,
        payment_method:
          value === "unpaid_credit" ? "other" : current.payment_method,
      }));
      return;
    }

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
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
        affects_daily_closing: form.affects_daily_closing,
      });

      setMessage(response.data.message || "Expense recorded successfully.");
      setForm(emptyExpenseForm);
      loadExpenses();
    } catch (apiError) {
      const period = getLockedPeriodFromError(apiError);

      if (period) {
        setLockedPeriod(period);
        setUnlockRequestAction("Record expense inside locked period");
      }

      setError(getFriendlyApiError(apiError, "Failed to record expense."));
    }
  }

  function openVoidExpense(expense) {
    setMessage("");
    setError("");
    setLockedPeriod(null);
    setUnlockRequestAction("Void expense inside locked period");
    setVoidTarget(expense);
  }

  function handleVoidError(apiError) {
    const period = getLockedPeriodFromError(apiError);

    if (period) {
      setLockedPeriod(period);
      setUnlockRequestAction("Void expense inside locked period");
      setVoidTarget(null);
    }

    setError(getFriendlyApiError(apiError, "Failed to void expense."));
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

        <button onClick={() => loadExpenses()}>Refresh</button>
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
          Expenses, summaries, filters and void actions are restricted to this
          selected store. Voiding preserves the original row and requires a
          different authorised approver.
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

      <ExpenseVoidApprovalPanel
        expense={voidTarget}
        storeCode={currentStoreCode}
        onClose={() => setVoidTarget(null)}
        onSuccess={(successMessage) => {
          setVoidTarget(null);
          setMessage(successMessage);
          setError("");
          loadExpenses();
        }}
        onError={handleVoidError}
      />

      <div className="cards-grid expense-summary-grid expense-funding-summary">
        <div className="stat-card">
          <span>{currentStoreCode} Total Expenses</span>
          <strong>{formatMoney(summary.total_expenses)}</strong>
        </div>

        <div className="stat-card expense-closing-card">
          <span>Deducted from Daily Closing</span>
          <strong>{formatMoney(summary.closing_expenses)}</strong>
          <small>Only money explicitly taken from today&apos;s receipts.</small>
        </div>

        <div className="stat-card expense-external-card">
          <span>Accounting Only</span>
          <strong>{formatMoney(summary.externally_funded_expenses)}</strong>
          <small>Petty cash, prior funds, owner funds, bank/MoMo or credit.</small>
        </div>

        <div className="stat-card">
          <span>{currentStoreCode} Number of Expenses</span>
          <strong>{summary.expense_count || 0}</strong>
        </div>
      </div>

      <div className="two-column expenses-grid">
        <form className="section-card expense-funding-form" onSubmit={createExpense}>
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

          <label>Payment Method / Channel</label>
          <select
            name="payment_method"
            value={form.payment_method}
            onChange={handleChange}
          >
            <option value="cash">Cash</option>
            <option value="momo">Mobile Money</option>
            <option value="bank">Bank</option>
            <option value="other">Other</option>
          </select>

          <label>Where did the money come from?</label>
          <select
            name="funding_source"
            value={form.funding_source}
            onChange={handleChange}
            required
          >
            <option value="">Choose funding source</option>
            <option value="today_sales_receipts">
              Today&apos;s Sales Receipts
            </option>
            <option value="petty_cash">Petty Cash</option>
            <option value="prior_business_funds">
              Earlier / Prior Business Funds
            </option>
            <option value="owner_manager_funds">
              Owner or Manager Funds
            </option>
            <option value="bank_account">Separate Bank Account Balance</option>
            <option value="momo_wallet">Separate MoMo Wallet Balance</option>
            <option value="unpaid_credit">Credit / Not Paid Yet</option>
            <option value="other">Other Funding Source</option>
          </select>

          <div
            className={`expense-closing-decision ${
              !form.funding_source
                ? "is-unselected"
                : form.affects_daily_closing
                  ? "is-deducted"
                  : "is-accounting-only"
            }`}
          >
            <strong>
              {!form.funding_source
                ? "Choose where the expense money came from"
                : form.affects_daily_closing
                  ? "This expense will reduce Daily Closing"
                  : "This expense will not reduce Daily Closing"}
            </strong>
            <span>
              {!form.funding_source
                ? "No Daily Closing deduction is assumed until a funding source is selected."
                : form.affects_daily_closing
                  ? `The amount will be deducted from today's ${String(
                      form.payment_method
                    ).toUpperCase()} expected balance.`
                  : "It remains in expense and accounting reports, but today's expected settlement is unchanged."}
            </span>
          </div>

          <label>Funding / Closing Note</label>
          <textarea
            name="closing_treatment_note"
            value={form.closing_treatment_note}
            onChange={handleChange}
            maxLength={500}
            required={form.funding_source === "other"}
            placeholder={
              form.affects_daily_closing
                ? "Optional: Example — paid from today's counter cash"
                : "Example — paid by owner using personal funds"
            }
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
                loadExpenses({ search: "", from: "", to: "" });
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
          <div className="expense-table-wrap">
            <table className="expense-funding-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Store</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Payment</th>
                  <th>Funding Source</th>
                  <th>Daily Closing</th>
                  <th>Amount</th>
                  <th>Recorded By</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td data-label="Date">
                      {new Date(expense.expense_date).toLocaleDateString()}
                    </td>
                    <td data-label="Store">
                      {expense.branch_code ||
                        expense.store_code ||
                        currentStoreCode}
                    </td>
                    <td data-label="Category">
                      <strong>{expense.category}</strong>
                    </td>
                    <td data-label="Description">
                      {expense.description || "-"}
                      {expense.closing_treatment_note ? (
                        <small className="expense-treatment-note">
                          {expense.closing_treatment_note}
                        </small>
                      ) : null}
                    </td>
                    <td data-label="Payment">
                      {String(expense.payment_method || "cash").toUpperCase()}
                    </td>
                    <td data-label="Funding Source">
                      {String(expense.funding_source || "other")
                        .replaceAll("_", " ")
                        .replace(/\b\w/g, (letter) => letter.toUpperCase())}
                    </td>
                    <td data-label="Daily Closing">
                      <span
                        className={`expense-closing-badge ${
                          Number(expense.affects_daily_closing) === 1
                            ? "is-deducted"
                            : "is-accounting-only"
                        }`}
                      >
                        {Number(expense.affects_daily_closing) === 1
                          ? "Deduct"
                          : "Accounting only"}
                      </span>
                    </td>
                    <td data-label="Amount">{formatMoney(expense.amount)}</td>
                    <td data-label="Recorded By">
                      {expense.recorded_by_name || "-"}
                    </td>
                    <td data-label="Action">
                      <button
                        type="button"
                        className="small-danger"
                        onClick={() => openVoidExpense(expense)}
                      >
                        Void
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
