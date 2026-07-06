import { useState } from "react";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../context/AuthContext";

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
  const [confirmText, setConfirmText] = useState("");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function makeSafeFileName(value) {
    return String(value || "backup")
      .replace(/[^a-z0-9]/gi, "-")
      .replace(/-+/g, "-")
      .toLowerCase();
  }

  async function downloadBackup() {
    setMessage("");
    setError("");

    try {
      const response = await axiosClient.get("/backups/download", {
        responseType: "blob",
      });

      const fileUrl = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/json" })
      );

      const timestamp = new Date()
        .toISOString()
        .replaceAll(":", "-")
        .replaceAll(".", "-");

      const link = document.createElement("a");

      link.href = fileUrl;
      link.setAttribute(
        "download",
        `chalin03-full-system-backup-${makeSafeFileName(timestamp)}.json`
      );

      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(fileUrl);

      setMessage(
        "Full system backup downloaded successfully. Keep the file safe and private."
      );
    } catch (error) {
      setError("Failed to download backup.");
    }
  }

  function handleFileChange(event) {
    setSelectedFile(event.target.files[0] || null);
    setMessage("");
    setError("");
  }

  async function restoreBackup(event) {
    event.preventDefault();

    setMessage("");
    setError("");

    if (!selectedFile) {
      setError("Please select a backup JSON file.");
      return;
    }

    if (confirmText !== "RESTORE") {
      setError("Type RESTORE exactly before restoring.");
      return;
    }

    const confirmed = window.confirm(
      "This will replace the current full system database with the backup file. It affects all stores, users, settings, products, sales, debts, audit records and reports. Continue?"
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

    try {
      const fileText = await selectedFile.text();
      const backupData = JSON.parse(fileText);

      const response = await axiosClient.post("/backups/restore", backupData);

      setMessage(response.data.message || "Backup restored successfully.");
      setSelectedFile(null);
      setConfirmText("");
    } catch (error) {
      if (error instanceof SyntaxError) {
        setError("Invalid JSON backup file.");
        return;
      }

      setError(error.response?.data?.message || "Failed to restore backup.");
    }
  }

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
          <p>Download or restore the full system database</p>
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
          selected store. A backup should contain all branches, user store
          access, users, settings, products, sales, debts, purchases, returns,
          expenses, audit records and activity logs.
        </small>
      </div>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="backup-grid">
        <div className="section-card backup-card">
          <h2>Download Full System Backup</h2>

          <p>
            This creates a JSON backup of the full database, including all
            stores, branches, user store access, products, sales, debts,
            purchases, returns, users, settings, audit records and activity
            logs.
          </p>

          <div className="warning-box">
            The backup contains sensitive business data and password hashes.
            Keep it private. Do not send it to anyone who should not control the
            system.
          </div>

          <button type="button" onClick={downloadBackup}>
            Download Full System Backup
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
          <input type="file" accept=".json" onChange={handleFileChange} />

          {selectedFile && (
            <p className="selected-file">
              Selected file: <strong>{selectedFile.name}</strong>
            </p>
          )}

          <label>Type RESTORE to confirm</label>
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="RESTORE"
          />

          <button type="submit" className="danger-button">
            Restore Full System Database
          </button>
        </form>
      </div>
    </div>
  );
}
