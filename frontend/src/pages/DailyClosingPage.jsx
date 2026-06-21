import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function DailyClosingPage() {
  const [closingDate, setClosingDate] = useState(getTodayDate());
  const [summary, setSummary] = useState(null);
  const [closings, setClosings] = useState([]);
  const [alreadyClosed, setAlreadyClosed] = useState(false);

  const [cashCounted, setCashCounted] = useState("");
  const [momoCounted, setMomoCounted] = useState("");
  const [bankCounted, setBankCounted] = useState("");
  const [otherCounted, setOtherCounted] = useState("");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatMoney(value) {
    return `GHS ${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleDateString();
  }

  function formatDateTime(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function countedTotal() {
    return (
      Number(cashCounted || 0) +
      Number(momoCounted || 0) +
      Number(bankCounted || 0) +
      Number(otherCounted || 0)
    );
  }

  function differenceTotal() {
    if (!summary) return 0;
    return countedTotal() - Number(summary.expected_total || 0);
  }

  function fillExpectedAmounts(summaryData) {
    setCashCounted(Number(summaryData.expected_cash || 0).toFixed(2));
    setMomoCounted(Number(summaryData.expected_momo || 0).toFixed(2));
    setBankCounted(Number(summaryData.expected_bank || 0).toFixed(2));
    setOtherCounted(Number(summaryData.expected_other || 0).toFixed(2));
  }

  async function loadSummary(dateValue = closingDate) {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.get("/daily-closing/summary", {
        params: {
          date: dateValue,
        },
      });

      const summaryData = response.data.summary;

      setSummary(summaryData);
      setAlreadyClosed(response.data.already_closed || false);
      fillExpectedAmounts(summaryData);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load daily closing summary."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadClosings() {
    try {
      const response = await axiosClient.get("/daily-closing");
      setClosings(response.data.closings || []);
    } catch (error) {
      setError(
        error.response?.data?.message ||
          "Failed to load saved daily closings."
      );
    }
  }

  useEffect(() => {
    loadSummary();
    loadClosings();
  }, []);

  async function handleDateChange(event) {
    const newDate = event.target.value;
    setClosingDate(newDate);
    await loadSummary(newDate);
  }

  async function saveDailyClosing(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!summary) {
      setError("Load the summary first.");
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to close business for ${closingDate}?`
    );

    if (!confirmed) return;

    setSaving(true);

    try {
      const response = await axiosClient.post("/daily-closing", {
        closing_date: closingDate,
        cash_counted: Number(cashCounted || 0),
        momo_counted: Number(momoCounted || 0),
        bank_counted: Number(bankCounted || 0),
        other_counted: Number(otherCounted || 0),
        notes,
      });

      setMessage(response.data.message || "Daily closing saved successfully.");
      setNotes("");

      await loadSummary(closingDate);
      await loadClosings();
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to save daily closing."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Daily Closing</h1>
          <p>Close the business day and compare expected money with counted money</p>
        </div>

        <button type="button" onClick={() => loadSummary(closingDate)}>
          Refresh Summary
        </button>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="section-card">
        <h2>Closing Date</h2>

        <div className="filter-grid export-filter-grid">
          <div>
            <label>Choose Date</label>
            <input type="date" value={closingDate} onChange={handleDateChange} />
          </div>

          <div className="filter-actions">
            <button type="button" onClick={() => loadSummary(closingDate)}>
              Load Summary
            </button>
          </div>
        </div>

        {alreadyClosed && (
          <div className="error-box">
            This date has already been closed. You cannot close the same day twice.
          </div>
        )}
      </div>

      {loading && (
        <div className="section-card">
          <p>Loading summary...</p>
        </div>
      )}

      {summary && (
        <>
          <div className="cards-grid">
            <div className="stat-card">
              <span>Sales Total</span>
              <strong>{formatMoney(summary.sales_total)}</strong>
            </div>

            <div className="stat-card">
              <span>Sales Received</span>
              <strong>{formatMoney(summary.sales_received)}</strong>
            </div>

            <div className="stat-card">
              <span>Debt Payments</span>
              <strong>{formatMoney(summary.debt_payments_total)}</strong>
            </div>

            <div className="stat-card">
              <span>Expenses</span>
              <strong>{formatMoney(summary.expenses_total)}</strong>
            </div>

            <div className="stat-card">
              <span>Expected Total</span>
              <strong>{formatMoney(summary.expected_total)}</strong>
            </div>

            <div className="stat-card">
              <span>Counted Total</span>
              <strong>{formatMoney(countedTotal())}</strong>
            </div>

            <div className="stat-card">
              <span>Difference</span>
              <strong>{formatMoney(differenceTotal())}</strong>
            </div>
          </div>

          <div className="two-column">
            <div className="section-card">
              <h2>Expected Money</h2>

              <table>
                <tbody>
                  <tr>
                    <td>Cash Sales</td>
                    <td>{formatMoney(summary.cash_sales)}</td>
                  </tr>
                  <tr>
                    <td>Debt Cash</td>
                    <td>{formatMoney(summary.debt_cash)}</td>
                  </tr>
                  <tr>
                    <td>Expenses Deducted From Cash</td>
                    <td>{formatMoney(summary.expenses_total)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Expected Cash</strong>
                    </td>
                    <td>
                      <strong>{formatMoney(summary.expected_cash)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Expected MoMo</td>
                    <td>{formatMoney(summary.expected_momo)}</td>
                  </tr>
                  <tr>
                    <td>Expected Bank</td>
                    <td>{formatMoney(summary.expected_bank)}</td>
                  </tr>
                  <tr>
                    <td>Expected Other / Mixed</td>
                    <td>{formatMoney(summary.expected_other)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Expected Total</strong>
                    </td>
                    <td>
                      <strong>{formatMoney(summary.expected_total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <form className="section-card" onSubmit={saveDailyClosing}>
              <h2>Counted Money</h2>

              <label>Cash Counted</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cashCounted}
                onChange={(event) => setCashCounted(event.target.value)}
              />

              <label>MoMo Counted</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={momoCounted}
                onChange={(event) => setMomoCounted(event.target.value)}
              />

              <label>Bank Counted</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={bankCounted}
                onChange={(event) => setBankCounted(event.target.value)}
              />

              <label>Other / Mixed Counted</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={otherCounted}
                onChange={(event) => setOtherCounted(event.target.value)}
              />

              <label>Closing Notes</label>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Example: Cash balanced. MoMo pending confirmation."
              />

              <p>
                <strong>Total Counted:</strong> {formatMoney(countedTotal())}
              </p>

              <p>
                <strong>Difference:</strong> {formatMoney(differenceTotal())}
              </p>

              <button type="submit" disabled={saving || alreadyClosed}>
                {saving
                  ? "Saving..."
                  : alreadyClosed
                  ? "Already Closed"
                  : "Save Daily Closing"}
              </button>
            </form>
          </div>
        </>
      )}

      <div className="section-card">
        <h2>Saved Daily Closings</h2>

        {closings.length === 0 ? (
          <p>No daily closing records yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Expected</th>
                <th>Counted</th>
                <th>Difference</th>
                <th>Closed By</th>
                <th>Closed At</th>
              </tr>
            </thead>

            <tbody>
              {closings.map((closing) => (
                <tr key={closing.id}>
                  <td>{formatDate(closing.closing_date)}</td>
                  <td>{formatMoney(closing.expected_total)}</td>
                  <td>{formatMoney(closing.total_counted)}</td>
                  <td>{formatMoney(closing.difference_total)}</td>
                  <td>{closing.closed_by_name || "-"}</td>
                  <td>{formatDateTime(closing.closed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}