import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import "../styles/customerIdentityManagement.css";

const DIRECTORY_PAGE_SIZE = 50;

function formatMoney(value) {
  return `GHS ${Number(value || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB");
}

function roleCanMerge(role) {
  return ["admin", "manager"].includes(String(role || "").toLowerCase());
}

function customerMatches(customer, query) {
  const term = String(query || "").trim().toLowerCase();
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

function CustomerBadge({ customer }) {
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

function ImpactList({ preview }) {
  const references = preview?.impact?.references || [];

  if (references.length === 0) {
    return <p className="cim-muted">No linked transaction rows were found.</p>;
  }

  return (
    <div className="cim-impact-list">
      {references.map((row) => (
        <div key={`${row.table}-${row.column}`}>
          <span>
            {row.table}.{row.column}
          </span>
          <strong>{Number(row.affected_rows || 0)} record(s)</strong>
        </div>
      ))}
    </div>
  );
}

export default function CustomerIdentityManagementPanel({ onMerged }) {
  const { user, branchId, branchCode, branchName } = useAuth();
  const canMerge = roleCanMerge(user?.role);

  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState("suggestions");
  const [customers, setCustomers] = useState([]);
  const [directorySummary, setDirectorySummary] = useState(null);
  const [suggestionData, setSuggestionData] = useState(null);
  const [search, setSearch] = useState("");
  const [directoryPage, setDirectoryPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
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
  const [mergeModalOpen, setMergeModalOpen] = useState(false);

  async function loadDirectory() {
    const response = await axiosClient.get("/debt-customers/directory", {
      params: { limit: 5000 },
    });
    setCustomers(response.data.customers || []);
    setDirectorySummary(response.data.summary || null);
    return response.data;
  }

  async function scanDuplicates() {
    setScanning(true);
    setError("");
    try {
      const response = await axiosClient.get(
        "/debt-customers/duplicate-suggestions",
        {
          params: { minimum_score: 58, limit: 150 },
        }
      );
      setSuggestionData(response.data);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not scan customers for possible duplicates."
      );
    } finally {
      setScanning(false);
    }
  }

  async function refreshAll({ keepMessage = false } = {}) {
    setLoading(true);
    setError("");
    if (!keepMessage) setMessage("");

    try {
      await Promise.all([loadDirectory(), scanDuplicates()]);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not load the customer identity centre."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
  }, [branchId]);

  useEffect(() => {
    if (!mergeModalOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event) {
      if (event.key === "Escape" && !merging) setMergeModalOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mergeModalOpen, merging]);

  const filteredCustomers = useMemo(
    () => customers.filter((customer) => customerMatches(customer, search)),
    [customers, search]
  );

  const directoryPageCount = Math.max(
    1,
    Math.ceil(filteredCustomers.length / DIRECTORY_PAGE_SIZE)
  );

  const visibleCustomers = useMemo(() => {
    const safePage = Math.min(directoryPage, directoryPageCount);
    const start = (safePage - 1) * DIRECTORY_PAGE_SIZE;
    return filteredCustomers.slice(start, start + DIRECTORY_PAGE_SIZE);
  }, [directoryPage, directoryPageCount, filteredCustomers]);

  useEffect(() => {
    setDirectoryPage(1);
  }, [search, branchId]);

  const selectedMaster = useMemo(
    () =>
      customers.find(
        (customer) => String(customer.customer_id) === String(masterId)
      ) || null,
    [customers, masterId]
  );

  const selectedSources = useMemo(
    () =>
      sourceIds
        .map((id) =>
          customers.find(
            (customer) => String(customer.customer_id) === String(id)
          )
        )
        .filter(Boolean),
    [customers, sourceIds]
  );

  useEffect(() => {
    if (!selectedMaster) {
      setMasterProfile({ name: "", phone: "", location: "" });
      return;
    }

    const sourcePhone = selectedSources.find((customer) => customer.customer_phone)
      ?.customer_phone;
    const sourceLocation = selectedSources.find(
      (customer) => customer.customer_location
    )?.customer_location;

    setMasterProfile({
      name: selectedMaster.customer_name || "",
      phone: selectedMaster.customer_phone || sourcePhone || "",
      location: selectedMaster.customer_location || sourceLocation || "",
    });
  }, [selectedMaster, selectedSources]);

  function resetMergeSelection() {
    setMasterId("");
    setSourceIds([]);
    setMasterProfile({ name: "", phone: "", location: "" });
    setReason("");
    setConfirmation("");
    setPreview(null);
  }

  function toggleSource(customerId) {
    const id = String(customerId);
    if (id === String(masterId)) return;

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

  function chooseMaster(customerId) {
    const id = String(customerId);
    setMasterId(id);
    setSourceIds((current) => current.filter((sourceId) => sourceId !== id));
    setPreview(null);
  }

  function useSuggestion(group) {
    const recommendedId = String(group.recommended_master_id);
    setMasterId(recommendedId);
    const duplicateIds = group.customers
      .map((customer) => String(customer.customer_id))
      .filter((id) => id !== recommendedId);
    setSourceIds(duplicateIds.slice(0, 25));
    if (duplicateIds.length > 25) {
      setError(
        "This suggestion group contains more than 25 duplicate profiles. Review and merge it in smaller controlled batches."
      );
    }
    setReason("Consolidating duplicate customer identities identified during customer data cleanup.");
    setConfirmation("");
    setPreview(null);
    setActiveTab("directory");
    setSearch("");
    setDirectoryPage(1);
    window.setTimeout(() => {
      document
        .querySelector(".cim-selection-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  async function prepareMerge() {
    if (!masterId || sourceIds.length === 0) {
      setError("Choose one master customer and at least one duplicate customer.");
      return;
    }

    setPreviewing(true);
    setError("");
    setMessage("");

    try {
      const response = await axiosClient.post("/debt-customers/merge-preview", {
        target_customer_id: Number(masterId),
        source_customer_ids: sourceIds.map(Number),
      });
      setPreview(response.data);
      setMergeModalOpen(true);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not prepare the customer merge preview."
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmMerge() {
    if (reason.trim().length < 5) {
      setError("Enter a clear reason for this merge.");
      return;
    }
    if (confirmation.trim().toUpperCase() !== "MERGE") {
      setError("Type MERGE exactly to confirm the consolidation.");
      return;
    }

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

      setMergeModalOpen(false);
      resetMergeSelection();
      setMessage(response.data.message || "Customer records were merged successfully.");
      await refreshAll({ keepMessage: true });
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

  const duplicateSummary = suggestionData?.summary || {};

  return (
    <section className="cim-shell" aria-labelledby="customer-identity-title">
      <header className="cim-header">
        <div>
          <span className="cim-eyebrow">Customer data quality</span>
          <h2 id="customer-identity-title">Customer Identity Centre</h2>
          <p>
            Keep one reliable profile per customer across statements, sales, receipts,
            debts, payments and linked records.
          </p>
        </div>
        <div className="cim-header-actions">
          <span className="cim-store-pill">
            {branchCode || "STORE"} · {branchName || "Selected Store"}
          </span>
          <button
            type="button"
            className="cim-button cim-button-secondary"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Hide centre" : "Open centre"}
          </button>
        </div>
      </header>

      {expanded && (
        <div className="cim-body">
          {error && <div className="cim-alert cim-alert-error">{error}</div>}
          {message && <div className="cim-alert cim-alert-success">{message}</div>}

          <div className="cim-metrics">
            <Metric
              label="All customer profiles"
              value={Number(directorySummary?.database_customer_count || 0)}
              note="Includes customers with and without debt"
            />
            <Metric
              label="Possible duplicate groups"
              value={Number(duplicateSummary.possible_duplicate_groups || 0)}
              note="Algorithm suggestions requiring human review"
            />
            <Metric
              label="Customers with sales"
              value={Number(directorySummary?.customers_with_sales || 0)}
              note="Profiles linked to sale history"
            />
            <Metric
              label="Profiles without activity"
              value={Number(directorySummary?.customers_without_activity || 0)}
              note="Useful for cleanup and verification"
            />
          </div>

          <div className="cim-toolbar">
            <div className="cim-tabs" role="tablist" aria-label="Customer identity views">
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
                Complete customer directory
              </button>
            </div>
            <button
              type="button"
              className="cim-button cim-button-secondary"
              onClick={() => refreshAll()}
              disabled={loading || scanning}
            >
              {loading || scanning ? "Checking customers…" : "Run fresh duplicate scan"}
            </button>
          </div>

          {loading ? (
            <div className="cim-loading">Loading customer identities…</div>
          ) : activeTab === "suggestions" ? (
            <div className="cim-suggestions">
              <div className="cim-explainer">
                <strong>How suggestions are produced</strong>
                <p>
                  The scan compares Ghana-normalized phone numbers, exact and reordered
                  names, spelling closeness, phonetic similarity, shared name words and
                  location similarity. Different valid phone numbers reduce confidence.
                  A suggestion is never merged automatically.
                </p>
              </div>

              {(suggestionData?.groups || []).length === 0 ? (
                <div className="cim-empty">
                  <span>✓</span>
                  <h3>No strong duplicate suggestion was found</h3>
                  <p>
                    You can still use the complete directory to select and merge known
                    duplicates manually.
                  </p>
                </div>
              ) : (
                <div className="cim-suggestion-grid">
                  {suggestionData.groups.map((group) => (
                    <article className="cim-suggestion-card" key={group.group_id}>
                      <div className="cim-suggestion-heading">
                        <div>
                          <span
                            className={`cim-confidence cim-confidence-${group.confidence}`}
                          >
                            {confidenceLabel(group.confidence)}
                          </span>
                          <strong>{group.highest_score}% confidence signal</strong>
                        </div>
                        {canMerge && (
                          <button
                            type="button"
                            className="cim-button cim-button-primary"
                            onClick={() => useSuggestion(group)}
                          >
                            Review and merge
                          </button>
                        )}
                      </div>

                      <div className="cim-suggestion-customers">
                        {group.customers.map((customer) => (
                          <CustomerBadge
                            key={customer.customer_id}
                            customer={customer}
                          />
                        ))}
                      </div>

                      <div className="cim-reasons">
                        {[...new Set(group.matches.flatMap((match) => match.reasons || []))]
                          .slice(0, 5)
                          .map((reasonText) => (
                            <span key={reasonText}>✓ {reasonText}</span>
                          ))}
                        {[...new Set(group.matches.flatMap((match) => match.warnings || []))]
                          .slice(0, 2)
                          .map((warning) => (
                            <span className="is-warning" key={warning}>
                              Review: {warning}
                            </span>
                          ))}
                      </div>

                      <small>
                        Recommended master: customer #{group.recommended_master_id}. The
                        recommendation favours the most complete and most-used profile.
                      </small>
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
                    <h3>All customers in this store</h3>
                    <p>
                      Customers without debt are included, so old duplicate profiles can
                      now be consolidated.
                    </p>
                  </div>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, phone, location or ID"
                    aria-label="Search customer directory"
                  />
                </div>

                <div className="cim-table-wrap">
                  <table className="cim-table">
                    <thead>
                      <tr>
                        <th>Master</th>
                        <th>Duplicate</th>
                        <th>Customer</th>
                        <th>Activity</th>
                        <th>Debt balance</th>
                        <th>Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCustomers.map((customer) => {
                        const id = String(customer.customer_id);
                        const isMaster = id === String(masterId);
                        const isSource = sourceIds.includes(id);

                        return (
                          <tr
                            key={customer.customer_id}
                            className={isMaster ? "is-master" : isSource ? "is-source" : ""}
                          >
                            <td data-label="Master">
                              <input
                                type="radio"
                                name="customer-master"
                                checked={isMaster}
                                disabled={!canMerge}
                                onChange={() => chooseMaster(customer.customer_id)}
                                aria-label={`Use ${customer.customer_name} as master`}
                              />
                            </td>
                            <td data-label="Duplicate">
                              <input
                                type="checkbox"
                                checked={isSource}
                                disabled={!canMerge || isMaster}
                                onChange={() => toggleSource(customer.customer_id)}
                                aria-label={`Merge ${customer.customer_name} as duplicate`}
                              />
                            </td>
                            <td data-label="Customer">
                              <strong>
                                #{customer.customer_id} · {customer.customer_name}
                              </strong>
                              <span>{customer.customer_phone || "No phone"}</span>
                              <small>{customer.customer_location || "No location"}</small>
                            </td>
                            <td data-label="Activity">
                              <strong>{customer.transaction_count} record(s)</strong>
                              <span>
                                {customer.sale_count} sales · {customer.debt_count} debts
                              </span>
                              <small>{formatMoney(customer.total_sales_value)} sales</small>
                            </td>
                            <td data-label="Debt balance">
                              <strong>{formatMoney(customer.outstanding_balance)}</strong>
                              <span>{customer.active_debt_count} active debt(s)</span>
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
                    Showing {filteredCustomers.length === 0 ? 0 : (Math.min(directoryPage, directoryPageCount) - 1) * DIRECTORY_PAGE_SIZE + 1}
                    –{Math.min(filteredCustomers.length, Math.min(directoryPage, directoryPageCount) * DIRECTORY_PAGE_SIZE)} of {filteredCustomers.length}
                  </span>
                  <div>
                    <button
                      type="button"
                      className="cim-button cim-button-secondary"
                      disabled={directoryPage <= 1}
                      onClick={() => setDirectoryPage((current) => Math.max(1, current - 1))}
                    >
                      Previous
                    </button>
                    <strong>
                      Page {Math.min(directoryPage, directoryPageCount)} of {directoryPageCount}
                    </strong>
                    <button
                      type="button"
                      className="cim-button cim-button-secondary"
                      disabled={directoryPage >= directoryPageCount}
                      onClick={() =>
                        setDirectoryPage((current) =>
                          Math.min(directoryPageCount, current + 1)
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>

              <aside className="cim-selection-panel">
                <span className="cim-eyebrow">Merge preparation</span>
                <h3>Selected identities</h3>

                {!canMerge && (
                  <div className="cim-alert cim-alert-info">
                    Only an administrator or manager can perform a customer merge.
                  </div>
                )}

                <div className="cim-selection-group">
                  <label>Master customer to keep</label>
                  {selectedMaster ? (
                    <CustomerBadge customer={selectedMaster} />
                  ) : (
                    <p className="cim-muted">Choose one master customer.</p>
                  )}
                </div>

                <div className="cim-selection-group">
                  <label>Duplicate customer(s) to remove</label>
                  {selectedSources.length > 0 ? (
                    selectedSources.map((customer) => (
                      <CustomerBadge key={customer.customer_id} customer={customer} />
                    ))
                  ) : (
                    <p className="cim-muted">Choose at least one duplicate.</p>
                  )}
                </div>

                {selectedMaster && (
                  <div className="cim-profile-fields">
                    <label>
                      Final customer name
                      <input
                        value={masterProfile.name}
                        disabled={!canMerge}
                        onChange={(event) =>
                          setMasterProfile((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Final phone number
                      <input
                        value={masterProfile.phone}
                        disabled={!canMerge}
                        onChange={(event) =>
                          setMasterProfile((current) => ({
                            ...current,
                            phone: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Final location
                      <input
                        value={masterProfile.location}
                        disabled={!canMerge}
                        onChange={(event) =>
                          setMasterProfile((current) => ({
                            ...current,
                            location: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                )}

                <div className="cim-selection-actions">
                  <button
                    type="button"
                    className="cim-button cim-button-primary"
                    disabled={!canMerge || !masterId || sourceIds.length === 0 || previewing}
                    onClick={prepareMerge}
                  >
                    {previewing ? "Preparing preview…" : "Preview safe merge"}
                  </button>
                  <button
                    type="button"
                    className="cim-button cim-button-ghost"
                    disabled={!masterId && sourceIds.length === 0}
                    onClick={resetMergeSelection}
                  >
                    Clear selection
                  </button>
                </div>
              </aside>
            </div>
          )}
        </div>
      )}

      {mergeModalOpen && (
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
                onClick={() => setMergeModalOpen(false)}
                disabled={merging}
                aria-label="Close merge preview"
              >
                ×
              </button>
            </header>

            <div className="cim-modal-content">
              <div className="cim-merge-direction">
                <div>
                  <span>Keep as master</span>
                  {selectedMaster && <CustomerBadge customer={selectedMaster} />}
                </div>
                <strong>← receives all links from ←</strong>
                <div>
                  <span>Remove duplicate profile(s)</span>
                  {selectedSources.map((customer) => (
                    <CustomerBadge key={customer.customer_id} customer={customer} />
                  ))}
                </div>
              </div>

              <div className="cim-preview-grid">
                <div>
                  <h4>Records that will be relinked</h4>
                  <ImpactList preview={preview} />
                  <p className="cim-preview-total">
                    Total linked rows: {Number(preview?.impact?.total_references || 0)}
                  </p>
                </div>
                <div>
                  <h4>Protection applied</h4>
                  <ul>
                    {(preview?.safeguards || []).map((safeguard) => (
                      <li key={safeguard}>{safeguard}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="cim-profile-preview">
                <h4>Final master profile</h4>
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
                  placeholder="Example: Same customer was entered twice before the original profile was selected."
                />
              </label>

              <label className="cim-modal-field">
                Type MERGE to confirm
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  placeholder="MERGE"
                />
              </label>

              <div className="cim-warning-box">
                The duplicate customer rows will be removed after every linked record has
                been reassigned. The process is transactional: any failure cancels the
                entire operation.
              </div>
            </div>

            <footer>
              <button
                type="button"
                className="cim-button cim-button-secondary"
                onClick={() => setMergeModalOpen(false)}
                disabled={merging}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cim-button cim-button-danger"
                onClick={confirmMerge}
                disabled={
                  merging ||
                  reason.trim().length < 5 ||
                  confirmation.trim().toUpperCase() !== "MERGE"
                }
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
