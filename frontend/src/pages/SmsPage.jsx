import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function SmsPage() {
  const { user, branchId, branchCode, branchName } = useAuth();

  const currentBranchCode =
    branchCode ||
    user?.branch_code ||
    user?.selected_branch?.branch_code ||
    user?.selected_branch?.code ||
    "STORE";

  const currentBranchName =
    branchName ||
    user?.branch_name ||
    user?.selected_branch?.branch_name ||
    user?.selected_branch?.name ||
    "Selected Store";

  const [smsStatus, setSmsStatus] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [logs, setLogs] = useState([]);

  const [targetType, setTargetType] = useState("single");
  const [manualPhone, setManualPhone] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
  const [message, setMessage] = useState("");

  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState(
    "CHALIN03 test SMS. Your SMS setup is working."
  );

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingDailySummary, setSendingDailySummary] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const filteredCustomers = useMemo(() => {
    const searchText = customerSearch.trim().toLowerCase();

    if (!searchText) {
      return customers;
    }

    return customers.filter((customer) => {
      const text = [customer.name, customer.phone, customer.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(searchText);
    });
  }, [customers, customerSearch]);

  const selectedCount = selectedCustomerIds.length;

  const statusStyle = useMemo(() => {
    const safetyLevel = smsStatus?.safety_level || "safe";

    if (safetyLevel === "live") {
      return {
        background: "#fef2f2",
        border: "1px solid #fecaca",
        color: "#991b1b",
      };
    }

    if (safetyLevel === "warning") {
      return {
        background: "#fffbeb",
        border: "1px solid #fde68a",
        color: "#92400e",
      };
    }

    if (safetyLevel === "danger") {
      return {
        background: "#fee2e2",
        border: "1px solid #fca5a5",
        color: "#7f1d1d",
      };
    }

    if (safetyLevel === "disabled") {
      return {
        background: "#f3f4f6",
        border: "1px solid #d1d5db",
        color: "#374151",
      };
    }

    return {
      background: "#eff6ff",
      border: "1px solid #bfdbfe",
      color: "#1e3a8a",
    };
  }, [smsStatus]);

  function getFriendlyError(error, fallback) {
    return error?.response?.data?.message || error?.message || fallback;
  }

  async function loadSmsPageData(options = {}) {
    const silent = Boolean(options.silent);

    if (!silent) {
      setLoading(true);
      setError("");
      setNotice("");
    }

    try {
      const [statusResponse, customersResponse, logsResponse] =
        await Promise.all([
          axiosClient.get("/sms/status"),
          axiosClient.get("/sms/customers"),
          axiosClient.get("/sms/logs?limit=50"),
        ]);

      setSmsStatus(statusResponse.data.sms || null);
      setCustomers(customersResponse.data.customers || []);
      setLogs(logsResponse.data.logs || []);
    } catch (error) {
      setError(getFriendlyError(error, "Failed to load SMS page."));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadSmsPageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  function toggleCustomer(customerId) {
    const cleanId = Number(customerId);

    setSelectedCustomerIds((currentIds) => {
      if (currentIds.includes(cleanId)) {
        return currentIds.filter((id) => id !== cleanId);
      }

      return [...currentIds, cleanId];
    });
  }

  function selectAllFilteredCustomers() {
    const ids = filteredCustomers.map((customer) => Number(customer.id));
    setSelectedCustomerIds(ids);
  }

  function clearSelectedCustomers() {
    setSelectedCustomerIds([]);
  }

  async function sendTestSms() {
    setSendingTest(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/test", {
        phone: testPhone,
        message: testMessage,
      });

      setNotice(
        response.data?.result?.message ||
          response.data?.message ||
          "Test SMS sent successfully."
      );

      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to send test SMS."));
    } finally {
      setSendingTest(false);
    }
  }

  async function sendDailySummarySms() {
    setSendingDailySummary(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/daily-summary");

      setNotice(response.data.message || "Daily summary SMS sent successfully.");

      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to send daily summary SMS."));
    } finally {
      setSendingDailySummary(false);
    }
  }

  async function sendCustomSms(event) {
    event.preventDefault();

    setSending(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosClient.post("/sms/custom", {
        target_type: targetType,
        phone: manualPhone,
        customer_ids: selectedCustomerIds,
        message,
        sms_type: "other",
      });

      setNotice(response.data.message || "SMS sending completed.");
      setManualPhone("");
      setMessage("");
      setSelectedCustomerIds([]);

      await loadSmsPageData({ silent: true });
    } catch (error) {
      setError(getFriendlyError(error, "Failed to send SMS."));
    } finally {
      setSending(false);
    }
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "-";
    }

    return date.toLocaleString();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>SMS Center</h1>
          <p>
            Send custom SMS messages for{" "}
            <strong>
              {currentBranchCode} — {currentBranchName}
            </strong>
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={() => loadSmsPageData()}>
            Refresh
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={sendDailySummarySms}
            disabled={sendingDailySummary}
          >
            {sendingDailySummary
              ? "Sending Summary..."
              : "Send Today's Summary SMS"}
          </button>
        </div>
      </div>

      {notice && <div className="success-box">{notice}</div>}
      {error && <div className="error-box">{error}</div>}

      <div
        style={{
          marginBottom: "18px",
          padding: "16px",
          borderRadius: "14px",
          fontWeight: "800",
          ...statusStyle,
        }}
      >
        <div style={{ fontSize: "16px", marginBottom: "6px" }}>
          {smsStatus?.mode_title || "SMS MODE: CHECKING..."}
        </div>

        <div style={{ fontSize: "14px", marginBottom: "8px" }}>
          {smsStatus?.mode_message ||
            "Checking SMS provider mode. Mock mode means no real SMS credit is used while testing."}
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            fontSize: "13px",
            fontWeight: "700",
          }}
        >
          <span>Provider: {smsStatus?.provider_label || "Unknown"}</span>
          <span>Sender ID: {smsStatus?.sender_id || "-"}</span>
          <span>SMS Enabled: {smsStatus?.enabled ? "Yes" : "No"}</span>
          <span>Real SMS: {smsStatus?.live_sending ? "YES" : "NO"}</span>
        </div>
      </div>

      {loading ? (
        <div className="section-card">
          <p>Loading SMS page...</p>
        </div>
      ) : (
        <div className="two-column">
          <form className="section-card" onSubmit={sendCustomSms}>
            <h2>Compose SMS</h2>

            <label>Send To</label>
            <select
              value={targetType}
              onChange={(event) => {
                setTargetType(event.target.value);
                setError("");
                setNotice("");
              }}
            >
              <option value="single">One phone number</option>
              <option value="selected">Selected customers</option>
              <option value="all">All customers in selected store</option>
            </select>

            {targetType === "single" && (
              <>
                <label>Phone Number</label>
                <input
                  value={manualPhone}
                  onChange={(event) => setManualPhone(event.target.value)}
                  placeholder="Example: 0240000000"
                />
              </>
            )}

            {targetType === "selected" && (
              <div>
                <label>Search Customers</label>
                <input
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Search by name, phone or location"
                />

                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    flexWrap: "wrap",
                    margin: "10px 0",
                  }}
                >
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={selectAllFilteredCustomers}
                  >
                    Select Filtered
                  </button>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={clearSelectedCustomers}
                  >
                    Clear Selected
                  </button>
                </div>

                <p>
                  Selected customers: <strong>{selectedCount}</strong>
                </p>

                <div
                  style={{
                    maxHeight: "280px",
                    overflowY: "auto",
                    border: "1px solid #d8e0ea",
                    borderRadius: "12px",
                    padding: "8px",
                    background: "#ffffff",
                  }}
                >
                  {filteredCustomers.length === 0 ? (
                    <p>No customers with phone numbers found.</p>
                  ) : (
                    filteredCustomers.map((customer) => (
                      <label
                        key={customer.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr",
                          gap: "10px",
                          alignItems: "start",
                          padding: "10px",
                          borderBottom: "1px solid #edf1f5",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCustomerIds.includes(
                            Number(customer.id)
                          )}
                          onChange={() => toggleCustomer(customer.id)}
                        />

                        <span>
                          <strong>{customer.name}</strong>
                          <br />
                          <small>
                            {customer.phone}
                            {customer.location
                              ? ` | ${customer.location}`
                              : ""}
                          </small>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            {targetType === "all" && (
              <div className="warning-box">
                This will send the message to all customers with phone numbers
                inside {currentBranchCode}. Current count: {customers.length}.
                Use this carefully because live SMS will spend credit.
              </div>
            )}

            <label>Message</label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows="7"
              placeholder="Type your SMS message here..."
              maxLength="480"
            />

            <p>
              Characters: <strong>{message.length}</strong> / 480
            </p>

            <button type="submit" disabled={sending}>
              {sending ? "Sending..." : "Send SMS"}
            </button>
          </form>

          <div className="section-card">
            <h2>SMS Guide</h2>

            <p>
              Use this page for customer notices, payment reminders, product
              availability messages, shop announcements, and daily business
              summaries.
            </p>

            <div className="warning-box">
              Start in mock mode first. After testing, switch the backend to
              Arkesel live mode only when the boss approves SMS spending.
            </div>

            <h3>Test SMS Provider</h3>
            <p>
              Use this first before sending SMS to customers. In mock mode, no
              real SMS credit is used.
            </p>

            <label>Test Phone Number</label>
            <input
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="Example: 0240000000"
            />

            <label>Test Message</label>
            <textarea
              value={testMessage}
              onChange={(event) => setTestMessage(event.target.value)}
              rows="4"
              maxLength="480"
            />

            <p>
              Characters: <strong>{testMessage.length}</strong> / 480
            </p>

            <button
              type="button"
              className="secondary-button"
              onClick={sendTestSms}
              disabled={sendingTest}
            >
              {sendingTest ? "Sending Test..." : "Send Test SMS"}
            </button>

            <h3>Boss Daily Summary</h3>
            <p>
              Click the button below to send today&apos;s sales, debts,
              expenses, and low-stock summary to the owner or manager phone
              number saved in settings.
            </p>

            <button
              type="button"
              className="secondary-button"
              onClick={sendDailySummarySms}
              disabled={sendingDailySummary}
            >
              {sendingDailySummary
                ? "Sending Summary..."
                : "Send Today's Daily Summary SMS"}
            </button>

            <h3>Good example</h3>
            <p>
              CHALIN03: Dear customer, your goods are ready for collection at
              Chalin 03 Main Store. Thank you.
            </p>

            <h3>Important</h3>
            <p>
              Do not send unnecessary messages. SMS credit costs money, and
              customers should only receive useful business messages.
            </p>
          </div>
        </div>
      )}

      <div className="section-card">
        <h2>Recent SMS History</h2>

        {logs.length === 0 ? (
          <p>No SMS records yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Status</th>
                <th>Message</th>
                <th>Sent By</th>
              </tr>
            </thead>

            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.created_at)}</td>
                  <td>{log.recipient_phone}</td>
                  <td>{log.sms_type}</td>
                  <td>
                    <strong>{log.status}</strong>
                  </td>
                  <td>{log.message}</td>
                  <td>{log.sent_by_name || log.sent_by_username || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}