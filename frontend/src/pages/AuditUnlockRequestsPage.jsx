import { useEffect, useMemo, useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

export default function AuditUnlockRequestsPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();

  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState({
    total_requests: 0,
    pending_count: 0,
    approved_count: 0,
    rejected_count: 0,
  });

  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const [selectedRequest, setSelectedRequest] = useState(null);
  const [reviewStatus, setReviewStatus] = useState("approved");
  const [reviewNotes, setReviewNotes] = useState("");
  const [unlockPeriod, setUnlockPeriod] = useState(true);

  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canReview = role === "admin" || role === "manager";

  function formatDate(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleDateString();
  }

  function formatDateTime(value) {
    if (!value) return "-";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleString();
  }

  function formatStatus(value) {
    const cleanValue = String(value || "").toLowerCase();

    const statuses = {
      pending: "Pending Review",
      approved: "Approved",
      rejected: "Rejected",
      cancelled: "Cancelled",
    };

    return statuses[cleanValue] || value || "-";
  }

  function getStatusStyle(value) {
    const cleanValue = String(value || "").toLowerCase();

    if (cleanValue === "approved") {
      return {
        background: "#dcfce7",
        color: "#166534",
        border: "1px solid #bbf7d0",
      };
    }

    if (cleanValue === "rejected") {
      return {
        background: "#fee2e2",
        color: "#991b1b",
        border: "1px solid #fecaca",
      };
    }

    if (cleanValue === "cancelled") {
      return {
        background: "#f1f5f9",
        color: "#475569",
        border: "1px solid #cbd5e1",
      };
    }

    return {
      background: "#fef9c3",
      color: "#854d0e",
      border: "1px solid #fde68a",
    };
  }

  function formatArea(value) {
    const cleanValue = String(value || "").toLowerCase();

    const areas = {
      sale: "Sale",
      expense: "Expense",
      debt_payment: "Debt Payment",
      stock: "Stock",
      purchase: "Purchase",
      return: "Return",
      other: "Other",
    };

    return areas[cleanValue] || value || "-";
  }

  function getFriendlyApiError(error, fallbackMessage) {
    return error?.response?.data?.message || fallbackMessage;
  }

  async function loadUnlockRequests() {
    setLoading(true);
    setError("");

    try {
      const response = await axiosClient.get("/audit-unlock-requests", {
        params: {
          status: statusFilter,
          search,
        },
      });

      setRequests(response.data.requests || []);
      setSummary(response.data.summary || {});
    } catch (error) {
      setError(
        getFriendlyApiError(
          error,
          "Failed to load audit unlock requests. Make sure you are admin or manager."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUnlockRequests();
  }, []);

  const pendingRequests = useMemo(() => {
    return requests.filter(
      (request) => String(request.status || "").toLowerCase() === "pending"
    );
  }, [requests]);

  function openReviewModal(request, status) {
    setMessage("");
    setError("");
    setSelectedRequest(request);
    setReviewStatus(status);
    setReviewNotes("");
    setUnlockPeriod(status === "approved");
  }

  function closeReviewModal() {
    setSelectedRequest(null);
    setReviewStatus("approved");
    setReviewNotes("");
    setUnlockPeriod(true);
  }

  async function submitReview(event) {
    event.preventDefault();

    if (!selectedRequest) {
      setError("No unlock request selected.");
      return;
    }

    if (!reviewNotes.trim()) {
      setError("Review notes are required.");
      return;
    }

    const confirmText =
      reviewStatus === "approved"
        ? unlockPeriod
          ? "Approve this request and reopen the accounting period?"
          : "Approve this request without reopening the accounting period?"
        : "Reject this unlock request?";

    const confirmed = window.confirm(confirmText);

    if (!confirmed) return;

    setReviewing(true);
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.patch(
        `/audit-unlock-requests/${selectedRequest.id}/review`,
        {
          status: reviewStatus,
          review_notes: reviewNotes,
          unlock_period: unlockPeriod,
        }
      );

      setMessage(response.data.message || "Unlock request reviewed.");
      closeReviewModal();
      await loadUnlockRequests();
    } catch (error) {
      setError(
        getFriendlyApiError(error, "Failed to review unlock request.")
      );
    } finally {
      setReviewing(false);
    }
  }

  function exportRequestsCsv() {
    const rows = [
      [
        "ID",
        "Status",
        "Period",
        "Period Start",
        "Period End",
        "Area",
        "Requested Action",
        "Reason",
        "Requested By",
        "Requested At",
        "Reviewed By",
        "Reviewed At",
        "Review Notes",
      ],
      ...requests.map((request) => [
        request.id,
        formatStatus(request.status),
        request.period_label || "",
        request.period_start || "",
        request.period_end || "",
        formatArea(request.request_area),
        request.requested_action || "",
        request.reason || "",
        request.requested_by_name || request.requested_by_username || "",
        request.created_at || "",
        request.reviewed_by_name || request.reviewed_by_username || "",
        request.reviewed_at || "",
        request.review_notes || "",
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8;",
    });

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `audit_unlock_requests_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();

    window.URL.revokeObjectURL(url);
  }

  if (!canReview) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>You are not allowed to open Audit Unlock Requests.</p>
          </div>
        </div>

        <div className="error-box">
          Only admin and manager accounts can review audit unlock requests.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Audit Unlock Requests</h1>
          <p>
            Review requests to reopen approved accounting periods for correction
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={loadUnlockRequests}>
            Refresh
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={exportRequestsCsv}
          >
            Export CSV
          </button>
        </div>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="cards-grid">
        <div className="stat-card">
          <span>Total Requests</span>
          <strong>{summary.total_requests || 0}</strong>
        </div>

        <div className="stat-card">
          <span>Pending</span>
          <strong>{summary.pending_count || 0}</strong>
        </div>

        <div className="stat-card">
          <span>Approved</span>
          <strong>{summary.approved_count || 0}</strong>
        </div>

        <div className="stat-card">
          <span>Rejected</span>
          <strong>{summary.rejected_count || 0}</strong>
        </div>
      </div>

      {pendingRequests.length > 0 && (
        <div
          className="warning-box"
          style={{
            marginBottom: "18px",
          }}
        >
          <strong>{pendingRequests.length}</strong> unlock request
          {pendingRequests.length === 1 ? "" : "s"} waiting for review.
        </div>
      )}

      <div className="section-card">
        <h2>Filter Requests</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto auto",
            gap: "12px",
            alignItems: "end",
          }}
        >
          <div>
            <label>Status</label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label>Search</label>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search period, reason, staff or area"
            />
          </div>

          <button type="button" onClick={loadUnlockRequests}>
            Apply
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setStatusFilter("");
              setSearch("");
              setTimeout(loadUnlockRequests, 0);
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="section-card">
        <h2>Unlock Request Records</h2>

        {loading ? (
          <p>Loading unlock requests...</p>
        ) : requests.length === 0 ? (
          <p>No unlock requests found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Period</th>
                <th>Area</th>
                <th>Requested By</th>
                <th>Reason</th>
                <th>Reviewed By</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "6px 10px",
                        borderRadius: "999px",
                        fontWeight: "900",
                        fontSize: "12px",
                        ...getStatusStyle(request.status),
                      }}
                    >
                      {formatStatus(request.status)}
                    </span>
                  </td>

                  <td>
                    <strong>{request.period_label || "-"}</strong>
                    <br />
                    <small>
                      {request.period_start || "-"} to{" "}
                      {request.period_end || "-"}
                    </small>
                  </td>

                  <td>
                    <strong>{formatArea(request.request_area)}</strong>
                    <br />
                    <small>{request.requested_action || "-"}</small>
                  </td>

                  <td>
                    {request.requested_by_name ||
                      request.requested_by_username ||
                      "-"}
                  </td>

                  <td
                    style={{
                      maxWidth: "280px",
                      whiteSpace: "normal",
                    }}
                  >
                    {request.reason || "-"}
                  </td>

                  <td>
                    {request.reviewed_by_name ||
                      request.reviewed_by_username ||
                      "-"}
                    <br />
                    <small>{formatDateTime(request.reviewed_at)}</small>
                  </td>

                  <td>{formatDateTime(request.created_at)}</td>

                  <td>
                    {String(request.status || "").toLowerCase() ===
                    "pending" ? (
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => openReviewModal(request, "approved")}
                        >
                          Approve
                        </button>

                        <button
                          type="button"
                          className="small-danger"
                          onClick={() => openReviewModal(request, "rejected")}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <small>{request.review_notes || "Reviewed"}</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedRequest && (
        <div className="modal-backdrop">
          <div className="receipt-modal">
            <div className="modal-header">
              <div>
                <h2>
                  {reviewStatus === "approved"
                    ? "Approve Unlock Request"
                    : "Reject Unlock Request"}
                </h2>
                <p>
                  Period: <strong>{selectedRequest.period_label}</strong>
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={closeReviewModal}
              >
                Close
              </button>
            </div>

            <form className="receipt-preview" onSubmit={submitReview}>
              <div className="receipt-info-grid">
                <p>
                  <strong>Requested By:</strong>{" "}
                  {selectedRequest.requested_by_name ||
                    selectedRequest.requested_by_username ||
                    "-"}
                </p>

                <p>
                  <strong>Area:</strong>{" "}
                  {formatArea(selectedRequest.request_area)}
                </p>

                <p>
                  <strong>Action:</strong>{" "}
                  {selectedRequest.requested_action || "-"}
                </p>

                <p>
                  <strong>Period Start:</strong>{" "}
                  {formatDate(selectedRequest.period_start)}
                </p>

                <p>
                  <strong>Period End:</strong>{" "}
                  {formatDate(selectedRequest.period_end)}
                </p>

                <p>
                  <strong>Requested At:</strong>{" "}
                  {formatDateTime(selectedRequest.created_at)}
                </p>
              </div>

              <div
                style={{
                  marginTop: "14px",
                  padding: "14px",
                  borderRadius: "12px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                }}
              >
                <strong>Request Reason:</strong>
                <p
                  style={{
                    marginBottom: 0,
                    lineHeight: 1.6,
                  }}
                >
                  {selectedRequest.reason}
                </p>
              </div>

              <label>Review Decision</label>
              <select
                value={reviewStatus}
                onChange={(event) => {
                  const nextStatus = event.target.value;
                  setReviewStatus(nextStatus);
                  setUnlockPeriod(nextStatus === "approved");
                }}
              >
                <option value="approved">Approve Request</option>
                <option value="rejected">Reject Request</option>
              </select>

              {reviewStatus === "approved" && (
                <label
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "center",
                    marginTop: "12px",
                    fontWeight: "800",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={unlockPeriod}
                    onChange={(event) => setUnlockPeriod(event.target.checked)}
                    style={{
                      width: "18px",
                      height: "18px",
                    }}
                  />
                  Reopen this accounting period for correction
                </label>
              )}

              <label>Review Notes</label>
              <textarea
                value={reviewNotes}
                onChange={(event) => setReviewNotes(event.target.value)}
                placeholder={
                  reviewStatus === "approved"
                    ? "Example: Approved because the customer payment was entered on the wrong date."
                    : "Example: Rejected because the request reason is not enough."
                }
                rows={5}
              />

              <div className="modal-actions">
                <button type="submit" disabled={reviewing}>
                  {reviewing
                    ? "Saving..."
                    : reviewStatus === "approved"
                    ? "Approve Request"
                    : "Reject Request"}
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeReviewModal}
                  disabled={reviewing}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}