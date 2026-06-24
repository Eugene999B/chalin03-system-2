import { useEffect, useState } from "react";
import axiosClient from "../api/axiosClient";

const CONFIRMATION_TEXT = "CLEAR CHALIN03 TEST DATA";

export default function MaintenancePage() {
  const [summary, setSummary] = useState(null);
  const [systemAdminPassword, setSystemAdminPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, []);

  async function clearBusinessData(event) {
    event.preventDefault();

    const confirmBrowser = window.confirm(
      "This will permanently clear test/business data. Users and settings will be kept. Do you want to continue?"
    );

    if (!confirmBrowser) {
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

  const canClear =
    systemAdminPassword.trim().length > 0 &&
    confirmation === CONFIRMATION_TEXT &&
    !clearing;

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

      <div className="warning-box">
        <strong>Important:</strong> This page is for the main System
        Administrator only. It clears business/test records but keeps users and
        business settings.
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="two-column">
        <div className="section-card">
          <h2>Protected Data</h2>
          <p>These records will not be deleted:</p>

          <ul style={{ lineHeight: "1.8", fontWeight: "700" }}>
            <li>Users / login accounts</li>
            <li>Business settings</li>
            <li>Receipt settings</li>
            <li>System Administrator account</li>
          </ul>

          <div className="warning-box">
            Do not use this after real business operation has started unless you
            are intentionally resetting the system.
          </div>
        </div>

        <div className="section-card">
          <h2>Records That Will Be Cleared</h2>

          {loading ? (
            <p>Loading summary...</p>
          ) : tableNames.length === 0 ? (
            <p>No clearable records found or summary not loaded.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Records</th>
                </tr>
              </thead>

              <tbody>
                {tableNames.map((tableName) => (
                  <tr key={tableName}>
                    <td>
                      <strong>{tableName}</strong>
                    </td>
                    <td>{counts[tableName]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="section-card">
        <h2>Clear Test / Business Data</h2>

        <p>
          To continue, type the System Administrator password and the exact
          confirmation text.
        </p>

        <div className="warning-box">
          Type exactly: <strong>{CONFIRMATION_TEXT}</strong>
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
            placeholder={CONFIRMATION_TEXT}
          />

          <button
            type="submit"
            className="danger-button"
            disabled={!canClear}
          >
            {clearing ? "Clearing..." : "Clear Test Data"}
          </button>
        </form>
      </div>
    </div>
  );
}