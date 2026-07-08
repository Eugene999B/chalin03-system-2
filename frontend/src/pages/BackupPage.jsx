import { useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

const RESTORE_CONFIRMATION_TEXT = "RESTORE";

export default function BackupPage() {
  const { user, branchCode, branchName, branchLocation } = useAuth();
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

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedBackupInfo, setSelectedBackupInfo] = useState(null);
  const [confirmText, setConfirmText] = useState("");

  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function makeSafeFileName(value) {
    return String(value || "backup")
      .replace(/[^a-z0-9]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function formatFileSize(size) {
    const number = Number(size || 0);

    if (number >= 1024 * 1024) {
      return `${(number / (1024 * 1024)).toFixed(2)} MB`;
    }

    if (number >= 1024) {
      return `${(number / 1024).toFixed(2)} KB`;
    }

    return `${number} bytes`;
  }

  function getDownloadFilename(response) {
    const disposition = response.headers?.["content-disposition"] || "";
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);

    if (filenameMatch?.[1]) {
      return filenameMatch[1];
    }

    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replaceAll(".", "-");

    return `chalin03-full-system-backup-${makeSafeFileName(timestamp)}.json`;
  }

  async function readErrorBlob(error) {
    try {
      const responseData = error.response?.data;

      if (responseData instanceof Blob) {
        const text = await responseData.text();
        const parsed = JSON.parse(text);
        return parsed.message || text;
      }
    } catch (parseError) {
      return "";
    }

    return error.response?.data?.message || "";
  }

  async function downloadBackup() {
    setMessage("");
    setError("");
    setDownloading(true);

    try {
      const response = await axiosClient.get("/backups/download", {
        responseType: "blob",
      });

      const fileUrl = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/json" })
      );

      const link = document.createElement("a");

      link.href = fileUrl;
      link.setAttribute("download", getDownloadFilename(response));

      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(fileUrl);

      setMessage(
        "Full system backup downloaded successfully. Keep the file safe and private. It includes all stores and all system tables that exist in the database."
      );
    } catch (error) {
      const backendMessage = await readErrorBlob(error);
      setError(backendMessage || "Failed to download backup.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files[0] || null;

    setSelectedFile(file);
    setSelectedBackupInfo(null);
    setMessage("");
    setError("");

    if (!file) {
      return;
    }

    try {
      const fileText = await file.text();
      const backupData = JSON.parse(fileText);
      const tableNames = backupData?.tables
        ? Object.keys(backupData.tables).sort()
        : [];
      const totalRows = tableNames.reduce((sum, tableName) => {
        const rows = backupData.tables?.[tableName];
        return sum + (Array.isArray(rows) ? rows.length : 0);
      }, 0);

      setSelectedBackupInfo({
        app: backupData?.app || "Unknown app",
        backup_type: backupData?.backup_type || "Unknown backup type",
        version: backupData?.version || "Unknown version",
        created_at: backupData?.created_at || "Unknown time",
        table_count: tableNames.length,
        total_rows: totalRows,
        skipped_tables: backupData?.skipped_tables || [],
      });
    } catch (error) {
      setSelectedBackupInfo(null);
      setError(
        "The selected file is not a valid JSON backup file. Choose the correct Chalin 03 backup file."
      );
    }
  }

  async function restoreBackup(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!selectedFile) {
      setError("Please select a backup JSON file.");
      return;
    }

    if (confirmText !== RESTORE_CONFIRMATION_TEXT) {
      setError(`Type ${RESTORE_CONFIRMATION_TEXT} exactly before restoring.`);
      return;
    }

    const confirmed = window.confirm(
      "This will replace the current full system database with the backup file. It affects all stores, users, settings, products, sales, debts, stock transfers, stock ledger source records, audit records, SMS logs and reports. Continue?"
    );

    if (!confirmed) {
      return;
    }

    const secondConfirmed = window.confirm(
      "Final warning: restore is system-wide, not only the selected store. Current records across MAIN, AJAKAA and any other store will be replaced by the backup. Continue?"
    );

    if (!secondConfirmed) {
      return;
    }

    setRestoring(true);

    try {
      const fileText = await selectedFile.text();
      const backupData = JSON.parse(fileText);

      if (!backupData?.tables || typeof backupData.tables !== "object") {
        setError("Invalid backup file. The backup does not contain tables.");
        return;
      }

      const response = await axiosClient.post("/backups/restore", backupData);

      setMessage(
        response.data.message ||
          "Backup restored successfully. Please logout and login again."
      );
      setSelectedFile(null);
      setSelectedBackupInfo(null);
      setConfirmText("");
    } catch (error) {
      if (error instanceof SyntaxError) {
        setError("Invalid JSON backup file.");
        return;
      }

      setError(error.response?.data?.message || "Failed to restore backup.");
    } finally {
      setRestoring(false);
    }
  }

  const canRestore =
    Boolean(selectedFile) && confirmText === RESTORE_CONFIRMATION_TEXT && !restoring;

  if (role !== "admin") {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Access Denied</h1>
            <p>
              You are not allowed to open Backup & Restore from{" "}
              {currentStoreCode} — {currentStoreName}.
            </p>
          </div>
        </div>

        <div className="error-box">
          Only admin accounts can backup and restore the full system database.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Backup & Restore</h1>
          <p>Download or restore the full system database.</p>
        </div>
      </div>

      <div
        style={{
          marginBottom: "18px",
          padding: "14px",
          borderRadius: "14px",
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          color: "#9a3412",
          fontWeight: "800",
        }}
      >
        Current selected store: {currentStoreCode} — {currentStoreName}
        {currentStoreLocation ? ` - ${currentStoreLocation}` : ""}
        <br />
        <small>
          Backup and restore are system-wide. They are not limited to the
          selected store. A backup contains all stores, user access, users,
          settings, products, sales, debts, purchases, returns, expenses, stock
          adjustments, stock transfers, stock ledger source records, audit
          records, SMS logs and activity logs.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="warning-box">
        <strong>Very important:</strong> A backup file contains sensitive
        business records and password hashes. Keep the file private. Do not send
        it to anyone who should not control the system.
      </div>

      <div className="backup-grid">
        <div className="section-card backup-card">
          <h2>Download Full System Backup</h2>

          <p>
            This creates a JSON backup of the full database across all stores.
            It is for disaster recovery, not for ordinary selected-store Excel
            reporting.
          </p>

          <ul style={{ lineHeight: "1.8", fontWeight: "700" }}>
            <li>Branches / stores</li>
            <li>Users and user store access</li>
            <li>Business and receipt settings</li>
            <li>Products and stock adjustments</li>
            <li>Sales, sale items, debts and debt payments</li>
            <li>Purchases, purchase items and supplier payments</li>
            <li>Returns, expenses and daily closings</li>
            <li>Stock transfers and stock transfer items</li>
            <li>Audit records, SMS logs and activity logs</li>
          </ul>

          <div className="warning-box">
            Stock Movement Ledger has no separate table. It is rebuilt from
            sales, purchases, returns, stock adjustments and stock transfers.
            Backing up those source records protects the ledger history.
          </div>

          <button type="button" onClick={downloadBackup} disabled={downloading}>
            {downloading ? "Downloading..." : "Download Full System Backup"}
          </button>
        </div>

        <form className="section-card backup-card" onSubmit={restoreBackup}>
          <h2>Restore Full System Backup</h2>

          <p>
            Restore should only be used when you want to replace the current
            full database with a saved backup file.
          </p>

          <div className="error-box">
            Warning: Restore is system-wide. It will replace current records
            across all stores, not only {currentStoreCode}.
          </div>

          <label>Select Backup JSON File</label>
          <input type="file" accept=".json,application/json" onChange={handleFileChange} />

          {selectedFile && (
            <p className="selected-file">
              Selected file: <strong>{selectedFile.name}</strong>
              <br />
              Size: <strong>{formatFileSize(selectedFile.size)}</strong>
            </p>
          )}

          {selectedBackupInfo && (
            <div className="warning-box">
              <strong>Selected backup preview</strong>
              <br />
              App: {selectedBackupInfo.app}
              <br />
              Type: {selectedBackupInfo.backup_type}
              <br />
              Version: {selectedBackupInfo.version}
              <br />
              Created: {selectedBackupInfo.created_at}
              <br />
              Tables found: {formatNumber(selectedBackupInfo.table_count)}
              <br />
              Total rows found: {formatNumber(selectedBackupInfo.total_rows)}
              <br />
              Skipped tables when created:{" "}
              {selectedBackupInfo.skipped_tables.length > 0
                ? selectedBackupInfo.skipped_tables.join(", ")
                : "None"}
            </div>
          )}

          <label>Type RESTORE to confirm</label>
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={RESTORE_CONFIRMATION_TEXT}
          />

          <button type="submit" className="danger-button" disabled={!canRestore}>
            {restoring ? "Restoring..." : "Restore Full System Database"}
          </button>
        </form>
      </div>
    </div>
  );
}
