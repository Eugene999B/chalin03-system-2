import { useEffect, useMemo, useState } from "react";

import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";
import DebtReminderSettingsPanel from "./DebtReminderSettingsPanel";
import "../styles/topDebtDeskTools.css";

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return `GHS ${numberValue(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function accountMatches(account, query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return true;
  return [
    account.customer_key,
    account.customer_id,
    account.customer_name,
    account.customer_phone,
    account.customer_location,
  ]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => String(value).toLowerCase().includes(term));
}

function buildTopAccounts(debts = []) {
  const accounts = new Map();

  for (const debt of debts) {
    const customerId = Number(debt.customer_id || 0) || null;
    const customerKey = customerId
      ? `customer-${customerId}`
      : `legacy-${debt.id}`;

    if (!accounts.has(customerKey)) {
      accounts.set(customerKey, {
        customer_key: customerKey,
        customer_id: customerId,
        customer_name:
          debt.customer_name || debt.sale_customer_name || "Unnamed Customer",
        customer_phone:
          debt.customer_phone || debt.sale_customer_phone || null,
        customer_location: debt.customer_location || null,
        receipt_count: 0,
        outstanding_balance: 0,
        total_paid: 0,
        legacy_record: !customerId,
      });
    }

    const account = accounts.get(customerKey);
    account.customer_name =
      debt.customer_name || debt.sale_customer_name || account.customer_name;
    account.customer_phone =
      debt.customer_phone || debt.sale_customer_phone || account.customer_phone;
    account.customer_location =
      debt.customer_location || account.customer_location;
    account.receipt_count += 1;
    account.outstanding_balance += numberValue(debt.balance);
    account.total_paid += numberValue(debt.amount_paid);
  }

  return [...accounts.values()]
    .map((account) => ({
      ...account,
      outstanding_balance: Number(account.outstanding_balance.toFixed(2)),
      total_paid: Number(account.total_paid.toFixed(2)),
    }))
    .sort((left, right) => {
      const nameDifference = String(left.customer_name || "").localeCompare(
        String(right.customer_name || "")
      );
      if (nameDifference !== 0) return nameDifference;
      return String(left.customer_key).localeCompare(String(right.customer_key));
    });
}

function accountTitle(account) {
  return `${account.customer_name} · ${money(account.outstanding_balance)}`;
}

function accountMeta(account) {
  const identity = account.customer_id
    ? `Customer #${account.customer_id}`
    : `Receipt-level account · ${account.customer_key}`;
  return `${identity} · ${account.customer_phone || "No phone"} · ${
    account.receipt_count
  } receipt(s)`;
}

function ToolDialog({ title, subtitle, onClose, children, wide = false }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div className="top-debt-tools__backdrop" role="presentation">
      <section
        className={`top-debt-tools__dialog ${wide ? "is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="top-debt-tools__dialog-header">
          <div>
            <span>Authoritative Debt Desk</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close workspace">
            ×
          </button>
        </header>
        <div className="top-debt-tools__dialog-body">{children}</div>
      </section>
    </div>
  );
}

function MergeWorkspace({ accounts, loading, onReload, onClose, onMerged }) {
  const [masterSearch, setMasterSearch] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [masterKey, setMasterKey] = useState("");
  const [sourceKeys, setSourceKeys] = useState([]);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const masterCandidates = useMemo(
    () =>
      accounts.filter(
        (account) => account.customer_id && accountMatches(account, masterSearch)
      ),
    [accounts, masterSearch]
  );

  const sourceCandidates = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.customer_key !== masterKey &&
          accountMatches(account, sourceSearch)
      ),
    [accounts, masterKey, sourceSearch]
  );

  const selectedMaster = accounts.find(
    (account) => account.customer_key === masterKey
  );
  const selectedSources = accounts.filter((account) =>
    sourceKeys.includes(account.customer_key)
  );

  function toggleSource(key) {
    setSourceKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  }

  async function submitMerge(event) {
    event.preventDefault();
    setError("");

    if (!masterKey) {
      setError("Choose the saved customer account to keep.");
      return;
    }
    if (sourceKeys.length === 0) {
      setError("Select at least one duplicate account.");
      return;
    }
    if (reason.trim().length < 5) {
      setError("Enter a clear merge reason of at least 5 characters.");
      return;
    }
    if (confirmation.trim().toUpperCase() !== "MERGE") {
      setError("Type MERGE to confirm this identity consolidation.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await axiosClient.post("/debt-customers/merge-accounts", {
        target_customer_key: masterKey,
        source_customer_keys: sourceKeys,
        reason: reason.trim(),
        confirmation: confirmation.trim(),
      });
      await onMerged(response.data);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not merge the selected accounts. No partial merge was saved."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ToolDialog
      title="Merge accounts shown in the top Debt Desk"
      subtitle="The selector below uses the same account list as the working debt screen. Saved and receipt-level accounts can be consolidated without changing money or payment history."
      onClose={onClose}
      wide
    >
      {error ? <div className="top-debt-tools__message is-error">{error}</div> : null}

      <form className="top-debt-merge" onSubmit={submitMerge}>
        <section className="top-debt-merge__column">
          <header>
            <span>Step 1</span>
            <h3>Choose the master customer to keep</h3>
            <p>
              The master must be a saved customer profile. Its name, phone and
              location remain the final identity.
            </p>
          </header>

          <label className="top-debt-merge__search">
            <span>Search master</span>
            <input
              type="search"
              value={masterSearch}
              onChange={(event) => setMasterSearch(event.target.value)}
              placeholder="Name, phone, location or customer ID"
            />
          </label>

          <div className="top-debt-merge__list" role="radiogroup">
            {masterCandidates.map((account) => (
              <label
                key={account.customer_key}
                className={`top-debt-merge__account ${
                  masterKey === account.customer_key ? "is-selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="master-account"
                  checked={masterKey === account.customer_key}
                  onChange={() => {
                    setMasterKey(account.customer_key);
                    setSourceKeys((current) =>
                      current.filter((key) => key !== account.customer_key)
                    );
                  }}
                />
                <strong>{accountTitle(account)}</strong>
                <small>{accountMeta(account)}</small>
              </label>
            ))}
            {!loading && masterCandidates.length === 0 ? (
              <p className="top-debt-merge__empty">No saved customer matches.</p>
            ) : null}
          </div>
        </section>

        <section className="top-debt-merge__column">
          <header>
            <span>Step 2</span>
            <h3>Select duplicate accounts</h3>
            <p>
              Receipt-level accounts are allowed here. Every selected receipt and
              payment remains separate for audit.
            </p>
          </header>

          <label className="top-debt-merge__search">
            <span>Search duplicates</span>
            <input
              type="search"
              value={sourceSearch}
              onChange={(event) => setSourceSearch(event.target.value)}
              placeholder="Name, phone, location or account key"
            />
          </label>

          <div className="top-debt-merge__list">
            {sourceCandidates.map((account) => (
              <label
                key={account.customer_key}
                className={`top-debt-merge__account ${
                  sourceKeys.includes(account.customer_key) ? "is-selected" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={sourceKeys.includes(account.customer_key)}
                  onChange={() => toggleSource(account.customer_key)}
                />
                <strong>{accountTitle(account)}</strong>
                <small>{accountMeta(account)}</small>
              </label>
            ))}
          </div>
        </section>

        <section className="top-debt-merge__confirmation">
          <div>
            <span>Merge preview</span>
            <strong>
              {selectedMaster
                ? `Keep ${selectedMaster.customer_name}`
                : "Choose a master customer"}
            </strong>
            <small>
              {selectedSources.length} duplicate account(s) selected · {" "}
              {selectedSources.reduce(
                (sum, account) => sum + numberValue(account.receipt_count),
                0
              )}{" "}
              receipt(s) · {money(
                selectedSources.reduce(
                  (sum, account) => sum + numberValue(account.outstanding_balance),
                  0
                )
              )}{" "}
              outstanding
            </small>
          </div>

          <label>
            <span>Reason for merge</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Example: Both accounts belong to the same customer and were created separately."
              maxLength={500}
            />
          </label>

          <label>
            <span>Type MERGE to confirm</span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="MERGE"
              autoComplete="off"
            />
          </label>

          <div className="top-debt-merge__safety">
            <strong>Protected during merge</strong>
            <span>Debt amounts</span>
            <span>Paid amounts</span>
            <span>Payment history</span>
            <span>Sales and receipts</span>
            <span>Stock and Daily Closing</span>
          </div>

          <footer>
            <button type="button" onClick={onReload} disabled={loading || submitting}>
              {loading ? "Refreshing accounts…" : "Refresh account list"}
            </button>
            <button type="button" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="is-primary"
              disabled={
                submitting ||
                !masterKey ||
                sourceKeys.length === 0 ||
                reason.trim().length < 5 ||
                confirmation.trim().toUpperCase() !== "MERGE"
              }
            >
              {submitting ? "Merging safely…" : "Merge selected accounts"}
            </button>
          </footer>
        </section>
      </form>
    </ToolDialog>
  );
}

export default function TopDebtDeskTools({ onDataChanged }) {
  const { user, branchCode, branchName } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canManage = ["admin", "manager"].includes(
    String(user?.role || "").toLowerCase()
  );

  async function loadAccounts() {
    setLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/debts");
      setAccounts(buildTopAccounts(response.data.debts || []));
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Could not load the authoritative account list."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (mergeOpen) loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeOpen]);

  async function handleMerged(data) {
    setMessage(data.message || "Customer accounts merged successfully.");
    setError("");
    setMergeOpen(false);
    await onDataChanged?.();
  }

  return (
    <>
      <section className="top-debt-tools">
        <div>
          <span>Single authoritative debt workspace</span>
          <h2>Account controls</h2>
          <p>
            Merge the exact accounts shown below and manage reminder settings
            without opening the retired consolidation dashboard.
          </p>
        </div>
        <div className="top-debt-tools__actions">
          <button
            type="button"
            className="is-primary"
            onClick={() => {
              setMessage("");
              setError("");
              setMergeOpen(true);
            }}
            disabled={!canManage}
          >
            Merge accounts
          </button>
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setError("");
              setSettingsOpen(true);
            }}
          >
            Debt reminder settings
          </button>
        </div>
      </section>

      {message ? <div className="top-debt-tools__message is-success">{message}</div> : null}
      {error ? <div className="top-debt-tools__message is-error">{error}</div> : null}
      {!canManage ? (
        <div className="top-debt-tools__message is-info">
          Only an administrator or manager can merge customer accounts. Debt
          records and payments remain available below.
        </div>
      ) : null}

      {mergeOpen ? (
        <MergeWorkspace
          accounts={accounts}
          loading={loading}
          onReload={loadAccounts}
          onClose={() => setMergeOpen(false)}
          onMerged={handleMerged}
        />
      ) : null}

      {settingsOpen ? (
        <ToolDialog
          title="Debt reminder settings"
          subtitle="Manage automatic SMS, manual reminders, schedules and customer contact protection from the same top Debt Desk."
          onClose={() => setSettingsOpen(false)}
          wide
        >
          <DebtReminderSettingsPanel
            userRole={user?.role}
            currentStoreCode={branchCode || user?.branch_code || "STORE"}
            currentStoreName={branchName || user?.branch_name || "Selected Store"}
          />
        </ToolDialog>
      ) : null}
    </>
  );
}

export { buildTopAccounts, parseAccountKeyForTest };

function parseAccountKeyForTest(value) {
  const match = /^(customer|legacy)-(\d+)$/.exec(String(value || "").trim());
  return match ? { type: match[1], id: Number(match[2]) } : null;
}
