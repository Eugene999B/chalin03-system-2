import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/customerMergeEmergency.css";

function money(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-GB", { hour12: false });
}

function sourceLabel(source) {
  return `#${source.id} · ${source.name || "Unnamed customer"}${
    source.phone ? ` · ${source.phone}` : ""
  }`;
}

function statusText(status) {
  const labels = {
    strong_source_match: "Strong source match",
    ambiguous_match: "Multiple possible matches",
    target_match: "Looks like the master customer",
    manual_review: "Manual review required",
  };
  return labels[status] || "Review required";
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 4.5 5v5.8c0 4.8 3 9.1 7.5 11.2 4.5-2.1 7.5-6.4 7.5-11.2V5L12 2Zm0 4.1 3.7 1.5v3.2c0 2.9-1.4 5.6-3.7 7.3-2.3-1.7-3.7-4.4-3.7-7.3V7.6L12 6.1Zm-1 3v4.2h2V9.1h-2Zm0 5.4v2h2v-2h-2Z" />
    </svg>
  );
}

export default function CustomerMergeEmergencyPanel({ onRecovered }) {
  const { user, branchName } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("merges");
  const [review, setReview] = useState({ merges: [], merge_count: 0 });
  const [integrity, setIntegrity] = useState({
    anomalies: [],
    mixed_identity_accounts: [],
  });
  const [assignments, setAssignments] = useState({});
  const [reason, setReason] = useState({});
  const [confirmation, setConfirmation] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;

    async function loadEmergencyReview() {
      setLoading(true);
      setError("");
      try {
        const [reviewResponse, integrityResponse] = await Promise.all([
          axiosClient.get("/customer-merge-recovery/today"),
          axiosClient.get("/customer-merge-recovery/integrity"),
        ]);
        if (cancelled) return;
        const nextReview = reviewResponse.data || { merges: [], merge_count: 0 };
        setReview(nextReview);
        setIntegrity(
          integrityResponse.data || {
            anomalies: [],
            mixed_identity_accounts: [],
          }
        );

        const defaults = {};
        for (const merge of nextReview.merges || []) {
          defaults[merge.activity_id] = {};
          for (const transaction of merge.transactions || []) {
            defaults[merge.activity_id][transaction.sale_id] =
              transaction.recommended_source_customer_id
                ? String(transaction.recommended_source_customer_id)
                : "";
          }
        }
        setAssignments(defaults);
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError.response?.data?.message ||
              "Could not load the customer merge recovery review."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEmergencyReview();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshKey]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !submitting) setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, submitting]);

  const urgentCount = Number(review.merge_count || 0);
  const anomalyCount = Number(integrity.anomaly_count || 0);
  const mixedCount = Number(integrity.mixed_identity_account_count || 0);

  const selectedCounts = useMemo(() => {
    const counts = {};
    for (const [activityId, saleAssignments] of Object.entries(assignments)) {
      counts[activityId] = Object.values(saleAssignments).filter(Boolean).length;
    }
    return counts;
  }, [assignments]);

  if (!isAdmin) return null;

  function setAssignment(activityId, saleId, sourceCustomerId) {
    setAssignments((current) => ({
      ...current,
      [activityId]: {
        ...(current[activityId] || {}),
        [saleId]: sourceCustomerId,
      },
    }));
  }

  async function reverseSelected(merge) {
    const mergeAssignments = assignments[merge.activity_id] || {};
    const payloadAssignments = Object.entries(mergeAssignments)
      .filter(([, sourceCustomerId]) => sourceCustomerId)
      .map(([saleId, sourceCustomerId]) => ({
        sale_id: Number(saleId),
        source_customer_id: Number(sourceCustomerId),
      }));

    if (payloadAssignments.length === 0) {
      setError("Select at least one receipt that belongs to a restored customer.");
      return;
    }

    setSubmitting(merge.activity_id);
    setError("");
    setMessage("");
    try {
      const response = await axiosClient.post(
        `/customer-merge-recovery/${merge.activity_id}/reverse`,
        {
          assignments: payloadAssignments,
          reason: reason[merge.activity_id] || "",
          confirmation: confirmation[merge.activity_id] || "",
        }
      );
      setMessage(response.data.message || "Selected customer links were restored.");
      setRefreshKey((current) => current + 1);
      onRecovered?.(response.data.result);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "The correction was stopped safely. No partial update was saved."
      );
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="cmr-shell" aria-labelledby="cmr-title">
      <div className="cmr-alert-icon">
        <IconShield />
      </div>
      <div className="cmr-alert-copy">
        <span className="cmr-kicker">Emergency customer debt protection</span>
        <h2 id="cmr-title">Customer merges are temporarily frozen</h2>
        <p>
          Review today&apos;s merges before changing any debt. Sales, debts and payments
          remain preserved; nothing has been overwritten from Sales History.
        </p>
      </div>
      <div className="cmr-alert-stats">
        <span><strong>{urgentCount}</strong> merge{urgentCount === 1 ? "" : "s"} today</span>
        <span><strong>{mixedCount}</strong> mixed-identity debt account{mixedCount === 1 ? "" : "s"}</span>
        <span><strong>{anomalyCount}</strong> financial consistency flag{anomalyCount === 1 ? "" : "s"}</span>
      </div>
      <button type="button" className="cmr-open" onClick={() => setOpen(true)}>
        Open emergency review
      </button>

      {open && (
        <div
          className="cmr-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) setOpen(false);
          }}
        >
          <section className="cmr-workspace" role="dialog" aria-modal="true">
            <header className="cmr-workspace-header">
              <div>
                <span className="cmr-kicker">{branchName || "Selected store"}</span>
                <h2>Customer Merge & Debt Recovery</h2>
                <p>Review evidence first. Correct receipt ownership without changing money.</p>
              </div>
              <button
                type="button"
                className="cmr-close"
                disabled={Boolean(submitting)}
                onClick={() => setOpen(false)}
              >
                × Close
              </button>
            </header>

            <div className="cmr-workspace-body">
              {error && <div className="cmr-message cmr-error">{error}</div>}
              {message && <div className="cmr-message cmr-success">{message}</div>}

              <div className="cmr-rules">
                <strong>Safe recovery rules</strong>
                <span>Do not use Sales History totals to overwrite debt.</span>
                <span>Do not select a receipt unless its preserved name or phone belongs to the restored customer.</span>
                <span>Debt amounts and payment records are never recalculated by this tool.</span>
              </div>

              <div className="cmr-tabs">
                <button
                  type="button"
                  className={activeTab === "merges" ? "is-active" : ""}
                  onClick={() => setActiveTab("merges")}
                >
                  Today&apos;s merges ({urgentCount})
                </button>
                <button
                  type="button"
                  className={activeTab === "integrity" ? "is-active" : ""}
                  onClick={() => setActiveTab("integrity")}
                >
                  Debt integrity review ({anomalyCount + mixedCount})
                </button>
              </div>

              {loading ? (
                <div className="cmr-loading">Checking merge and debt evidence…</div>
              ) : activeTab === "merges" ? (
                <div className="cmr-merge-list">
                  {(review.merges || []).length === 0 ? (
                    <div className="cmr-empty">
                      <strong>No customer merge was recorded today.</strong>
                      <span>The problem may come from older data or a non-merge debt inconsistency.</span>
                    </div>
                  ) : (
                    review.merges.map((merge) => (
                      <article className="cmr-merge-card" key={merge.activity_id}>
                        <div className="cmr-merge-heading">
                          <div>
                            <span className="cmr-audit-id">Merge audit #{merge.activity_id}</span>
                            <h3>
                              Target: {merge.current_target_customer?.name || merge.target_customer_after?.name || `Customer #${merge.target_customer_id}`}
                            </h3>
                            <p>
                              {dateTime(merge.performed_at)} · by {merge.performed_by}
                            </p>
                          </div>
                          <div className="cmr-merge-totals">
                            <span>{merge.summary.current_sale_count} current receipts</span>
                            <strong>{money(merge.summary.current_debt_balance)} current debt</strong>
                          </div>
                        </div>

                        <div className="cmr-source-strip">
                          <strong>Deleted source profile{merge.source_customers.length === 1 ? "" : "s"} recorded in audit:</strong>
                          {merge.source_customers.map((source) => (
                            <span key={source.id}>{sourceLabel(source)}</span>
                          ))}
                        </div>

                        {merge.reversed ? (
                          <div className="cmr-message cmr-success">
                            This merge already has a recorded reversal. Refresh statements and verify balances.
                          </div>
                        ) : (
                          <>
                            <div className="cmr-transaction-table-wrap">
                              <table className="cmr-transaction-table">
                                <thead>
                                  <tr>
                                    <th>Receipt evidence</th>
                                    <th>Sale</th>
                                    <th>Debt</th>
                                    <th>Assessment</th>
                                    <th>Return receipt to</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(merge.transactions || []).map((transaction) => (
                                    <tr key={`${merge.activity_id}-${transaction.sale_id}`}>
                                      <td data-label="Receipt evidence">
                                        <strong>{transaction.receipt_number}</strong>
                                        <span>{transaction.sale_customer_name_snapshot || "No saved name"}</span>
                                        <small>{transaction.sale_customer_phone_snapshot || "No saved phone"}</small>
                                        <small>{dateTime(transaction.sale_date)}</small>
                                      </td>
                                      <td data-label="Sale">
                                        <strong>{money(transaction.sale_total)}</strong>
                                        <span>Paid {money(transaction.sale_amount_paid)}</span>
                                        <small>Balance {money(transaction.sale_balance)}</small>
                                      </td>
                                      <td data-label="Debt">
                                        {transaction.debt_id ? (
                                          <>
                                            <strong>{money(transaction.debt_balance)}</strong>
                                            <span>Debt #{transaction.debt_id}</span>
                                            <small>{transaction.debt_status}</small>
                                          </>
                                        ) : (
                                          <span>No debt record</span>
                                        )}
                                      </td>
                                      <td data-label="Assessment">
                                        <span className={`cmr-status cmr-status-${transaction.review_status}`}>
                                          {statusText(transaction.review_status)}
                                        </span>
                                      </td>
                                      <td data-label="Return receipt to">
                                        <select
                                          value={assignments[merge.activity_id]?.[transaction.sale_id] || ""}
                                          onChange={(event) =>
                                            setAssignment(
                                              merge.activity_id,
                                              transaction.sale_id,
                                              event.target.value
                                            )
                                          }
                                        >
                                          <option value="">Keep with current target</option>
                                          {merge.source_customers.map((source) => (
                                            <option key={source.id} value={source.id}>
                                              {sourceLabel(source)}
                                            </option>
                                          ))}
                                        </select>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            <div className="cmr-confirm-grid">
                              <label>
                                Correction reason
                                <textarea
                                  rows="3"
                                  value={reason[merge.activity_id] || ""}
                                  onChange={(event) =>
                                    setReason((current) => ({
                                      ...current,
                                      [merge.activity_id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Example: Receipts saved under Master Mickey belonged to the deleted customer profile."
                                />
                              </label>
                              <label>
                                Type UNDO MERGE
                                <input
                                  value={confirmation[merge.activity_id] || ""}
                                  onChange={(event) =>
                                    setConfirmation((current) => ({
                                      ...current,
                                      [merge.activity_id]: event.target.value,
                                    }))
                                  }
                                  placeholder="UNDO MERGE"
                                />
                              </label>
                              <button
                                type="button"
                                className="cmr-reverse"
                                disabled={
                                  submitting === merge.activity_id ||
                                  Number(selectedCounts[merge.activity_id] || 0) === 0 ||
                                  String(confirmation[merge.activity_id] || "").trim().toUpperCase() !== "UNDO MERGE" ||
                                  String(reason[merge.activity_id] || "").trim().length < 10
                                }
                                onClick={() => reverseSelected(merge)}
                              >
                                {submitting === merge.activity_id
                                  ? "Restoring safely…"
                                  : `Restore ${selectedCounts[merge.activity_id] || 0} selected receipt${Number(selectedCounts[merge.activity_id] || 0) === 1 ? "" : "s"}`}
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    ))
                  )}
                </div>
              ) : (
                <div className="cmr-integrity-grid">
                  <section>
                    <h3>Mixed customer identities under one debt account</h3>
                    <p>These accounts contain more than one preserved sale name or phone.</p>
                    {(integrity.mixed_identity_accounts || []).length === 0 ? (
                      <div className="cmr-empty">No mixed-identity debt account was detected.</div>
                    ) : (
                      integrity.mixed_identity_accounts.map((account) => (
                        <article className="cmr-integrity-card" key={account.customer_id}>
                          <div>
                            <strong>#{account.customer_id} · {account.current_customer_name}</strong>
                            <span>{account.debt_count} debts · {money(account.outstanding_balance)} outstanding</span>
                          </div>
                          <div className="cmr-identity-list">
                            {account.preserved_sale_identities.map((identity, index) => (
                              <span key={`${account.customer_id}-${index}`}>
                                {identity.name || "No name"} · {identity.phone || "No phone"}
                              </span>
                            ))}
                          </div>
                        </article>
                      ))
                    )}
                  </section>

                  <section>
                    <h3>Sale/debt consistency flags</h3>
                    <p>These require review; they are not automatically overwritten.</p>
                    {(integrity.anomalies || []).length === 0 ? (
                      <div className="cmr-empty">Sale and debt money fields are internally consistent.</div>
                    ) : (
                      integrity.anomalies.map((item) => (
                        <article className="cmr-integrity-card" key={item.debt_id}>
                          <div>
                            <strong>{item.receipt_number || `Debt #${item.debt_id}`}</strong>
                            <span>{item.current_customer_name || "Unknown customer"}</span>
                          </div>
                          <div className="cmr-money-row">
                            <span>Sale {money(item.sale_total)}</span>
                            <span>Debt owed {money(item.amount_owed)}</span>
                            <span>Sale balance {money(item.sale_balance)}</span>
                            <span>Debt balance {money(item.debt_balance)}</span>
                          </div>
                          <div className="cmr-reason-list">
                            {item.reasons.map((itemReason) => (
                              <span key={itemReason}>{itemReason.replaceAll("_", " ")}</span>
                            ))}
                          </div>
                        </article>
                      ))
                    )}
                  </section>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
