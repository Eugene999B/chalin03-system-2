import { useState } from "react";
import axiosClient from "../api/axiosClient";

export default function AuditUnlockRequestBox({
  lockedPeriod,
  requestArea = "other",
  requestedAction = "Correction needed inside locked period",
  onRequestSent,
}) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!lockedPeriod) {
    return null;
  }

  async function sendUnlockRequest(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!reason.trim()) {
      setError("Please explain why this approved period should be reopened.");
      return;
    }

    setSending(true);

    try {
      const response = await axiosClient.post("/audit-unlock-requests", {
        audit_signoff_id: lockedPeriod.id || null,
        period_label: lockedPeriod.period_label || "Locked accounting period",
        period_start: lockedPeriod.period_start || null,
        period_end: lockedPeriod.period_end || null,
        request_area: requestArea,
        requested_action: requestedAction,
        reason: reason.trim(),
      });

      setMessage(
        response.data.message ||
          "Unlock request sent successfully for review."
      );
      setReason("");

      if (onRequestSent) {
        onRequestSent(response.data.request);
      }
    } catch (error) {
      setError(
        error.response?.data?.message || "Failed to send unlock request."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{
        marginTop: "12px",
        padding: "14px",
        borderRadius: "14px",
        border: "1px solid #fed7aa",
        background: "#fff7ed",
        color: "#7c2d12",
      }}
    >
      <h3
        style={{
          margin: "0 0 8px",
          fontSize: "18px",
          color: "#9a3412",
        }}
      >
        Request Period Unlock
      </h3>

      <p
        style={{
          margin: "0 0 10px",
          fontWeight: "800",
          lineHeight: 1.5,
        }}
      >
        This transaction is blocked because{" "}
        <strong>{lockedPeriod.period_label || "this accounting period"}</strong>{" "}
        has already been approved. You can send a request for an admin or manager
        to review.
      </p>

      <form onSubmit={sendUnlockRequest}>
        <label>Reason for unlock request</label>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Example: I need to correct a customer payment entered in the wrong period."
          rows={4}
        />

        {message && (
          <div
            className="success-box"
            style={{
              marginTop: "10px",
            }}
          >
            {message}
          </div>
        )}

        {error && (
          <div
            className="error-box"
            style={{
              marginTop: "10px",
            }}
          >
            {error}
          </div>
        )}

        <button type="submit" disabled={sending}>
          {sending ? "Sending Request..." : "Send Unlock Request"}
        </button>
      </form>
    </div>
  );
}