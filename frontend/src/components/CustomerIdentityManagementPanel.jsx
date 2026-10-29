import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/customerIdentityManagement.css";

const PAGE_SIZE = 50;

function formatMoney(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "No activity yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

function canMergeCustomers(role) {
  return ["admin", "manager"].includes(String(role || "").toLowerCase());
}

function matchesCustomer(customer, search) {
  const term = String(search || "").trim().toLowerCase();
  if (!term) return true;

  return [
    customer.customer_id,
    customer.customer_name,
    customer.customer_phone,
    customer.customer_location,
  ]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => String(value).toLowerCase().includes(term));
}

function confidenceLabel(value) {
  if (value === "very_likely") return "Very likely";
  if (value === "likely") return "Likely";
  return "Needs review";
}

function MergeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7h8M8 17h8" />
      <path d="m13 4 3 3-3 3M11 14l-3 3 3 3" />
      <circle cx="5" cy="7" r="2" />
      <circle cx="19" cy="17" r="2" />
    </svg>
  );
}

function CustomerCard({ customer }) {
  return (
    <div className="cim-customer-badge">
      <strong>
        #{customer.customer_id} · {customer.customer_name || "Unnamed customer"}
      </strong>
      <span>{customer.customer_phone || "No phone"}</span>
      <span>{customer.customer_location || "No location"}</span>
    </div>
  );
}

function Metric({ label, value, note }) {
  return (
    <article className="cim-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export default function CustomerIdentityManagementPanel({ onMerged }) {
  const { user, branchId, branchCode, branchName } = useAuth();
  const allowedToMerge = canMergeCustomers(user?.role);

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("suggestions");
  const [customers, setCustomers] = useState([]);
  const [directorySummary, setDirectorySummary] = useState({});
  const [suggestions, setSuggestions] = useState({ groups: [], summary: {} });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [masterId, setMasterId] = useState("");
  const [sourceIds, setSourceIds] = useState([]);
  const [masterProfile, setMasterProfile] = useState({
    name: "",
    phone: "",
    location: "",
  });
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!workspaceOpen) return undefined;

    let cancelled = false;

    async function loadIdentityCentre() {
      setLoading(true);
      setError("");

      try {
        const [directoryResponse, suggestionResponse] = await Promise.all([
          axiosClient.get("/debt-customers/directory", {
            params: { limit: 5000 },
          }),
          axiosClient.get("/debt-customers/duplicate-suggestions", {
            params: { minimum_score: 58, limit: 150 },
          }),
        ]);

        if (cancelled) return;
        setCustomers(directoryResponse.data.customers || []);
        setDirectorySummary(directoryResponse.data.summary || {});
        setSuggestions(suggestionResponse.data || { groups: [], summary: {} });
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError.response?.data?.message ||
              "Could not load the customer merge tool."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadIdentityCentre();
    return () => {
      cancelled = true;
    };
  }, [branchId, refreshKey, workspaceOpen]);

  useEffect(() => {
    if (!workspaceOpen && !modalOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event) => {
      if (event.key !== "Escape" || merging) return;
      if (modalOpen) {
        setModalOpen(false);
      } else {
        setWorkspaceOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [modalOpen, merging, workspaceOpen]);

  const filteredCustomers = useMemo(
    () => customers.filter((customer) => matchesCustomer(customer, search)),
    [customers, search]
  );
  const pageCount = Math.max(1, Math.ceil(filteredCustomers.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleCustomers = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredCustomers.slice(start, start + PAGE_SIZE);
  }, [filteredCustomers, safePage]);
  const master =
    customers.find((customer) => String(customer.customer_id) === masterId) || null;
  const duplicates = sourceIds
    .map((id) =>
      customers.find((customer) => String(customer.customer_id) === id)
    )
    .filter(Boolean);

  const suggestionSummary = suggestions.summary || {};
  const previewReferences = preview?.impact?.references || [];
  const duplicateGroupCount = Number(
    suggestionSummary.possible_duplicate_groups || 0
  );
  const selectionReady = Boolean(masterId && sourceIds.length > 0);

  function resetSelection() {
    setMasterId("");
    setSourceIds([]);
    setMasterProfile({ name: "", phone: "", location: "" });
    setReason("");
    setConfirmation("");
    setPreview(null);
  }

  function openWorkspace() {
    setError("");
    setWorkspaceOpen(true);
  }

  function closeWorkspace() {
    if (merging) return;
    setWorkspaceOpen(false);
    setModalOpen(false);
    setError("");
    setSearch("");
    setPage(1);
    setActiveTab("suggestions");
    resetSelection();
  }

  function chooseMaster(customer) {
    const id = String(customer.customer_id);
    setMasterId(id);
    setSourceIds((current) => current.filter((sourceId) => sourceId !== id));
    setMasterProfile({
      name: customer.customer_name || "",
      phone: customer.customer_phone || "",
      location: customer.customer_location || "",
    });
    setPreview(null);
  }

  function toggleDuplicate(customer) {
    const id = String(customer.customer_id);
    if (id === masterId) return;

    setSourceIds((current) => {
      if (current.includes(id)) {
        return current.filter((sourceId) => sourceId !== id);
      }
      if (current.length >= 25) {
        setError("Merge no more than 25 duplicate customer profiles at a time.");
        return current;
      }
      return [...current, id];
    });
    setPreview(null);
  }

  function applySuggestion(group) {
    const recommendedId = String(group.recommended_master_id);
    const selectedMaster = group.customers.find(
      (customer) => String(customer.customer_id) === recommendedId
    );

    setMasterId(recommendedId);
    setSourceIds(
      group.customers
        .map((customer) => String(customer.customer_id))
        .filter((id) => id !== recommendedId)
        .slice(0, 25)
    );
    setMasterProfile({
      name: selectedMaster?.customer_name || "",
      phone: selectedMaster?.customer_phone || "",
      location: selectedMaster?.customer_location || "",
    });
    setReason(
      "Consolidating duplicate customer identities identified during customer data cleanup."
    );
    setConfirmation("");
    setPreview(null);
    setActiveTab("directory");
    setSearch("");
    setPage(1);
  }

  async function openPreview() {
    if (!selectionReady) {
      setError("Choose one master customer and at least one duplicate customer.");
      return;
    }

    setPreviewing(true);
    setError("");

    try {
      const response = await axiosClient.post("/debt-customers/merge-preview", {
        target_customer_id: Number(masterId),
        source_customer_ids: sourceIds.map(Number),
      });
      setPreview(response.data);
      setModalOpen(true);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not prepare the merge preview."
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function mergeCustomers() {
    setMerging(true);
    setError("");

    try {
      const response = await axiosClient.post("/debt-customers/merge", {
        target_customer_id: Number(masterId),
        source_customer_ids: sourceIds.map(Number),
        master_profile: masterProfile,
        reason: reason.trim(),
        confirmation: confirmation.trim(),
      });

      setModalOpen(false);
      resetSelection();
      setMessage(
        response.data.message || "Customer records were merged successfully."
      );
      setRefreshKey((current) => current + 1);
      setWorkspaceOpen(false);
      onMerged?.(response.data.result);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not merge the selected customer records."
      );
    } finally {
      setMerging(false);
    }
  }

  return (
    <section className="cim-shell" aria-labelledby="customer-merge-launcher-title">
      <div className="cim-launcher">
        <div className="cim-launcher-icon">
          <MergeIcon />
        </div>
        <div className="cim-launcher-copy">
          <span className="cim-eyebrow">Optional customer tool</span>
          <h2 id="customer-merge-launcher-title">Merge duplicate customers</h2>
          <p>
            Open only when you need to combine duplicate customer profiles. Your normal
            statement work stays clear and unchanged.
          </p>
        </div>
        <div className="cim-launcher-actions">
          {message ? (
            <span className="cim-launcher-status is-success">✓ Merge completed</span>
          ) : duplicateGroupCount > 0 ? (
            <span className="cim-launcher-status">
              {duplicateGroupCount} possible duplicate
              {duplicateGroupCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="cim-launcher-status">Safe, on-demand tool</span>
          )}
          <button
            type="button"
            className="cim-button cim-button-primary cim-launcher-button"
            onClick={openWorkspace}
          >
            Open merge tool
          </button>
        </div>
      </div>

      {message && !workspaceOpen && (
        <div className="cim-inline-success" role="status">
          <span>✓</span>
          <p>{message}</p>
          <button type="button" onClick={() => setMessage("")}>
            Dismiss
          </button>
        </div>
      )}

      {workspaceOpen && (
        <div
          className="cim-workspace-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeWorkspace();
          }}
        >
          <section
            className="cim-workspace"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-identity-title"
          >
            <header className="cim-workspace-header">
              <div className="cim-workspace-title">
                <span className="cim-workspace-icon">
                  <MergeIcon />
                </span>
                <div>
                  <span className="cim-eyebrow">Customer cleanup workspace</span>
                  <h2 id="customer-identity-title">Customer Identity Centre</h2>
                  <p>
                    {branchCode || "STORE"} · {branchName || "Selected Store"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="cim-workspace-close"
                onClick={closeWorkspace}
                disabled={merging}
                aria-label="Close customer merge tool"
              >
                <span aria-hidden="true">×</span>
                Close
              </button>
            </header>

            <div className="cim-workspace-body">
              {error && <div className="cim-alert cim-alert-error">{error}</div>}
              {message && <div className="cim-alert cim-alert-success">{message}</div>}

              <div className="cim-stepbar" aria-label="Customer merge steps">
                <div className="cim-step is-active">
                  <span>1</span>
                  <div>
                    <strong>Find duplicates</strong>
                    <small>Use suggestions or search manually.</small>
                  </div>
                </div>
                <div className={`cim-step ${selectionReady ? "is-active" : ""}`}>
                  <span>2</span>
                  <div>
                    <strong>Review and merge</strong>
                    <small>Confirm the master profile before saving.</small>
                  </div>
                </div>
              </div>

              <div className="cim-metrics">
                <Metric
                  label="Customer profiles"
                  value={Number(directorySummary.database_customer_count || 0)}
                  note="Every customer in this store"
                />
                <Metric
                  label="Possible duplicates"
                  value={duplicateGroupCount}
                  note="Suggestions requiring your review"
                />
                <Metric
                  label="Selected now"
                  value={sourceIds.length + (masterId ? 1 : 0)}
                  note={selectionReady ? "Ready for final review" : "Choose a master and duplicate"}
                />
              </div>

              <div className="cim-toolbar">
                <div
                  className="cim-tabs"
                  role="tablist"
                  aria-label="Customer identity views"
                >
                  <button
                    type="button"
                    className={activeTab === "suggestions" ? "is-active" : ""}
                    onClick={() => setActiveTab("suggestions")}
                  >
                    Duplicate suggestions
                  </button>
                  <button
                    type="button"
                    className={activeTab === "directory" ? "is-active" : ""}
                    onClick={() => setActiveTab("directory")}
                  >
                    Find customers manually
                  </button>
                </div>
                <button
                  type="button"
                  className="cim-button cim-button-secondary"
                  disabled={loading}
                  onClick={() => setRefreshKey((current) => current + 1)}
                >
                  {loading ? "Checking customers…" : "Refresh suggestions"}
                </button>
              </div>

              {loading ? (
                <div className="cim-loading">Checking customer records…</div>
              ) : activeTab === "suggestions" ? (
                <div className="cim-suggestions">
                  <div className="cim-simple-note">
                    <strong>Suggested matches</strong>
                    <span>
                      Review each suggestion carefully. Nothing is merged automatically.
                    </span>
                  </div>

                  {(suggestions.groups || []).length === 0 ? (
                    <div className="cim-empty">
                      <span>✓</span>
                      <h3>No strong duplicate suggestion was found</h3>
                      <p>
                        Use “Find customers manually” when you already know which records
                        are duplicates.
                      </p>
                    </div>
                  ) : (
                    <div className="cim-suggestion-grid">
                      {suggestions.groups.map((group) => (
                        <article className="cim-suggestion-card" key={group.group_id}>
                          <div className="cim-suggestion-heading">
                            <div>
                              <span
                                className={`cim-confidence cim-confidence-${group.confidence}`}
                              >
                                {confidenceLabel(group.confidence)}
                              </span>
                              <strong>{group.highest_score}% match confidence</strong>
                            </div>
                            {allowedToMerge && (
                              <button
                                type="button"
                                className="cim-button cim-button-primary"
                                onClick={() => applySuggestion(group)}
                              >
                                Review this match
                              </button>
                            )}
                          </div>

                          <div className="cim-suggestion-customers">
                            {group.customers.map((customer) => (
                              <CustomerCard
                                key={customer.customer_id}
                                customer={customer}
                              />
                            ))}
                          </div>

                          <div className="cim-reasons">
                            {[
                              ...new Set(
                                group.matches.flatMap((match) => match.reasons || [])
                              ),
                            ]
                              .slice(0, 4)
                              .map((item) => (
                                <span key={item}>✓ {item}</span>
                              ))}
                            {[
                              ...new Set(
                                group.matches.flatMap((match) => match.warnings || [])
                              ),
                            ]
                              .slice(0, 1)
                              .map((item) => (
                                <span className="is-warning" key={item}>
                                  Review: {item}
                                </span>
                              ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="cim-directory-layout">
                  <div className="cim-directory-panel">
                    <div className="cim-directory-heading">
                      <div>
                        <h3>Complete customer directory</h3>
                        <p>
                          Select one profile to keep and one or more duplicates to merge.
                        </p>
                      </div>
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setPage(1);
                        }}
                        placeholder="Search name, phone, location or ID"
                        aria-label="Search customer directory"
                      />
                    </div>

                    <div className="cim-table-wrap">
                      <table className="cim-table">
                        <thead>
                          <tr>
                            <th>Keep</th>
                            <th>Merge</th>
                            <th>Customer</th>
                            <th>History</th>
                            <th>Balance</th>
                            <th>Last activity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleCustomers.map((customer) => {
                            const id = String(customer.customer_id);
                            const isMaster = id === masterId;
                            const isDuplicate = sourceIds.includes(id);

                            return (
                              <tr
                                key={customer.customer_id}
                                className={
                                  isMaster ? "is-master" : isDuplicate ? "is-source" : ""
                                }
                              >
                                <td data-label="Keep">
                                  <input
                                    type="radio"
                                    name="customer-master"
                                    checked={isMaster}
                                    disabled={!allowedToMerge}
                                    onChange={() => chooseMaster(customer)}
                                    aria-label={`Keep ${customer.customer_name} as master`}
                                  />
                                </td>
                                <td data-label="Merge">
                                  <input
                                    type="checkbox"
                                    checked={isDuplicate}
                                    disabled={!allowedToMerge || isMaster}
                                    onChange={() => toggleDuplicate(customer)}
                                    aria-label={`Merge ${customer.customer_name} as duplicate`}
                                  />
                                </td>
                                <td data-label="Customer">
                                  <strong>
                                    #{customer.customer_id} · {customer.customer_name}
                                  </strong>
                                  <span>{customer.customer_phone || "No phone"}</span>
                                  <small>
                                    {customer.customer_location || "No location"}
                                  </small>
                                </td>
                                <td data-label="History">
                                  <strong>{customer.transaction_count} record(s)</strong>
                                  <span>
                                    {customer.sale_count} sales · {customer.debt_count} debts
                                  </span>
                                  <small>
                                    {formatMoney(customer.total_sales_value)} sales
                                  </small>
                                </td>
                                <td data-label="Balance">
                                  <strong>
                                    {formatMoney(customer.outstanding_balance)}
                                  </strong>
                                  <span>
                                    {customer.active_debt_count} active debt(s)
                                  </span>
                                </td>
                                <td data-label="Last activity">
                                  {formatDate(customer.last_activity_at)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="cim-directory-pagination">
                      <span>
                        Showing{" "}
                        {filteredCustomers.length === 0
                          ? 0
                          : (safePage - 1) * PAGE_SIZE + 1}
                        –{Math.min(filteredCustomers.length, safePage * PAGE_SIZE)} of{" "}
                        {filteredCustomers.length}
                      </span>
                      <div>
                        <button
                          type="button"
                          className="cim-button cim-button-secondary"
                          disabled={safePage <= 1}
                          onClick={() =>
                            setPage((current) => Math.max(1, current - 1))
                          }
                        >
                          Previous
                        </button>
                        <strong>
                          Page {safePage} of {pageCount}
                        </strong>
                        <button
                          type="button"
                          className="cim-button cim-button-secondary"
                          disabled={safePage >= pageCount}
                          onClick={() =>
                            setPage((current) => Math.min(pageCount, current + 1))
                          }
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>

                  <aside className="cim-selection-panel">
                    <span className="cim-eyebrow">Step 2</span>
                    <h3>Review your selection</h3>

                    {!allowedToMerge && (
                      <div className="cim-alert cim-alert-info">
                        Only an administrator or manager can merge customers.
                      </div>
                    )}

                    <div className="cim-selection-group">
                      <label>Customer profile to keep</label>
                      {master ? (
                        <CustomerCard customer={master} />
                      ) : (
                        <p className="cim-muted">Select “Keep” beside one customer.</p>
                      )}
                    </div>

                    <div className="cim-selection-group">
                      <label>Duplicate profile(s) to merge</label>
                      {duplicates.length > 0 ? (
                        duplicates.map((customer) => (
                          <CustomerCard
                            key={customer.customer_id}
                            customer={customer}
                          />
                        ))
                      ) : (
                        <p className="cim-muted">
                          Select “Merge” beside at least one duplicate.
                        </p>
                      )}
                    </div>

                    {master && (
                      <div className="cim-profile-fields">
                        {[
                          ["name", "Final customer name"],
                          ["phone", "Final phone number"],
                          ["location", "Final location"],
                        ].map(([field, label]) => (
                          <label key={field}>
                            {label}
                            <input
                              value={masterProfile[field]}
                              disabled={!allowedToMerge}
                              onChange={(event) =>
                                setMasterProfile((current) => ({
                                  ...current,
                                  [field]: event.target.value,
                                }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    )}

                    <div className="cim-selection-actions">
                      <button
                        type="button"
                        className="cim-button cim-button-primary"
                        disabled={!allowedToMerge || !selectionReady || previewing}
                        onClick={openPreview}
                      >
                        {previewing ? "Preparing review…" : "Review before merging"}
                      </button>
                      <button
                        type="button"
                        className="cim-button cim-button-ghost"
                        onClick={resetSelection}
                        disabled={!masterId && sourceIds.length === 0}
                      >
                        Clear selection
                      </button>
                    </div>
                  </aside>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {modalOpen && (
        <div className="cim-modal-backdrop" role="presentation">
          <section
            className="cim-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cim-merge-title"
          >
            <header>
              <div>
                <span className="cim-eyebrow">Final safety review</span>
                <h3 id="cim-merge-title">Merge customer identities</h3>
              </div>
              <button
                type="button"
                className="cim-modal-close"
                disabled={merging}
                onClick={() => setModalOpen(false)}
                aria-label="Close merge preview"
              >
                ×
              </button>
            </header>

            <div className="cim-modal-content">
              <div className="cim-merge-direction">
                <div>
                  <span>Keep this profile</span>
                  {master && <CustomerCard customer={master} />}
                </div>
                <strong>Receives all linked records</strong>
                <div>
                  <span>Merge and remove duplicate profile(s)</span>
                  {duplicates.map((customer) => (
                    <CustomerCard key={customer.customer_id} customer={customer} />
                  ))}
                </div>
              </div>

              <div className="cim-preview-grid">
                <div>
                  <h4>Records that will be relinked</h4>
                  <div className="cim-impact-list">
                    {previewReferences.map((row) => (
                      <div key={`${row.table}-${row.column}`}>
                        <span>
                          {row.table}.{row.column}
                        </span>
                        <strong>{Number(row.affected_rows || 0)} record(s)</strong>
                      </div>
                    ))}
                  </div>
                  <p className="cim-preview-total">
                    Total linked rows: {Number(preview?.impact?.total_references || 0)}
                  </p>
                </div>
                <div>
                  <h4>Protection applied</h4>
                  <ul>
                    {(preview?.safeguards || []).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="cim-profile-preview">
                <h4>Final customer profile</h4>
                <div>
                  <span>Name</span>
                  <strong>{masterProfile.name || "-"}</strong>
                </div>
                <div>
                  <span>Phone</span>
                  <strong>{masterProfile.phone || "-"}</strong>
                </div>
                <div>
                  <span>Location</span>
                  <strong>{masterProfile.location || "-"}</strong>
                </div>
              </div>

              <label className="cim-modal-field">
                Reason for merge
                <textarea
                  rows="3"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain why these records belong to the same customer."
                />
              </label>

              <label className="cim-modal-field">
                Type MERGE to confirm
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="MERGE"
                  autoComplete="off"
                />
              </label>

              <div className="cim-warning-box">
                The duplicate profiles are removed only after every linked record is
                reassigned. Any failure cancels the complete operation.
              </div>
            </div>

            <footer>
              <button
                type="button"
                className="cim-button cim-button-secondary"
                disabled={merging}
                onClick={() => setModalOpen(false)}
              >
                Go back
              </button>
              <button
                type="button"
                className="cim-button cim-button-danger"
                disabled={
                  merging ||
                  reason.trim().length < 5 ||
                  confirmation.trim().toUpperCase() !== "MERGE"
                }
                onClick={mergeCustomers}
              >
                {merging ? "Merging safely…" : "Confirm customer merge"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
